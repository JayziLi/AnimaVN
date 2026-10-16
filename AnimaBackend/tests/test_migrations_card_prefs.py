"""第 2 期的迁移步骤:按卡设置的新表 card_prefs(只建表)。"""

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.db import Base
from app.migrations.core import card_prefs
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending, read_ledger
from app.migrations.sqlite_util import table_exists


def schema(path: Path) -> dict[str, str | None]:
    with sqlite3.connect(path) as db:
        rows = db.execute("SELECT name, sql FROM sqlite_master WHERE tbl_name = 'card_prefs'")
        return dict(rows.fetchall())


def fresh(tmp_path: Path) -> Path:
    path = tmp_path / "fresh.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    engine.dispose()
    return path


def test_an_old_database_gets_the_same_table_create_all_makes(tmp_path: Path):
    old = tmp_path / "old.db"
    with sqlite3.connect(old) as db:
        db.execute("CREATE TABLE api_connections (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
    for _ in range(2):
        conn = sqlite3.connect(old, isolation_level=None)
        report = apply_pending(conn, STEPS, app_version="test")
        conn.close()
        assert report.status == "ok", report.message
    built = schema(old)
    assert "card_prefs" in built
    assert built == schema(fresh(tmp_path))


def test_an_empty_database_only_records_the_step(tmp_path: Path):
    # 新装的空库:只登记,表留给启动时的 create_all 建
    conn = sqlite3.connect(tmp_path / "empty.db", isolation_level=None)
    report = apply_pending(conn, STEPS, app_version="test")
    assert report.status == "ok", report.message
    assert card_prefs.STEP.id in read_ledger(conn)
    assert not table_exists(conn, "card_prefs")
    conn.close()


def test_one_value_per_card_and_key(tmp_path: Path):
    with sqlite3.connect(fresh(tmp_path)) as db:
        add = "INSERT INTO card_prefs (card_id, key, value, updated_at) VALUES (?, ?, '{}', 'x')"
        db.execute(add, ("c1", "plugin.cg"))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(add, ("c1", "plugin.cg"))
        db.execute(add, ("c1", "plugin.sprite"))
        db.execute(add, ("c2", "plugin.cg"))
