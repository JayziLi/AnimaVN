from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import TtsCache
from app.tts import cache


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def test_cache_key_is_stable_and_order_independent():
    a = cache.cache_key({"gpt": "a", "body": {"text": "你好", "sample_steps": 64}})
    b = cache.cache_key({"body": {"sample_steps": 64, "text": "你好"}, "gpt": "a"})
    assert a == b and len(a) == 64
    assert cache.cache_key({"gpt": "b", "body": {"text": "你好", "sample_steps": 64}}) != a


def test_cache_evicts_least_recently_used_over_limit(db: Session, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_LIMIT", 250)
    cache.cache_put(db, "a", b"x" * 100, "audio/wav")
    cache.cache_put(db, "b", b"y" * 100, "audio/wav")
    # a 最近用过,b 很久没用
    db.get(TtsCache, "a").last_used_at = datetime(2100, 1, 1, tzinfo=timezone.utc)
    db.get(TtsCache, "b").last_used_at = datetime(2000, 1, 1, tzinfo=timezone.utc)
    db.commit()

    cache.cache_put(db, "c", b"z" * 100, "audio/wav")

    assert cache.cache_get(db, "b") is None
    assert cache.cache_get(db, "a") == (b"x" * 100, "audio/wav")
    assert cache.cache_get(db, "c") == (b"z" * 100, "audio/wav")
    assert cache.cache_stats(db) == (2, 200)

    cache.cache_clear(db)
    assert cache.cache_stats(db) == (0, 0)


def test_cache_bookkeeping_never_scans_the_audio(db: Session, monkeypatch):
    """算总大小、挑最久没用的,都只走索引。size / last_used_at 排在音频后面,扫表就得把每段
    音频的数据页翻一遍:缓存到 500 MB 时每存一句要 0.7–1.3 秒(2026-09-30 实测)。"""
    monkeypatch.setattr(cache, "CACHE_LIMIT", 250)
    cache.cache_put(db, "a", b"x" * 100, "audio/wav")
    cache.cache_put(db, "b", b"y" * 100, "audio/wav")

    seen: list[tuple[str, tuple]] = []
    engine = db.get_bind()

    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            seen.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", record)
    try:
        cache.cache_put(db, "c", b"z" * 100, "audio/wav")  # 超过上限,走一遍淘汰
        cache.cache_stats(db)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert seen
    for statement, parameters in seen:
        plan = [row[3] for row in db.connection().exec_driver_sql("EXPLAIN QUERY PLAN " + statement, parameters)]
        for step in plan:
            assert "COVERING INDEX" in step or step.startswith("SEARCH"), (statement, plan)


def test_two_misses_on_the_same_line_both_save_instead_of_500(db: Session, monkeypatch):
    # 两个请求都没命中、都去合成:后到的那个查的时候先到的还没写,写的时候主键已经被占了
    cache.cache_put(db, "same", b"first", "audio/wav")
    monkeypatch.setattr(db, "get", lambda *_a, **_k: None)

    cache.cache_put(db, "same", b"second!", "audio/wav")

    monkeypatch.undo()
    assert cache.cache_get(db, "same") == (b"second!", "audio/wav")
    assert cache.cache_stats(db) == (1, len(b"second!"))
