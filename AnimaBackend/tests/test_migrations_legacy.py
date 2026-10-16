import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.db import Base
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending, plan
from app.migrations.sqlite_util import columns, index_exists, table_exists


def open_db(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(path, isolation_level=None)


def upgrade_twice(path: Path) -> None:
    for _ in range(2):
        conn = open_db(path)
        report = apply_pending(conn, STEPS, app_version="test")
        conn.close()
        assert report.status == "ok", report.message


def test_registry_order_respects_dependencies_and_ids_are_unique():
    seen: set[str] = set()
    for step in STEPS:
        assert step.id not in seen, step.id
        assert all(dep in seen for dep in step.depends), step.id
        assert step.namespace in ("core", "private"), step.id
        seen.add(step.id)


def test_current_schema_needs_nothing(tmp_path: Path):
    path = tmp_path / "a.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    engine.dispose()
    conn = open_db(path)
    report = plan(conn, STEPS)
    assert report.status == "ok"
    assert report.of("pending") == []


def test_connection_columns_keep_profiles_and_use_safe_defaults(tmp_path: Path):
    path = tmp_path / "a.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE api_connections (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("INSERT INTO api_connections (id, name) VALUES ('a1', '旧连接')")
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT id, name, cached_models, cached_models_at, stream, thinking FROM api_connections"
        ).fetchall() == [("a1", "旧连接", "[]", None, 1, None)]


def test_chat_columns_add_nullable_links_and_empty_variables(tmp_path: Path):
    path = tmp_path / "a.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE debug_chats (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("INSERT INTO debug_chats (id, name) VALUES ('d1', '旧聊天')")
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT id, parent_chat_id, parent_message_id, variables FROM debug_chats"
        ).fetchall() == [("d1", None, None, "{}")]


def test_voice_columns(tmp_path: Path):
    path = tmp_path / "a.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE voice_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("CREATE TABLE voice_emotions (id TEXT PRIMARY KEY, label TEXT NOT NULL)")
        db.execute("INSERT INTO voice_profiles (id, name) VALUES ('p1', '阿米娅')")
        db.execute("INSERT INTO voice_emotions (id, label) VALUES ('e1', '平静')")
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT id, ref_path, params FROM voice_profiles").fetchall() == [("p1", "", "{}")]
        assert db.execute("SELECT id, emo_vector, aux_refs FROM voice_emotions").fetchall() == [
            ("e1", None, "[]")
        ]


def test_asset_columns_keep_existing_sprites_and_assets_on(tmp_path: Path):
    path = tmp_path / "a.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE card_sprites (id TEXT PRIMARY KEY, label TEXT NOT NULL)")
        db.execute(
            "CREATE TABLE scene_assets (id TEXT PRIMARY KEY, label TEXT NOT NULL)"
        )
        db.execute("INSERT INTO card_sprites (id, label) VALUES ('s1', '平静')")
        db.execute("INSERT INTO scene_assets (id, label) VALUES ('a1', '食堂')")
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        # 老表 card_sprites 补完列以后,清理期那一步(core.2026_10_drop_card_sprites)把它删了:这张里没有图,没什么要留的
        assert not table_exists(db, "card_sprites")
        assert db.execute("SELECT id, enabled, parent_id, forms FROM scene_assets").fetchall() == [
            ("a1", 1, None, "[]")
        ]
        assert index_exists(db, "scene_assets", "ix_scene_assets_parent_id")


def test_scene_pack_title_bgm_and_card_last_chat(tmp_path: Path):
    path = tmp_path / "a.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE scene_packs (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("CREATE TABLE tavern_cards (id TEXT PRIMARY KEY, name TEXT)")
        db.execute("INSERT INTO scene_packs (id, name) VALUES ('p1', '罗德岛')")
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT id, title_bgm_id FROM scene_packs").fetchall() == [("p1", None)]
        assert "last_chat_id" in columns(db, "tavern_cards")


def test_missing_tables_are_left_to_create_all(tmp_path: Path):
    path = tmp_path / "a.db"
    conn = open_db(path)
    report = apply_pending(conn, STEPS, app_version="test")
    assert report.status == "ok"
    assert {s.how for s in report.steps} == {"detected"}
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert names == {"schema_migrations"}


OLD_TTS_CACHE = """
CREATE TABLE tts_cache (
    "key" VARCHAR(64) NOT NULL, data BLOB NOT NULL, mime VARCHAR(40) NOT NULL, size INTEGER NOT NULL,
    created_at DATETIME NOT NULL, last_used_at DATETIME NOT NULL, PRIMARY KEY ("key")
)
"""


def test_tts_cache_gets_the_covering_index(tmp_path: Path):
    path = tmp_path / "a.db"
    with sqlite3.connect(path) as db:
        db.execute(OLD_TTS_CACHE)
        db.execute("CREATE INDEX ix_tts_cache_last_used_at ON tts_cache (last_used_at)")
        db.execute(
            "INSERT INTO tts_cache VALUES ('k1', x'0102', 'audio/wav', 2, '2026-09-30', '2026-09-30')"
        )
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        assert index_exists(db, "tts_cache", "ix_tts_cache_evict")
        assert not index_exists(db, "tts_cache", "ix_tts_cache_last_used_at")
        assert [row[2] for row in db.execute("PRAGMA index_info(ix_tts_cache_evict)")] == [
            "last_used_at",
            "size",
            "key",
        ]
        assert db.execute("SELECT key, data, size FROM tts_cache").fetchall() == [("k1", b"\x01\x02", 2)]


PNG_HEAD = b"\x89PNG\r\n\x1a\n"
PNG_A = PNG_HEAD + b"A" * 16
PNG_B = PNG_HEAD + b"B" * 16
STAMP = "2026-09-26 06:46:09.000000"


def old_sprite_db(tmp_path: Path) -> Path:
    """立绘还挂在卡上时的表(card_sprites / card_sprite_layouts),列和当时的模型一样"""
    path = tmp_path / "a.db"
    with sqlite3.connect(path) as db:
        db.executescript(
            """
            CREATE TABLE tavern_cards (id VARCHAR(32) PRIMARY KEY, name VARCHAR(200), created_at DATETIME);
            CREATE TABLE card_sprites (
                id VARCHAR(32) PRIMARY KEY, card_id VARCHAR(32), label VARCHAR(80), aliases JSON,
                description TEXT, image BLOB, mime VARCHAR(40), sort INTEGER, enabled BOOLEAN,
                face_scan JSON, created_at DATETIME, updated_at DATETIME
            );
            CREATE TABLE card_sprite_layouts (
                card_id VARCHAR(32) PRIMARY KEY, auto BOOLEAN, zoom FLOAT, dx FLOAT, dy FLOAT
            );
            """
        )
        cards = [("k1", "星绘"), ("k2", "Wikira"), ("k3", "Wikira"), ("k4", "Wikira"), ("k5", "没有立绘")]
        for i, (cid, name) in enumerate(cards):
            db.execute("INSERT INTO tavern_cards VALUES (?, ?, ?)", (cid, name, f"2026-09-2{i} 00:00:00"))

        def sprite(sid, cid, label, image, sort, description="", enabled=1, face='{"width": 1}'):
            db.execute(
                "INSERT INTO card_sprites VALUES (?, ?, ?, '[\"smile\"]', ?, ?, 'image/png', ?, ?, ?, ?, ?)",
                (sid, cid, label, description, image, sort, enabled, face, STAMP, STAMP),
            )

        sprite("s1", "k1", "微笑", PNG_A, 0)
        sprite("s2", "k1", "平静", PNG_B, 1, enabled=0, face=None)
        for cid in ("k2", "k3", "k4"):
            sprite(f"{cid}a", cid, "微笑", PNG_A, 0, "开心时")
            sprite(f"{cid}b", cid, "眨眼", PNG_B, 1, "俏皮" if cid != "k4" else "俏皮、调侃")
        db.execute("INSERT INTO card_sprite_layouts VALUES ('k1', 1, 0.95, 0.037, -0.01)")
        db.execute("INSERT INTO card_sprite_layouts VALUES ('k3', 1, 1.0, 0.0, 0.0)")  # 默认值,等于没有
    return path


def test_sprite_packs_turn_each_cards_sprites_into_a_current_pack(tmp_path: Path):
    path = old_sprite_db(tmp_path)
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        packs = dict(db.execute("SELECT id, name FROM sprite_packs").fetchall())
        by_name = {name: pid for pid, name in packs.items()}
        assert sorted(packs.values()) == ["Wikira", "Wikira (2)", "星绘"]
        assert db.execute(
            "SELECT card_id, pack_id, sort, is_current FROM card_sprite_packs ORDER BY card_id"
        ).fetchall() == [
            ("k1", by_name["星绘"], 0, 1),
            ("k2", by_name["Wikira"], 0, 1),
            ("k3", by_name["Wikira"], 0, 1),
            ("k4", by_name["Wikira (2)"], 0, 1),
        ]
        assert db.execute(
            "SELECT label, aliases, description, image, mime, sort, enabled, face_scan, created_at"
            " FROM pack_sprites WHERE pack_id = ? ORDER BY sort",
            (by_name["星绘"],),
        ).fetchall() == [
            ("微笑", '["smile"]', "", PNG_A, "image/png", 0, 1, '{"width": 1}', STAMP),
            ("平静", '["smile"]', "", PNG_B, "image/png", 1, 0, None, STAMP),
        ]
        assert db.execute(
            "SELECT count(*) FROM pack_sprites WHERE pack_id = ?", (by_name["Wikira"],)
        ).fetchone() == (2,)
        assert db.execute(
            "SELECT description FROM pack_sprites WHERE pack_id = ? ORDER BY sort", (by_name["Wikira (2)"],)
        ).fetchall() == [("开心时",), ("俏皮、调侃",)]
        assert db.execute("SELECT pack_id, auto, zoom, dx, dy FROM sprite_pack_layouts").fetchall() == [
            (by_name["星绘"], 1, 0.95, 0.037, -0.01)
        ]
        # 图都搬进了立绘包,清理期那一步把老表删了
        assert not table_exists(db, "card_sprites") and not table_exists(db, "card_sprite_layouts")


def test_sprite_packs_keep_layouts_apart_and_names_clear_of_existing_packs(tmp_path: Path):
    path = old_sprite_db(tmp_path)
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO card_sprite_layouts VALUES ('k2', 1, 1.2, 0.0, 0.0)")
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    engine.dispose()
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO sprite_packs (id, name, description, created_at, updated_at)"
            " VALUES ('p0', '星绘', '', ?, ?)",
            (STAMP, STAMP),
        )
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        names = dict(db.execute(
            "SELECT b.card_id, p.name FROM card_sprite_packs b JOIN sprite_packs p ON p.id = b.pack_id"
        ).fetchall())
        assert names == {"k1": "星绘 (2)", "k2": "Wikira", "k3": "Wikira (2)", "k4": "Wikira (3)"}


def test_sprite_packs_never_bring_back_a_pack_the_player_removed(tmp_path: Path):
    """立绘包已经在用了(迁移以前跑过):卡上没挂包是玩家自己拿掉的,不能再变出来"""
    path = old_sprite_db(tmp_path)
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        db.execute("DELETE FROM card_sprite_packs WHERE card_id = 'k1'")
        db.execute("DELETE FROM schema_migrations")
    upgrade_twice(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM card_sprite_packs WHERE card_id = 'k1'").fetchone() == (0,)
