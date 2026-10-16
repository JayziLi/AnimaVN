"""文件仓库的读写(app/storage/blobs.py)。"""

import hashlib
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Base
from app.migrations.core import blob_store
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending, read_ledger
from app.migrations.sqlite_util import columns, index_exists, table_exists
from app.models import Blob
from app.storage.blobs import BlobStore, default_root, ext_of, relpath, sha_of


def test_layout_is_two_hex_folders_and_the_type_extension(tmp_path: Path):
    data = b"\x89PNG fake"
    sha = hashlib.sha256(data).hexdigest()
    assert sha_of(data) == sha
    assert relpath(sha, "image/png") == f"{sha[:2]}/{sha}.png"
    assert [ext_of(m) for m in ("image/jpeg", "audio/mpeg", "audio/x-wav", "AUDIO/OGG", "text/plain")] == [
        "jpg",
        "mp3",
        "wav",
        "ogg",
        "bin",
    ]


def test_put_writes_once_and_reads_back_the_same_bytes(tmp_path: Path):
    store = BlobStore(tmp_path)
    sha = store.put(b"hello", "image/png")
    path = store.path(sha, "image/png")
    assert path.read_bytes() == b"hello"
    mtime = path.stat().st_mtime_ns
    assert store.put(b"hello", "image/png") == sha
    assert path.stat().st_mtime_ns == mtime  # 已经在了:不再写
    assert store.read(sha, "image/png") == b"hello"
    assert store.verify(sha, "image/png")
    assert not list(tmp_path.rglob("*.tmp-*"))


def test_a_missing_or_damaged_file_is_noticed(tmp_path: Path):
    store = BlobStore(tmp_path)
    sha = store.put(b"hello", "image/png")
    store.path(sha, "image/png").write_bytes(b"hellO")
    assert not store.verify(sha, "image/png")
    other = "0" * 64
    assert store.read(other, "image/png") is None
    assert not store.verify(other, "image/png")
    with pytest.raises(ValueError):
        store.path("../../etc/passwd", "image/png")
    assert store.read("not-a-sha", "image/png") is None


def test_put_records_each_file_once_in_the_table(tmp_path: Path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'db.sqlite').as_posix()}")
    Base.metadata.create_all(bind=engine)
    store = BlobStore(tmp_path / "blobs")
    with Session(engine) as db:
        a = store.put(b"a", "image/png", db)
        store.put(b"a", "image/png", db)  # 同一个事务里放两次
        db.commit()
        store.put(b"a", "image/png", db)
        db.commit()
        rows = db.query(Blob).all()
        assert [(r.sha, r.mime, r.size) for r in rows] == [(a, "image/png", 1)]
        assert store.mime_of(db, a) == "image/png"
    engine.dispose()


def test_leftover_temp_files_are_cleared(tmp_path: Path):
    store = BlobStore(tmp_path)
    sha = store.put(b"x", "image/png")
    junk = store.path(sha, "image/png").with_name("zz.png.tmp-1-2")
    junk.write_bytes(b"half")
    assert store.clear_temp() == 1
    assert not junk.exists()
    assert store.read(sha, "image/png") == b"x"


def test_default_root_sits_next_to_the_database(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(settings, "blob_dir", None)
    db = tmp_path / "data" / "animabackend.db"
    assert default_root(f"sqlite:///{db.as_posix()}") == db.parent / "blobs"
    monkeypatch.setattr(settings, "blob_dir", str(tmp_path / "x"))
    assert default_root(f"sqlite:///{db.as_posix()}") == tmp_path / "x"


# ── 迁移步骤 core.2026_10_blob_store ──


def test_an_old_database_gets_the_tables_columns_and_indexes(tmp_path: Path):
    old = tmp_path / "old.db"
    with sqlite3.connect(old) as db:
        db.execute("CREATE TABLE pack_sprites (id TEXT PRIMARY KEY, image BLOB, mime TEXT)")
        db.execute("CREATE TABLE scene_assets (id TEXT PRIMARY KEY, data BLOB, mime TEXT)")
        db.execute("INSERT INTO pack_sprites VALUES ('s1', x'00', 'image/png')")
    for _ in range(2):
        conn = sqlite3.connect(old, isolation_level=None)
        report = apply_pending(conn, STEPS, app_version="test")
        conn.close()
        assert report.status == "ok", report.message
    with sqlite3.connect(old) as db:
        assert table_exists(db, "blobs") and table_exists(db, "maintenance_jobs")
        assert "image_sha" in columns(db, "pack_sprites") and "data_sha" in columns(db, "scene_assets")
        assert index_exists(db, "pack_sprites", "ix_pack_sprites_image_sha")
        assert index_exists(db, "scene_assets", "ix_scene_assets_data_sha")
        # 原件一个字节不动,指纹先空着(复制是后台任务的事)
        assert db.execute("SELECT image, image_sha FROM pack_sprites").fetchone() == (b"\x00", None)


def test_an_empty_database_only_records_the_step(tmp_path: Path):
    conn = sqlite3.connect(tmp_path / "empty.db", isolation_level=None)
    report = apply_pending(conn, STEPS, app_version="test")
    assert report.status == "ok", report.message
    assert blob_store.STEP.id in read_ledger(conn)
    assert not table_exists(conn, "blobs")
    conn.close()
