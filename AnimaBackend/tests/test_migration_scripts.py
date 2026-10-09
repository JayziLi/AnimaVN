import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.db import Base

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"


def database(tmp_path: Path) -> Path:
    data = tmp_path / "data"
    data.mkdir()
    return data / "animabackend.db"


def run_script(tmp_path: Path, name: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT_DIR / name)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )


def columns(db_path: Path, table: str) -> list[str]:
    with sqlite3.connect(db_path) as db:
        return [row[1] for row in db.execute(f"PRAGMA table_info({table})")]


def run_twice(tmp_path: Path, script: str) -> None:
    first = run_script(tmp_path, script)
    second = run_script(tmp_path, script)
    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr


def test_connection_migrations_preserve_profiles_and_apply_safe_defaults(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute(
            "CREATE TABLE api_connections (id TEXT PRIMARY KEY, name TEXT NOT NULL)"
        )
        db.execute("INSERT INTO api_connections (id, name) VALUES ('a1', '旧连接')")
        db.commit()

    run_twice(tmp_path, "migrate_connection_cache_columns.py")
    run_twice(tmp_path, "migrate_connection_stream_column.py")

    assert columns(db_path, "api_connections") == [
        "id",
        "name",
        "cached_models",
        "cached_models_at",
        "stream",
    ]
    with sqlite3.connect(db_path) as db:
        assert db.execute(
            "SELECT id, name, cached_models, cached_models_at, stream FROM api_connections"
        ).fetchall() == [("a1", "旧连接", "[]", None, 1)]


def test_chat_parent_migration_adds_nullable_links_without_changing_chat(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE debug_chats (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("INSERT INTO debug_chats (id, name) VALUES ('d1', '旧聊天')")
        db.commit()

    run_twice(tmp_path, "migrate_chat_parent_columns.py")

    assert columns(db_path, "debug_chats") == [
        "id",
        "name",
        "parent_chat_id",
        "parent_message_id",
    ]
    with sqlite3.connect(db_path) as db:
        assert db.execute(
            "SELECT id, name, parent_chat_id, parent_message_id FROM debug_chats"
        ).fetchall() == [("d1", "旧聊天", None, None)]


def test_chat_variables_migration_adds_empty_object_to_existing_chats(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE debug_chats (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("INSERT INTO debug_chats (id, name) VALUES ('d1', '旧聊天')")
        db.commit()

    run_twice(tmp_path, "migrate_chat_variables_column.py")

    assert columns(db_path, "debug_chats") == ["id", "name", "variables"]
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT id, name, variables FROM debug_chats").fetchall() == [
            ("d1", "旧聊天", "{}")
        ]


def test_chat_variables_migration_skips_a_database_without_the_table(tmp_path: Path):
    db_path = database(tmp_path)
    sqlite3.connect(db_path).close()

    result = run_script(tmp_path, "migrate_chat_variables_column.py")

    assert result.returncode == 0, result.stderr
    assert "skipped" in result.stdout


@pytest.mark.parametrize(
    "script",
    [
        "migrate_connection_cache_columns.py",
        "migrate_connection_stream_column.py",
        "migrate_chat_parent_columns.py",
        "migrate_chat_variables_column.py",
        "migrate_voice_indextts_columns.py",
        "migrate_voice_params_column.py",
        "migrate_asset_enabled_columns.py",
        "migrate_sprite_face_column.py",
        "migrate_connection_thinking_column.py",
        "migrate_scene_pack_title_bgm_column.py",
        "migrate_sprite_packs.py",
    ],
)
def test_migration_scripts_are_noops_against_current_schema(tmp_path: Path, script: str):
    db_path = database(tmp_path)
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    engine.dispose()

    result = run_script(tmp_path, script)

    assert result.returncode == 0, result.stderr


def test_voice_indextts_migration_adds_speaker_ref_and_vector(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE voice_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("CREATE TABLE voice_emotions (id TEXT PRIMARY KEY, label TEXT NOT NULL)")
        db.execute("INSERT INTO voice_profiles (id, name) VALUES ('p1', '阿米娅')")
        db.execute("INSERT INTO voice_emotions (id, label) VALUES ('e1', '平静')")
        db.commit()

    run_twice(tmp_path, "migrate_voice_indextts_columns.py")

    assert columns(db_path, "voice_profiles") == ["id", "name", "ref_path"]
    assert columns(db_path, "voice_emotions") == ["id", "label", "emo_vector"]
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT id, name, ref_path FROM voice_profiles").fetchall() == [
            ("p1", "阿米娅", "")
        ]
        assert db.execute("SELECT id, label, emo_vector FROM voice_emotions").fetchall() == [
            ("e1", "平静", None)
        ]


def test_voice_indextts_migration_skips_missing_tables(tmp_path: Path):
    database(tmp_path)
    result = run_script(tmp_path, "migrate_voice_indextts_columns.py")
    assert result.returncode == 0, result.stderr


def test_voice_params_migration_adds_an_empty_params_column(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE voice_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("INSERT INTO voice_profiles (id, name) VALUES ('p1', '阿米娅')")
        db.commit()

    run_twice(tmp_path, "migrate_voice_params_column.py")

    assert columns(db_path, "voice_profiles") == ["id", "name", "params"]
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT id, params FROM voice_profiles").fetchall() == [("p1", "{}")]


def test_voice_params_migration_skips_missing_tables(tmp_path: Path):
    database(tmp_path)
    result = run_script(tmp_path, "migrate_voice_params_column.py")
    assert result.returncode == 0, result.stderr


def test_asset_enabled_migration_keeps_existing_sprites_and_assets_on(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE card_sprites (id TEXT PRIMARY KEY, label TEXT NOT NULL)")
        db.execute("CREATE TABLE scene_assets (id TEXT PRIMARY KEY, label TEXT NOT NULL)")
        db.execute("INSERT INTO card_sprites (id, label) VALUES ('s1', '平静')")
        db.execute("INSERT INTO scene_assets (id, label) VALUES ('a1', '食堂')")
        db.commit()

    run_twice(tmp_path, "migrate_asset_enabled_columns.py")

    assert columns(db_path, "card_sprites") == ["id", "label", "enabled"]
    assert columns(db_path, "scene_assets") == ["id", "label", "enabled"]
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT id, enabled FROM card_sprites").fetchall() == [("s1", 1)]
        assert db.execute("SELECT id, enabled FROM scene_assets").fetchall() == [("a1", 1)]


def test_asset_enabled_migration_skips_missing_tables(tmp_path: Path):
    database(tmp_path)
    result = run_script(tmp_path, "migrate_asset_enabled_columns.py")
    assert result.returncode == 0, result.stderr


def test_sprite_face_migration_adds_an_unscanned_column(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE card_sprites (id TEXT PRIMARY KEY, label TEXT NOT NULL)")
        db.execute("INSERT INTO card_sprites (id, label) VALUES ('s1', '平静')")
        db.commit()

    run_twice(tmp_path, "migrate_sprite_face_column.py")

    assert columns(db_path, "card_sprites") == ["id", "label", "face_scan"]
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT id, face_scan FROM card_sprites").fetchall() == [("s1", None)]


def test_sprite_face_migration_skips_missing_tables(tmp_path: Path):
    database(tmp_path)
    result = run_script(tmp_path, "migrate_sprite_face_column.py")
    assert result.returncode == 0, result.stderr


def test_connection_thinking_migration_leaves_existing_connections_on_service_default(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE api_connections (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("INSERT INTO api_connections (id, name) VALUES ('a1', 'deepseek')")
        db.commit()

    run_twice(tmp_path, "migrate_connection_thinking_column.py")

    assert columns(db_path, "api_connections") == ["id", "name", "thinking"]
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT id, thinking FROM api_connections").fetchall() == [("a1", None)]


def test_connection_thinking_migration_skips_missing_tables(tmp_path: Path):
    database(tmp_path)
    result = run_script(tmp_path, "migrate_connection_thinking_column.py")
    assert result.returncode == 0, result.stderr


def test_scene_pack_title_bgm_migration_leaves_existing_packs_on_the_default(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE scene_packs (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("INSERT INTO scene_packs (id, name) VALUES ('p1', '罗德岛')")
        db.commit()

    run_twice(tmp_path, "migrate_scene_pack_title_bgm_column.py")

    assert columns(db_path, "scene_packs") == ["id", "name", "title_bgm_id"]
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT id, title_bgm_id FROM scene_packs").fetchall() == [("p1", None)]


def test_scene_pack_title_bgm_migration_skips_missing_tables(tmp_path: Path):
    database(tmp_path)
    result = run_script(tmp_path, "migrate_scene_pack_title_bgm_column.py")
    assert result.returncode == 0, result.stderr


PNG_HEAD = b"\x89PNG\r\n\x1a\n"
PNG_A = PNG_HEAD + b"A" * 16
PNG_B = PNG_HEAD + b"B" * 16
STAMP = "2026-09-26 06:46:09.000000"


def old_sprite_db(tmp_path: Path) -> Path:
    """立绘还挂在卡上时的表(card_sprites / card_sprite_layouts),列和当时的模型一样"""
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
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
        cards = [
            ("k1", "星绘"),
            ("k2", "Wikira"),
            ("k3", "Wikira"),  # 复制出来的卡,立绘一模一样
            ("k4", "Wikira"),  # 复制后改过一句说明
            ("k5", "没有立绘"),
        ]
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
        db.commit()
    return db_path


def test_sprite_pack_migration_turns_each_cards_sprites_into_a_current_pack(tmp_path: Path):
    db_path = old_sprite_db(tmp_path)

    run_twice(tmp_path, "migrate_sprite_packs.py")

    with sqlite3.connect(db_path) as db:
        packs = dict(db.execute("SELECT id, name FROM sprite_packs").fetchall())
        by_name = {name: pid for pid, name in packs.items()}
        assert sorted(packs.values()) == ["Wikira", "Wikira (2)", "星绘"]
        bound = db.execute(
            "SELECT card_id, pack_id, sort, is_current FROM card_sprite_packs ORDER BY card_id"
        ).fetchall()
        assert bound == [
            ("k1", by_name["星绘"], 0, 1),
            ("k2", by_name["Wikira"], 0, 1),
            ("k3", by_name["Wikira"], 0, 1),
            ("k4", by_name["Wikira (2)"], 0, 1),
        ]
        rows = db.execute(
            "SELECT label, aliases, description, image, mime, sort, enabled, face_scan, created_at"
            " FROM pack_sprites WHERE pack_id = ? ORDER BY sort",
            (by_name["星绘"],),
        ).fetchall()
        assert rows == [
            ("微笑", '["smile"]', "", PNG_A, "image/png", 0, 1, '{"width": 1}', STAMP),
            ("平静", '["smile"]', "", PNG_B, "image/png", 1, 0, None, STAMP),
        ]
        # 共用的包只存一份
        assert db.execute(
            "SELECT count(*) FROM pack_sprites WHERE pack_id = ?", (by_name["Wikira"],)
        ).fetchone() == (2,)
        assert db.execute(
            "SELECT description FROM pack_sprites WHERE pack_id = ? ORDER BY sort", (by_name["Wikira (2)"],)
        ).fetchall() == [("开心时",), ("俏皮、调侃",)]
        assert db.execute("SELECT pack_id, auto, zoom, dx, dy FROM sprite_pack_layouts").fetchall() == [
            (by_name["星绘"], 1, 0.95, 0.037, -0.01)
        ]
        # 老表原样留着
        assert db.execute("SELECT count(*) FROM card_sprites").fetchone() == (8,)


def test_sprite_pack_migration_keeps_layouts_apart_and_names_clear_of_existing_packs(tmp_path: Path):
    db_path = old_sprite_db(tmp_path)
    with sqlite3.connect(db_path) as db:
        # 立绘一样、摆法不一样:不共用,不然有一张卡的位置会变
        db.execute("INSERT INTO card_sprite_layouts VALUES ('k2', 1, 1.2, 0.0, 0.0)")
        db.commit()
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    engine.dispose()
    with sqlite3.connect(db_path) as db:
        db.execute(
            "INSERT INTO sprite_packs (id, name, description, created_at, updated_at)"
            " VALUES ('p0', '星绘', '', ?, ?)",
            (STAMP, STAMP),
        )
        db.commit()

    run_twice(tmp_path, "migrate_sprite_packs.py")

    with sqlite3.connect(db_path) as db:
        names = dict(db.execute(
            "SELECT b.card_id, p.name FROM card_sprite_packs b JOIN sprite_packs p ON p.id = b.pack_id"
        ).fetchall())
        assert names == {"k1": "星绘 (2)", "k2": "Wikira", "k3": "Wikira (2)", "k4": "Wikira (3)"}


OLD_TTS_CACHE = """
CREATE TABLE tts_cache (
    "key" VARCHAR(64) NOT NULL, data BLOB NOT NULL, mime VARCHAR(40) NOT NULL, size INTEGER NOT NULL,
    created_at DATETIME NOT NULL, last_used_at DATETIME NOT NULL, PRIMARY KEY ("key")
)
"""


def test_tts_cache_index_migration_covers_the_eviction_queries(tmp_path: Path):
    db_path = database(tmp_path)
    with sqlite3.connect(db_path) as db:
        db.execute(OLD_TTS_CACHE)
        db.execute("CREATE INDEX ix_tts_cache_last_used_at ON tts_cache (last_used_at)")
        db.execute(
            "INSERT INTO tts_cache VALUES ('k1', x'0102', 'audio/wav', 2, '2026-09-30', '2026-09-30')"
        )
        db.commit()

    run_twice(tmp_path, "migrate_tts_cache_evict_index.py")

    with sqlite3.connect(db_path) as db:
        indexes = {row[1] for row in db.execute("PRAGMA index_list(tts_cache)")}
        assert "ix_tts_cache_evict" in indexes
        assert "ix_tts_cache_last_used_at" not in indexes
        assert [row[2] for row in db.execute("PRAGMA index_info(ix_tts_cache_evict)")] == [
            "last_used_at",
            "size",
            "key",
        ]
        for query in (
            "SELECT coalesce(sum(size), 0) FROM tts_cache",
            "SELECT key, size FROM tts_cache ORDER BY last_used_at",
        ):
            plan = [row[3] for row in db.execute("EXPLAIN QUERY PLAN " + query)]
            assert plan == ["SCAN tts_cache USING COVERING INDEX ix_tts_cache_evict"], plan
        assert db.execute("SELECT key, data, size FROM tts_cache").fetchall() == [("k1", b"", 2)]


def test_tts_cache_index_migration_skips_missing_tables(tmp_path: Path):
    database(tmp_path)
    result = run_script(tmp_path, "migrate_tts_cache_evict_index.py")
    assert result.returncode == 0, result.stderr
    assert "skipped" in result.stdout
