"""迁移器接进启动:只读报告、升级前备份、失败时挡住接口。"""

import hashlib
import sqlite3
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.migrations import startup, state
from app.migrations.runner import LEDGER, MigrationReport
from app.migrations.sqlite_util import columns, table_exists


def url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_report_mode_only_reads(old_db: Path):
    before = digest(old_db)
    report = startup.run("test", mode="report", url=url(old_db))
    assert report.status == "pending"
    assert "core.2026_09_connection_thinking" in {s.id for s in report.of("pending")}
    assert digest(old_db) == before
    assert not startup.backups_dir(old_db).exists()
    assert state.current.report is report
    assert state.current.gate == "open"


def test_apply_mode_backs_up_first_then_upgrades(old_db: Path):
    report = startup.run("test", mode="apply", url=url(old_db))
    assert report.status == "ok", report.message
    backups = sorted(startup.backups_dir(old_db).glob(f"{startup.BACKUP_PREFIX}*"))
    assert [str(p) for p in backups] == [report.backup]
    copy = sqlite3.connect(backups[0])
    assert "thinking" not in columns(copy, "api_connections")  # 备份是升级前的样子
    assert not table_exists(copy, LEDGER)
    copy.close()
    db = sqlite3.connect(old_db)
    assert "thinking" in columns(db, "api_connections")
    assert db.execute(f"SELECT count(*) FROM {LEDGER}").fetchone()[0] > 0
    db.close()
    assert not startup.flag_path(old_db).exists()


def test_nothing_to_do_means_no_backup(old_db: Path):
    startup.run("test", mode="apply", url=url(old_db))
    startup.run("test", mode="apply", url=url(old_db))
    assert len(list(startup.backups_dir(old_db).glob(f"{startup.BACKUP_PREFIX}*"))) == 1


def test_only_the_three_newest_backups_are_kept(old_db: Path):
    folder = startup.backups_dir(old_db)
    folder.mkdir()
    for stamp in ("20261001-000000", "20261002-000000", "20261003-000000"):
        (folder / f"{startup.BACKUP_PREFIX}{stamp}").write_bytes(b"old")
    (folder / "别的文件.txt").write_bytes(b"keep")
    made = startup.backup(old_db, now=datetime(2026, 10, 10, 12, 0, 0))
    assert made.endswith(f"{startup.BACKUP_PREFIX}20261010-120000")
    assert sorted(p.name for p in folder.iterdir()) == [
        f"{startup.BACKUP_PREFIX}20261002-000000",
        f"{startup.BACKUP_PREFIX}20261003-000000",
        f"{startup.BACKUP_PREFIX}20261010-120000",
        "别的文件.txt",
    ]


def test_not_enough_disk_space_changes_nothing(old_db: Path, monkeypatch):
    before = digest(old_db)
    monkeypatch.setattr(startup.shutil, "disk_usage", lambda _path: SimpleNamespace(total=10, used=9, free=1))
    report = startup.run("test", mode="apply", url=url(old_db))
    assert report.status == "failed"
    assert "磁盘空间不够" in report.message
    assert digest(old_db) == before
    assert state.current.gate == "closed"


def test_a_fresh_install_has_nothing_to_migrate(tmp_path: Path):
    report = startup.run("test", mode="apply", url=url(tmp_path / "data" / "animabackend.db"))
    assert report.status == "ok"
    assert not (tmp_path / "data").exists()  # 建库是 create_all 的事


def test_off_mode_does_nothing(old_db: Path):
    before = digest(old_db)
    assert startup.run("test", mode="off", url=url(old_db)).status == "skipped"
    assert digest(old_db) == before


def test_an_unwritable_data_folder_gives_a_failed_report(old_db: Path, monkeypatch):
    monkeypatch.setattr(startup, "flag_path", lambda db: db.parent / "没有这个文件夹" / "x.migrating")
    before = digest(old_db)
    report = startup.run("test", mode="apply", url=url(old_db))
    assert report.status == "failed"
    assert state.current.gate == "closed"
    assert digest(old_db) == before


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("sqlite:///C:/data/animabackend.db", Path("C:/data/animabackend.db")),
        ("sqlite:////srv/anima/data/animabackend.db", Path("/srv/anima/data/animabackend.db")),
        ("sqlite://", None),
        ("sqlite:///:memory:", None),
        ("postgresql://anima@db/anima", None),
    ],
)
def test_db_path(raw: str, expected: Path | None):
    assert startup.db_path(raw) == expected


def test_a_failed_upgrade_closes_everything_but_health(client: TestClient):
    state.set_report(MigrationReport("apply", "failed", message="升级「宠物加上名牌」这一步没成功"))
    blocked = client.post("/api/connections", json={})
    assert blocked.status_code == 503
    assert blocked.json()["detail"] == "升级「宠物加上名牌」这一步没成功"
    assert client.get("/api/connections").status_code == 503
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "degraded"
    assert health.json()["db"] == "failed"


def test_a_database_from_a_newer_version_is_read_only(client: TestClient):
    state.set_report(MigrationReport("report", "blocked", message="这个数据库被更新版本的 AnimaVN 升级过"))
    assert client.get("/api/connections").status_code == 200
    blocked = client.post("/api/connections", json={})
    assert blocked.status_code == 503
    assert "更新版本" in blocked.json()["detail"]


def test_blocked_responses_still_carry_cors_headers(client: TestClient):
    state.set_report(MigrationReport("apply", "failed", message="升级没成功"))
    origin = "http://localhost:5173"
    response = client.post("/api/connections", json={}, headers={"Origin": origin})
    assert response.status_code == 503
    assert response.headers.get("access-control-allow-origin") == origin


def test_health_when_all_is_well(client: TestClient):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["db"] == "unknown"  # 这个夹具不进 lifespan,迁移器没跑
