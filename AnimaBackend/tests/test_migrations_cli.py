import hashlib
import sqlite3
from pathlib import Path

from app.migrations import __main__ as cli
from app.migrations import startup
from app.migrations.sqlite_util import columns


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_report_lists_pending_steps_and_writes_nothing(old_db: Path, capsys):
    before = digest(old_db)
    assert cli.main(["report", "--db", str(old_db)]) == 0
    out = capsys.readouterr().out
    assert "[待做] core.2026_09_connection_thinking" in out
    assert digest(old_db) == before


def test_rehearse_upgrades_a_copy_without_backup(old_db: Path, tmp_path: Path, monkeypatch, capsys):
    copy = tmp_path / "copy.db"
    copy.write_bytes(old_db.read_bytes())
    monkeypatch.setattr(startup, "db_path", lambda url=None: old_db)  # 「正在用的库」
    assert cli.main(["rehearse", "--db", str(copy)]) == 0
    db = sqlite3.connect(copy)
    assert "thinking" in columns(db, "api_connections")
    db.close()
    live = sqlite3.connect(old_db)
    assert "thinking" not in columns(live, "api_connections")
    live.close()
    assert not (tmp_path / "backups").exists()


def test_rehearse_refuses_the_live_database(old_db: Path, monkeypatch, capsys):
    monkeypatch.setattr(startup, "db_path", lambda url=None: old_db)
    before = digest(old_db)
    assert cli.main(["rehearse", "--db", str(old_db)]) == 2
    assert "副本" in capsys.readouterr().out
    assert digest(old_db) == before


def test_apply_backs_up_first(old_db: Path, capsys):
    assert cli.main(["apply", "--db", str(old_db)]) == 0
    assert len(list(startup.backups_dir(old_db).glob(f"{startup.BACKUP_PREFIX}*"))) == 1
    assert "升级前的备份" in capsys.readouterr().out


def test_a_missing_database_is_an_error(tmp_path: Path, capsys):
    assert cli.main(["report", "--db", str(tmp_path / "nope.db")]) == 2
    assert "找不到库" in capsys.readouterr().out
