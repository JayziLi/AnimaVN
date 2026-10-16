"""清理期那一步 core.2026_10_drop_card_sprites:老表里的图立绘包里都有才删,有一张没有就原样留着、不挡升级。"""

import hashlib
import sqlite3
from pathlib import Path

from app.migrations.core import drop_card_sprites as step


def _db(path: Path, pack_has: bytes) -> sqlite3.Connection:
    conn = sqlite3.connect(path, isolation_level=None)
    conn.execute("CREATE TABLE card_sprites (id TEXT PRIMARY KEY, image BLOB)")
    conn.execute("CREATE TABLE card_sprite_layouts (card_id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE pack_sprites (id TEXT PRIMARY KEY, image BLOB, image_sha TEXT)")
    conn.execute("INSERT INTO card_sprites VALUES ('s1', x'0102')")
    # 瘦身以后包里只剩指纹
    conn.execute("INSERT INTO pack_sprites VALUES ('p1', NULL, ?)", (hashlib.sha256(pack_has).hexdigest(),))
    return conn


def test_dropped_when_every_old_image_is_in_a_pack(tmp_path: Path):
    conn = _db(tmp_path / "a.db", b"\x01\x02")
    step.STEP.apply(conn)
    assert step.STEP.verify(conn) and step.STEP.detect(conn)


def test_kept_when_an_old_image_is_nowhere_else(tmp_path: Path):
    conn = _db(tmp_path / "b.db", b"other")
    step.STEP.apply(conn)
    assert step.STEP.verify(conn)  # 不挡升级
    assert conn.execute("SELECT count(*) FROM card_sprites").fetchone()[0] == 1
