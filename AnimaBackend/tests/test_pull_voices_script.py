"""scripts/pull_voices_to_store.py:只报告缺文件的声音;--run 才拉,路径列不动。"""

import asyncio
import importlib.util
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import VoiceEmotion, VoiceProfile
from tests.bundle_seed import seed

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "pull_voices_to_store.py"


def _load():
    spec = importlib.util.spec_from_file_location("pull_voices_to_store", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def lib(db):
    ids = seed(db)  # 刻晴声音:文件都在仓库里
    db.add(VoiceProfile(id="v2", name="琴柳", connection_id=ids["tts"], gpt_weights="D:/m/q.ckpt", sovits_weights="G:/m/q.pth"))
    db.add(VoiceEmotion(id="q1", profile_id="v2", label="平静", ref_path="D:/r/平静.wav", prompt_text="嗯"))
    db.commit()
    return ids


def test_plan_lists_only_voices_with_missing_files(db, lib):
    mod = _load()
    assert mod.plan(db) == [("v2", "琴柳", 3)]


def test_run_pulls_each_voice_once_and_leaves_paths_alone(db, lib, monkeypatch, capsys):
    mod = _load()
    calls = []

    async def fake(db_, voice_ids, **kw):
        calls.append(list(voice_ids))
        return {voice_ids[0]: 1}

    monkeypatch.setattr(mod, "prefetch_voice_files", fake)
    left = asyncio.run(mod.run(db))
    assert calls == [["v2"]] and left == 1
    out = capsys.readouterr().out
    assert "琴柳" in out and "还缺 1" in out
    db.expire_all()
    assert db.get(VoiceProfile, "v2").gpt_weights == "D:/m/q.ckpt"
