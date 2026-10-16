"""迁移步骤 core.2026_10_cg_packs:场景包里的 CG 搬进 CG 包,绑给原来绑这个场景包的卡。"""

import json
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending
from app.models import CardScenePack, SceneAsset, ScenePack, TavernCard


def _old_db(path: Path) -> Path:
    """升级前的库:两个场景包(星庇所有两张 CG、一张差分;另一个没有 CG),三张卡"""
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    with engine.begin() as c:
        for t in ("cg_packs", "cg_assets", "card_roles", "asset_bindings"):
            c.exec_driver_sql(f"DROP TABLE {t}")
    with Session(engine) as db:
        db.add_all([TavernCard(id="k1", name="星绘"), TavernCard(id="k2", name="Wikira"), TavernCard(id="k3", name="诺亚")])
        db.add_all([ScenePack(id="s1", name="同居日常 · 星庇所"), ScenePack(id="s2", name="千年")])
        db.add_all(
            [
                SceneAsset(id="bg1", pack_id="s1", kind="bg", label="客厅", mime="image/png", data=b"bg"),
                SceneAsset(id="cg1", pack_id="s1", kind="cg", label="膝枕", sort=1, mime="image/png", data=b"a",
                           data_sha="a" * 64, aliases=["枕"], focus_x=30, forms=["夜晚"]),
                SceneAsset(id="cg2", pack_id="s1", kind="cg", label="拥抱", sort=0, mime="image/png", data=b"b"),
                SceneAsset(id="cg1v", pack_id="s1", kind="cg", label="微笑", parent_id="cg1", mime="image/png",
                           data=b"c", data_sha="c" * 64, enabled=False),
                SceneAsset(id="bg2", pack_id="s2", kind="bg", label="教室", mime="image/png", data=b"d"),
            ]
        )
        db.add_all([CardScenePack(card_id="k1", pack_id="s1"), CardScenePack(card_id="k2", pack_id="s1"),
                    CardScenePack(card_id="k3", pack_id="s2")])
        db.commit()
    engine.dispose()
    return path


def _run(path: Path):
    conn = sqlite3.connect(path, isolation_level=None)
    report = apply_pending(conn, STEPS, app_version="test")
    conn.close()
    assert report.status == "ok", report.message


def test_cg_moves_to_a_cg_pack_bound_to_the_same_cards(tmp_path: Path):
    db = _old_db(tmp_path / "old.db")
    _run(db)
    _run(db)  # 跑两次不重复
    with sqlite3.connect(db) as c:
        packs = c.execute("SELECT id, name, source_scene_pack_id FROM cg_packs").fetchall()
        assert [(n, s) for _, n, s in packs] == [("同居日常 · 星庇所 · CG", "s1")]
        cg_pack = packs[0][0]
        rows = [
            (r[0], r[1], r[2], r[3], json.loads(r[4]), r[5], r[6], json.loads(r[7]), *r[8:])
            for r in c.execute(
                "SELECT id, pack_id, parent_id, label, aliases, sort, focus_x, forms, enabled, data_sha, data"
                " FROM cg_assets ORDER BY id"
            )
        ]
        assert rows == [
            ("cg1", cg_pack, None, "膝枕", ["枕"], 1, 30, ["夜晚"], 1, "a" * 64, None),
            ("cg1v", cg_pack, "cg1", "微笑", [], 0, 50, [], 0, "c" * 64, None),
            # 还没复制进文件仓库的(没有指纹)连原件一起搬
            ("cg2", cg_pack, None, "拥抱", [], 0, 50, [], 1, None, b"b"),
        ]
        bound = c.execute(
            "SELECT card_id, role_id, sort FROM asset_bindings WHERE kind = 'cg' ORDER BY card_id"
        ).fetchall()
        assert bound == [("k1", "", 0), ("k2", "", 0)]
        # 场景包里原来的 CG 行原样留着
        assert c.execute("SELECT count(*) FROM scene_assets WHERE kind = 'cg'").fetchone()[0] == 3
