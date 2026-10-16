"""库瘦身(app/storage/slim.py)。"""

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db import Base
from app.models import PackSprite, SceneAsset, ScenePack, SpritePack, TtsCache
from app.storage import refs, slim
from app.storage.blobs import sha_of, store
from app.storage.copy import copy_all

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x01" * 64


@pytest.fixture
def db(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "data" / "animabackend.db"
    path.parent.mkdir()
    monkeypatch.setattr(settings, "tts_cache_path", None)  # 缓存文件放在库旁边,和真用时一样
    monkeypatch.setattr(slim, "backend_running", lambda port=8000: False)
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as s:
        s.add(SpritePack(id="p", name="包"))
        s.add(PackSprite(id="a", pack_id="p", label="平静", image=PNG, mime="image/png"))
        s.add(ScenePack(id="sp", name="场景"))
        s.add(SceneAsset(id="m", pack_id="sp", kind="bgm", label="曲子", data=MP3, mime="audio/mpeg"))
        s.add(TtsCache(key="k1", data=b"RIFF1", mime="audio/wav", size=5))
        s.commit()
    copy_all(factory, store())
    engine.dispose()
    return path


def test_a_dry_run_changes_nothing(db: Path):
    before = db.read_bytes()
    r = slim.slim(db, store(), apply=False, log=lambda _: None)
    assert r.ok and r.rows == 2 and r.cache_rows == 1
    assert db.read_bytes() == before
    assert not db.with_name("tts-cache.db").exists()


def test_slim_nulls_the_originals_moves_the_cache_and_keeps_every_byte(db: Path):
    r = slim.slim(db, store(), apply=True, log=lambda _: None)
    assert r.ok, r.message
    assert (r.nulled, r.cache_rows) == (2, 1)
    assert Path(r.backup).exists()
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT image, image_sha FROM pack_sprites").fetchone() == (None, sha_of(PNG))
        assert c.execute("SELECT count(*) FROM tts_cache").fetchone()[0] == 0
        assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    with sqlite3.connect(db.with_name("tts-cache.db")) as c:
        assert c.execute("SELECT key, data FROM tts_cache").fetchall() == [("k1", b"RIFF1")]
    # 读的路径照旧拿到一模一样的字节
    engine = create_engine(f"sqlite:///{db.as_posix()}")
    with Session(engine) as s:
        assert refs.read_bytes(refs.SPRITE, s.get(PackSprite, "a"), s) == PNG
        assert refs.read_bytes(refs.SCENE_ASSET, s.get(SceneAsset, "m"), s) == MP3
    engine.dispose()


def test_one_bad_file_stops_everything(db: Path):
    store().path(sha_of(PNG), "image/png").write_bytes(b"broken")
    r = slim.slim(db, store(), apply=True, log=lambda _: None)
    assert not r.ok and r.bad and "仓库里的文件" in r.bad[0]
    assert r.backup is None
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT image FROM pack_sprites").fetchone()[0] == PNG


def test_it_refuses_while_the_backend_is_running(db: Path, monkeypatch):
    monkeypatch.setattr(slim, "backend_running", lambda port=8000: True)
    r = slim.slim(db, store(), apply=True, log=lambda _: None)
    assert not r.ok and "8000" in r.message


def test_read_only_tools_still_open_the_database_after_wal(db: Path):
    """迁移器报告、回放导出、export_userdata 都用 mode=ro 打开:开了 WAL 以后照样能读"""
    from app.migrations import startup

    assert slim.slim(db, store(), apply=True, log=lambda _: None).ok
    conn = startup.open_ro(db)
    try:
        assert conn.execute("SELECT count(*) FROM pack_sprites").fetchone()[0] == 1
    finally:
        conn.close()
    # 后端开着(有写连接、-wal 文件在)时也能只读打开
    writer = sqlite3.connect(db)
    writer.execute("UPDATE pack_sprites SET label = '微笑'")
    writer.commit()
    conn = startup.open_ro(db)
    try:
        assert conn.execute("SELECT label FROM pack_sprites").fetchone()[0] == "微笑"
    finally:
        conn.close()
        writer.close()
