"""文件仓库的维护:清理、体检、手动备份、命令行、设置页接口(app/storage/maintenance.py、__main__.py)。"""

import os
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.migrations import startup
from app.models import Blob, PackSprite, SpritePack
from app.storage import maintenance, refs
from app.storage.__main__ import main as cli
from app.storage.blobs import sha_of, store
from app.storage.copy import copy_all

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
NOW = datetime(2026, 10, 11, 12, 0, 0)


@pytest.fixture
def live(tmp_path: Path):
    """<tmp>/data/animabackend.db:一个立绘包,两张带图的立绘(还没复制进仓库)"""
    db = tmp_path / "data" / "animabackend.db"
    db.parent.mkdir()
    engine = create_engine(f"sqlite:///{db.as_posix()}")
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as s:
        s.add(SpritePack(id="p", name="包"))
        s.add(PackSprite(id="a", pack_id="p", label="平静", image=PNG, mime="image/png"))
        s.add(PackSprite(id="b", pack_id="p", label="开心", image=PNG + b"b", mime="image/png"))
        s.commit()
    yield db, factory
    engine.dispose()


def _age(path: Path, hours: float) -> None:
    t = (NOW - timedelta(hours=hours)).timestamp()
    os.utime(path, (t, t))


def test_clean_keeps_what_the_database_or_a_backup_needs(live):
    db, factory = live
    blobs = store()
    copy_all(factory, blobs)
    # 备份里还是 b 的旧图;之后库里的 b 换成了新图
    maintenance.backup_now(db)
    old_b = sha_of(PNG + b"b")
    with factory() as s:
        row = s.get(PackSprite, "b")
        refs.save(refs.SPRITE, row, PNG + b"new", "image/png", s)
        s.commit()
    orphan = blobs.put(b"\x89PNG orphan", "image/png")
    young = blobs.put(b"\x89PNG young", "image/png")
    for sha in (sha_of(PNG), old_b, sha_of(PNG + b"new"), orphan):
        _age(blobs.path(sha, "image/png"), 48)
    _age(blobs.path(young, "image/png"), 2)

    result = maintenance.clean(db, blobs, now=NOW)
    assert (result.kept, result.moved, result.young) == (3, 1, 1)
    assert not blobs.has(orphan, "image/png")
    assert (maintenance.trash_root(blobs) / "20261011" / blobs.path(orphan, "image/png").name).is_file()
    assert blobs.has(old_b, "image/png")  # 只有备份要它,也留着
    with factory() as s:
        assert orphan not in s.scalars(select(Blob.sha)).all()


def test_old_trash_is_purged_after_thirty_days(live):
    db, _ = live
    blobs = store()
    old = maintenance.trash_root(blobs) / "20260901"
    old.mkdir(parents=True)
    (old / "x.png").write_bytes(b"x")
    recent = maintenance.trash_root(blobs) / "20261001"
    recent.mkdir()
    assert maintenance.clean(db, blobs, now=NOW).purged == 1
    assert not old.exists() and recent.exists()


def test_an_unreadable_backup_stops_the_clean(live):
    db, factory = live
    blobs = store()
    orphan = blobs.put(b"\x89PNG orphan", "image/png")
    _age(blobs.path(orphan, "image/png"), 48)
    folder = startup.backups_dir(db)
    folder.mkdir()
    (folder / f"{startup.MANUAL_PREFIX}20261010-000000").write_bytes(b"not a database" * 100)
    with pytest.raises(RuntimeError, match="先不清理"):
        maintenance.clean(db, blobs, now=NOW)
    assert blobs.has(orphan, "image/png")


def test_check_finds_missing_and_damaged_files(live):
    db, factory = live
    blobs = store()
    copy_all(factory, blobs)
    assert maintenance.check(db, blobs, deep=True).ok
    blobs.path(sha_of(PNG), "image/png").unlink()
    blobs.path(sha_of(PNG + b"b"), "image/png").write_bytes(b"bad")
    shallow = maintenance.check(db, blobs)
    assert (shallow.missing, shallow.restorable, shallow.damaged) == (["立绘 a"], 1, [])
    deep = maintenance.check(db, blobs, deep=True)
    assert deep.damaged == ["立绘 b"]


def test_manual_backups_keep_the_newest_five(live):
    db, _ = live
    for i in range(7):
        startup.backup(db, now=NOW + timedelta(minutes=i), prefix=startup.MANUAL_PREFIX, keep=maintenance.KEEP_MANUAL)
    names = [p.name for p in maintenance.backup_files(db)]
    assert len(names) == 5 and names[-1].endswith("20261011-120600")


def test_cli_copy_then_verify_byte_for_byte(live, capsys):
    db, _ = live
    assert cli(["copy", "--db", str(db)]) == 0
    assert cli(["verify", "--db", str(db)]) == 0
    assert "全部一致" in capsys.readouterr().out
    assert cli(["check", "--db", str(db), "--deep"]) == 0
    store().path(sha_of(PNG), "image/png").write_bytes(b"bad")
    assert cli(["verify", "--db", str(db)]) == 1
    assert cli(["check", "--db", str(db), "--deep"]) == 1


def test_storage_endpoints(client: TestClient, make_sprite_pack, monkeypatch, live):
    # 测试用的是内存库:备份、清理、体检做不了
    monkeypatch.setattr(startup, "db_path", lambda url=None: None)
    pack = make_sprite_pack()
    base = f"/api/sprite-packs/{pack['id']}/sprites"
    sprite = client.post(base, json={"label": "平静"}).json()
    client.put(f"{base}/{sprite['id']}/image", files={"file": ("a.png", PNG, "image/png")})
    got = client.get("/api/meta/storage").json()
    assert (got["enabled"], got["files"], got["bytes"], got["pending"]) == (True, 1, len(PNG), 0)
    assert (got["copy"], got["db_bytes"]) == (None, None)
    assert client.post("/api/meta/backup").status_code == 400

    db, _ = live
    monkeypatch.setattr(startup, "db_path", lambda url=None: db)
    made = client.post("/api/meta/backup").json()
    assert made["name"].startswith(startup.MANUAL_PREFIX)
    assert client.get("/api/meta/migrations").json()["last_backup"]["name"] == made["name"]
    assert client.post("/api/meta/storage/check").json()["ok"] is True
    assert client.post("/api/meta/storage/clean").json()["moved"] == 0

    assert maintenance.busy.acquire(blocking=False)
    try:
        assert client.post("/api/meta/storage/check").status_code == 409
    finally:
        maintenance.busy.release()
