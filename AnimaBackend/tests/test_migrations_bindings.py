"""迁移步骤 core.2026_10_bindings:三张旧绑定表搬进角色位和绑定表。"""

import sqlite3
from pathlib import Path

from app.migrations.core import bindings
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending, read_ledger


def _old_db(path: Path) -> Path:
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE tavern_cards (id TEXT PRIMARY KEY, name TEXT)")
        db.execute("CREATE TABLE card_sprite_packs (card_id TEXT, pack_id TEXT, sort INTEGER, is_current BOOLEAN,"
                   " PRIMARY KEY (card_id, pack_id))")
        db.execute("CREATE TABLE card_voices (card_id TEXT, profile_id TEXT, is_main BOOLEAN,"
                   " PRIMARY KEY (card_id, profile_id))")
        db.execute("CREATE TABLE card_scene_packs (card_id TEXT PRIMARY KEY, pack_id TEXT)")
        db.executemany("INSERT INTO tavern_cards VALUES (?, ?)", [("k1", "星绘"), ("k2", "香奈美"), ("k3", "空卡")])
        db.executemany(
            "INSERT INTO card_sprite_packs VALUES (?, ?, ?, ?)",
            [("k1", "pB", 1, 1), ("k1", "pA", 0, 0), ("k2", "pC", 0, 1), ("gone", "pA", 0, 1)],
        )
        # k2 的附加声音先插、主声音后插:主声音要排第一,附加的照原来的先后
        db.executemany(
            "INSERT INTO card_voices VALUES (?, ?, ?)",
            [("k2", "vX", 0), ("k2", "vMain", 1), ("k2", "vY", 0), ("k1", "v1", 1)],
        )
        db.executemany("INSERT INTO card_scene_packs VALUES (?, ?)", [("k1", "s1"), ("k2", "s1")])
    return path


def _run(path: Path):
    conn = sqlite3.connect(path, isolation_level=None)
    report = apply_pending(conn, STEPS, app_version="test")
    conn.close()
    assert report.status == "ok", report.message


def test_old_bindings_move_to_the_main_role(tmp_path: Path):
    db = _old_db(tmp_path / "old.db")
    _run(db)
    _run(db)  # 跑两次不重复
    with sqlite3.connect(db) as c:
        roles = {card: (rid, name) for rid, card, name in c.execute(
            "SELECT id, card_id, name FROM card_roles WHERE is_main = 1")}
        assert {k: v[1] for k, v in roles.items()} == {"k1": "星绘", "k2": "香奈美", "k3": "空卡"}
        assert c.execute("SELECT count(*) FROM card_roles").fetchone()[0] == 3

        def rows(card, kind):
            return c.execute(
                "SELECT role_id, target_id, sort, is_primary FROM asset_bindings"
                " WHERE card_id = ? AND kind = ? ORDER BY sort", (card, kind)).fetchall()

        k1 = roles["k1"][0]
        assert rows("k1", "sprite") == [(k1, "pA", 0, 0), (k1, "pB", 1, 1)]
        assert rows("k1", "voice") == [(k1, "v1", 0, 1)]
        k2 = roles["k2"][0]
        assert rows("k2", "voice") == [(k2, "vMain", 0, 1), (k2, "vX", 1, 0), (k2, "vY", 2, 0)]
        assert rows("k2", "scene") == [("", "s1", 0, 0)]
        assert rows("k3", "sprite") == []
        # 卡已经删了的旧绑定不搬;旧表一行不动
        assert c.execute("SELECT count(*) FROM asset_bindings WHERE card_id = 'gone'").fetchone()[0] == 0
        assert c.execute("SELECT count(*) FROM card_sprite_packs").fetchone()[0] == 4
        assert c.execute("SELECT count(*) FROM asset_bindings").fetchone()[0] == 9


def test_a_fresh_database_only_records_the_step(tmp_path: Path):
    conn = sqlite3.connect(tmp_path / "new.db", isolation_level=None)
    report = apply_pending(conn, STEPS, app_version="test")
    assert report.status == "ok"
    assert bindings.STEP.id in read_ledger(conn)
    conn.close()
