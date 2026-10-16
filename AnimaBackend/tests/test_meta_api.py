import os
from pathlib import Path

from fastapi.testclient import TestClient

from app.migrations import startup, state
from app.migrations.runner import MigrationReport, StepState


def test_reports_the_startup_result(client: TestClient, monkeypatch, tmp_path: Path):
    monkeypatch.setattr(startup, "db_path", lambda url=None: tmp_path / "data" / "animabackend.db")
    state.set_report(
        MigrationReport(
            "report",
            "pending",
            steps=[
                StepState("core.a", "甲", "applied"),
                StepState("core.b", "乙", "detected"),
                StepState("core.c", "丙", "pending"),
                StepState("play.d", "丁", "unknown", compat="additive"),
            ],
        )
    )
    body = client.get("/api/meta/migrations").json()
    assert (body["mode"], body["status"]) == ("report", "pending")
    assert (body["applied"], body["detected"]) == (1, 1)
    assert body["pending"] == [{"id": "core.c", "title": "丙"}]
    assert body["unknown"] == [{"id": "play.d", "title": "丁", "compat": "additive"}]
    assert body["last_backup"] is None
    assert body["app_version"]


def test_last_backup_is_the_newest_of_both_kinds(client: TestClient, monkeypatch, tmp_path: Path):
    data = tmp_path / "data"
    (data / "backups").mkdir(parents=True)
    db = data / "animabackend.db"
    db.write_bytes(b"x")
    manual = data / "animabackend.db.bak-20261010-0134-重设计前"
    auto = data / "backups" / f"{startup.BACKUP_PREFIX}20261009-120000"
    manual.write_bytes(b"12345")
    auto.write_bytes(b"1")
    os.utime(auto, (1_000_000, 1_000_000))
    os.utime(manual, (2_000_000, 2_000_000))
    monkeypatch.setattr(startup, "db_path", lambda url=None: db)
    body = client.get("/api/meta/migrations").json()
    assert body["last_backup"]["name"] == manual.name
    assert body["last_backup"]["size"] == 5


def test_without_a_startup_result(client: TestClient):
    body = client.get("/api/meta/migrations").json()
    assert (body["mode"], body["status"]) == ("off", "skipped")
