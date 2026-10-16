"""迁移步骤 core.2026_10_binding_parts:绑定行补 parts(背景 / BGM 分开绑),CG 包补 generated(分来源)。"""

import sqlite3
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.migrations.core import binding_parts
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending
from app.migrations.sqlite_util import columns
from app.models import CardRole, ScenePack, TavernCard

# 第 1 步以前的两张表(和当时 create_all 建出来的一样)
OLD_TABLES = """
CREATE TABLE asset_bindings (
    id VARCHAR(32) NOT NULL,
    card_id VARCHAR(32) NOT NULL,
    role_id VARCHAR(32) NOT NULL,
    kind VARCHAR(8) NOT NULL,
    target_id VARCHAR(32) NOT NULL,
    sort INTEGER NOT NULL,
    is_primary BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_asset_bindings_target UNIQUE (card_id, role_id, kind, target_id),
    FOREIGN KEY(card_id) REFERENCES tavern_cards (id)
);
CREATE INDEX ix_asset_bindings_card_id ON asset_bindings (card_id);
CREATE INDEX ix_asset_bindings_target_id ON asset_bindings (target_id);
CREATE TABLE cg_packs (
    id VARCHAR(32) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    source_scene_pack_id VARCHAR(32),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id)
);
CREATE INDEX ix_cg_packs_source_scene_pack_id ON cg_packs (source_scene_pack_id);
"""


def _old_db(path: Path) -> Path:
    """升级前的库:一张卡绑着一个场景包、一个 CG 包"""
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([TavernCard(id="k1", name="刻晴"), CardRole(id="r1", card_id="k1", name="刻晴", is_main=True)])
        db.add(ScenePack(id="s1", name="原神 · 璃月"))
        db.commit()
    engine.dispose()
    conn = sqlite3.connect(path)
    conn.executescript("DROP TABLE asset_bindings; DROP TABLE cg_packs;" + OLD_TABLES)
    now = "2026-10-10 00:00:00.000000"
    conn.execute("INSERT INTO cg_packs (id, name, description, created_at, updated_at) VALUES ('c1', '璃月 · CG', '', ?, ?)", (now, now))
    conn.executemany(
        "INSERT INTO asset_bindings (id, card_id, role_id, kind, target_id, sort, is_primary, created_at) VALUES (?, 'k1', '', ?, ?, 0, 0, ?)",
        [("b1", "scene", "s1", now), ("b2", "cg", "c1", now)],
    )
    conn.commit()
    conn.close()
    return path


def _run(path: Path):
    conn = sqlite3.connect(path, isolation_level=None)
    report = apply_pending(conn, STEPS, app_version="test")
    conn.close()
    assert report.status == "ok", report.message
    return report


def test_old_bindings_give_both_parts_and_old_cg_packs_are_imported_ones(tmp_path: Path):
    db = _old_db(tmp_path / "old.db")
    with sqlite3.connect(db) as c:
        assert not binding_parts.STEP.detect(c)
    report = _run(db)
    assert [s.how for s in report.steps if s.id == "core.2026_10_binding_parts"] == ["applied"]
    _run(db)  # 跑两次不重复
    with sqlite3.connect(db) as c:
        assert "parts" in columns(c, "asset_bindings") and "generated" in columns(c, "cg_packs")
        assert c.execute("SELECT id, parts FROM asset_bindings ORDER BY id").fetchall() == [("b1", ""), ("b2", "")]
        assert c.execute("SELECT id, generated FROM cg_packs").fetchall() == [("c1", 0)]
        # 补的列有默认值:旧代码照旧插行(不写这两列)也不出错
        c.execute(
            "INSERT INTO asset_bindings (id, card_id, role_id, kind, target_id, sort, is_primary, created_at)"
            " VALUES ('b3', 'k1', '', 'scene', 's2', 1, 0, '2026-10-16')"
        )
        c.execute("INSERT INTO cg_packs (id, name, description, created_at, updated_at) VALUES ('c2', 'x', '', '', '')")
        assert c.execute("SELECT parts FROM asset_bindings WHERE id = 'b3'").fetchone() == ("",)
        assert c.execute("SELECT generated FROM cg_packs WHERE id = 'c2'").fetchone() == (0,)


def test_a_fresh_database_already_has_the_columns(tmp_path: Path):
    path = tmp_path / "new.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    engine.dispose()
    with sqlite3.connect(path) as c:
        assert binding_parts.STEP.detect(c)


def test_it_runs_after_the_steps_that_create_the_two_tables():
    ids = [s.id for s in STEPS]
    assert ids.index("core.2026_10_binding_parts") > max(ids.index("core.2026_10_bindings"), ids.index("core.2026_10_cg_packs"))
    assert binding_parts.STEP.compat == "additive"
