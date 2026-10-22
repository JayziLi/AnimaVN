import re
import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.db import Base
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending, plan
from app.schema_check import missing_columns

FIXTURES = Path(__file__).parent / "fixtures" / "schemas"
GENERATIONS = ["g1_master", "g2_play", "g3_local"]


def build(tmp_path: Path, name: str) -> Path:
    path = tmp_path / f"{name}.db"
    conn = sqlite3.connect(path)
    conn.executescript((FIXTURES / f"{name}.sql").read_text(encoding="utf-8"))
    conn.close()
    return path


@pytest.mark.parametrize("name", GENERATIONS)
def test_every_generation_upgrades_to_the_current_models(tmp_path: Path, name: str):
    path = build(tmp_path, name)
    conn = sqlite3.connect(path, isolation_level=None)
    report = apply_pending(conn, STEPS, app_version="test")
    conn.close()
    assert report.status == "ok", report.message

    # 后端启动时迁移之后还会 create_all:建出缺的整张表,之后不能再缺任何列
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    assert missing_columns(engine, Base.metadata) == []
    engine.dispose()

    conn = sqlite3.connect(path, isolation_level=None)
    again = plan(conn, STEPS, mode="apply")
    conn.close()
    assert again.status == "ok" and again.of("pending") == []


def test_the_local_database_needs_no_upgrade(tmp_path: Path):
    # 夹具是 10-10 的本机库:只差那以后才加的步骤(第 1b 期起),别的都不用做
    conn = sqlite3.connect(build(tmp_path, "g3_local"), isolation_level=None)
    # 公开版删了 app/migrations/private,那几步不在登记表里,也就不该等着做
    known = {s.id for s in STEPS}
    assert [s.id for s in plan(conn, STEPS).of("pending")] == [step for step in [
        "core.2026_10_emotion_records",
        "core.2026_10_card_prefs",
        "core.2026_10_blob_store",
        "core.2026_10_bindings",
        # 这两步要等前面的做完才看得出做没做过,先算待做(夹具里没有 CG,真做的时候都只登记)
        "core.2026_10_cg_packs",
        "core.2026_10_card_states",
        "core.2026_10_drop_card_sprites",
        # 补列的两张表是前面两步建的,同样先算待做(真做的时候建表已经带上新列,只登记)
        "core.2026_10_binding_parts",
        # 声音包(第 4 步):给声音补指纹列
        "core.2026_10_voice_files",
        "private.2026_10_sfx_blob_sha",
        "private.2026_10_unbind_wikira_cg",
        "private.2026_10_split_states",
        "private.2026_10_imagegen_generated",
    ] if step in known]


# 「只加」的步骤里不许出现删表、删列、删行、改行、改名
FORBIDDEN = re.compile(r"\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|UPDATE\s+\S+\s+SET|RENAME)\b", re.I)


def test_additive_steps_only_add(tmp_path: Path):
    conn = sqlite3.connect(build(tmp_path, "g1_master"), isolation_level=None)
    current = {"id": None}
    seen: list[tuple[str | None, str]] = []
    conn.set_trace_callback(lambda sql: seen.append((current["id"], sql)))

    def traced(step):
        def run(c):
            current["id"] = step.id
            step.apply(c)
            current["id"] = None

        return replace(step, apply=run)

    report = apply_pending(conn, [traced(s) for s in STEPS], app_version="test")
    assert report.status == "ok", report.message
    additive = {s.id for s in STEPS if s.compat == "additive"}
    bad = [(sid, sql) for sid, sql in seen if sid in additive and FORBIDDEN.search(sql)]
    assert bad == []
    assert any(sid for sid, _ in seen), "g1 夹具上至少要真的跑几步,不然这条测试没测到东西"
