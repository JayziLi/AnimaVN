"""第 1b 期的迁移步骤:认词记录、配对表三张新表(只建表)。"""

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.db import Base
from app.migrations.core import emotion_records
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending


def schema(path: Path) -> dict[str, str | None]:
    marks = ",".join("?" * len(emotion_records.TABLES))
    with sqlite3.connect(path) as db:
        rows = db.execute(f"SELECT name, sql FROM sqlite_master WHERE tbl_name IN ({marks})", emotion_records.TABLES)
        return dict(rows.fetchall())


def fresh(tmp_path: Path) -> Path:
    path = tmp_path / "fresh.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    engine.dispose()
    return path


def test_an_old_database_gets_the_same_tables_create_all_makes(tmp_path: Path):
    old = tmp_path / "old.db"
    with sqlite3.connect(old) as db:
        db.execute("CREATE TABLE api_connections (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
    for _ in range(2):
        conn = sqlite3.connect(old, isolation_level=None)
        report = apply_pending(conn, STEPS, app_version="test")
        conn.close()
        assert report.status == "ok", report.message
    built = schema(old)
    assert {"word_records", "pairings", "pairing_rows"} <= set(built)
    assert built == schema(fresh(tmp_path))


def test_one_record_per_word_and_one_shared_table_per_pair(tmp_path: Path):
    with sqlite3.connect(fresh(tmp_path)) as db:
        add_record = (
            "INSERT INTO word_records (list_ref, word, item, source, guessed, unstable, created_at, updated_at)"
            " VALUES ('pack:p1', '嘟嘴', ?, 'model', 1, 0, 'x', 'x')"
        )
        db.execute(add_record, ("s1",))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(add_record, ("s2",))
        add_table = (
            "INSERT INTO pairings (id, follower, list_ref, target, card_id, created_at, updated_at)"
            " VALUES (?, 'voice', 'pack:p1', 'v1', ?, 'x', 'x')"
        )
        db.execute(add_table, ("a", ""))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(add_table, ("b", ""))  # 共用的那张只能有一份
        db.execute(add_table, ("c", "k1"))  # 只给一张卡另存的可以再有一份
