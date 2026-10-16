"""语音缓存的单独文件(app/tts/cache_file.py):文件在才绑过去;全新安装直接建;主库里有缓存时等瘦身命令来搬。"""

import sqlite3
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.db import Base
from app.tts import cache as tts_cache
from app.tts import cache_file


def _main(tmp_path: Path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'main.db').as_posix()}")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, autoflush=False)


def _count(path: Path) -> int:
    with sqlite3.connect(path) as c:
        return c.execute("SELECT count(*) FROM tts_cache").fetchone()[0]


def test_a_fresh_install_gets_the_file_and_the_cache_goes_there(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "tts_cache_path", str(tmp_path / "tts-cache.db"))
    engine, factory = _main(tmp_path)
    assert cache_file.bind_at_startup(factory, engine) is not None
    with factory() as db:
        tts_cache.cache_put(db, "k1", b"RIFF", "audio/wav")
        assert tts_cache.cache_get(db, "k1") == (b"RIFF", "audio/wav")
    assert _count(tmp_path / "tts-cache.db") == 1
    assert _count(tmp_path / "main.db") == 0
    engine.dispose()


def test_an_old_database_keeps_its_cache_until_it_is_slimmed(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "tts_cache_path", str(tmp_path / "tts-cache.db"))
    engine, factory = _main(tmp_path)
    with factory() as db:
        tts_cache.cache_put(db, "old", b"RIFF", "audio/wav")
    assert cache_file.bind_at_startup(factory, engine) is None
    assert not (tmp_path / "tts-cache.db").exists()
    with factory() as db:
        assert tts_cache.cache_has(db, "old")
    engine.dispose()


def test_the_default_path_sits_next_to_the_database(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(settings, "tts_cache_path", None)
    db = tmp_path / "data" / "animabackend.db"
    assert cache_file.cache_path(f"sqlite:///{db.as_posix()}") == db.with_name("tts-cache.db")
    assert cache_file.cache_path("sqlite://") is None
