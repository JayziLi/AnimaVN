"""第 4 步 B1:声音的文件指纹列、文件仓库认模型、清理时认得声音的指纹;老声音的请求体和缓存键一字不变。

缓存键的常数是加列以前的代码算出来的(2026-10-17,改 models.py 之前跑的):以后谁动了请求体或缓存键的原料,这里就会红。
"""

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending
from app.migrations.sqlite_util import columns
from app.storage import blobs, maintenance
from app.tts import cache as tts_cache

# ── 老声音:请求体和缓存键 ──


def _gsv_voice(client: TestClient) -> tuple[dict, dict]:
    conn = client.post("/api/tts/connections", json={"name": "5090", "base_url": "http://gsv.test:9880"}).json()
    voice = client.post(
        "/api/voices",
        json={
            "name": "刻晴(日语)",
            "connection_id": conn["id"],
            "gpt_weights": "G:/AnimaVoice/models/刻晴_ja/刻晴_JA-e10.ckpt",
            "sovits_weights": "G:/AnimaVoice/models/刻晴_ja/刻晴_JA_e10_s460_l32.pth",
            "text_lang": "ja",
            "speed": 1.1,
            "params": {"sample_steps": 128, "top_k": 12, "text_split_method": "cut0"},
        },
    ).json()
    for label, path, aux in (
        ("平静", "G:/AnimaVoice/refs/刻晴_ja/【平静】今日もいい天気ね.wav", []),
        ("开心", "G:/AnimaVoice/refs/刻晴_ja/【开心】やった!.wav", ["G:/AnimaVoice/refs/刻晴_ja/aux1.wav"]),
    ):
        r = client.post(
            f"/api/voices/{voice['id']}/emotions",
            json={"label": label, "ref_path": path, "prompt_text": "", "aux_refs": aux},
        )
        assert r.status_code == 200, r.text
    return conn, voice


def _explain(client: TestClient, voice_id: str, emotion: str) -> dict:
    r = client.post("/api/tts/explain", json={"profile_id": voice_id, "text": "おはよう。", "emotion": emotion})
    assert r.status_code == 200, r.text
    return r.json()


GSV_CALM_REQUEST = {
    "text": "おはよう。",
    "text_lang": "ja",
    "ref_audio_path": "G:/AnimaVoice/refs/刻晴_ja/【平静】今日もいい天気ね.wav",
    "prompt_text": "今日もいい天気ね",
    "prompt_lang": "ja",
    "media_type": "wav",
    "text_split_method": "cut0",
    "sample_steps": 128,
    "speed_factor": 1.1,
    "streaming_mode": False,
    "top_k": 12,
}
GSV_CALM_KEY = "bbe33efcd9c5193a876d9e00ee68b9a8fbad86c0ab44b098c8592e428edb3b62"
GSV_HAPPY_KEY = "1a8d9d7552b87c4606ed865cc3d3819d8b8f4ee741a8fdece21637b13642425b"
INDEX_KEY = "3ccd1b0a9e24ca57c754992e7b2b0403fb547850462ed533174187c42a719ccc"


def _key(client: TestClient, voice_id: str, emotion: str) -> str:
    from app.api.tts import _material, _voice_for
    from app.db import get_db
    from app.main import app
    from app.tts.registry import engine_for

    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        v = _voice_for(voice_id, emotion, db)
        return tts_cache.cache_key(_material("おはよう。", v, engine_for(v.conn), None))
    finally:
        gen.close()


def test_old_gsv_voice_request_body_and_cache_key_are_unchanged(client: TestClient):
    _, voice = _gsv_voice(client)
    calm = _explain(client, voice["id"], "平静")
    assert calm["request"] == GSV_CALM_REQUEST
    assert calm["gpt_weights"] == "G:/AnimaVoice/models/刻晴_ja/刻晴_JA-e10.ckpt"
    happy = _explain(client, voice["id"], "开心")
    assert happy["request"]["aux_ref_audio_paths"] == ["G:/AnimaVoice/refs/刻晴_ja/aux1.wav"]
    assert _key(client, voice["id"], "平静") == GSV_CALM_KEY
    assert _key(client, voice["id"], "开心") == GSV_HAPPY_KEY


def test_old_indextts_voice_cache_key_is_unchanged(client: TestClient):
    conn = client.post(
        "/api/tts/connections",
        json={"name": "IndexTTS", "api_type": "indextts", "base_url": "http://index.test:9890", "emo_alpha": 0.8},
    ).json()
    voice = client.post(
        "/api/voices",
        json={"name": "爱弥斯", "connection_id": conn["id"], "ref_path": "D:/AnimaVoice/refs/aemeath/spk.wav", "text_lang": "zh"},
    ).json()
    client.post(
        f"/api/voices/{voice['id']}/emotions",
        json={"label": "开心", "ref_path": "", "prompt_text": "", "emo_vector": [0.8, 0, 0, 0, 0, 0, 0, 0]},
    )
    assert _key(client, voice["id"], "开心") == INDEX_KEY


def test_old_voices_report_their_files_as_typed_by_hand(client: TestClient):
    _, voice = _gsv_voice(client)
    got = client.get("/api/voices").json()[0]
    assert got["files_at"] == "manual"
    assert got["source"] == "" and got["license"] == ""


# ── 迁移 ──

OLD_VOICE_TABLES = """
CREATE TABLE voice_profiles (
    id VARCHAR(32) NOT NULL PRIMARY KEY, name VARCHAR(80) NOT NULL, aliases JSON NOT NULL,
    connection_id VARCHAR(32) NOT NULL, gpt_weights VARCHAR(500) NOT NULL, sovits_weights VARCHAR(500) NOT NULL,
    ref_path VARCHAR(500) NOT NULL, text_lang VARCHAR(12) NOT NULL, speed FLOAT NOT NULL, params JSON NOT NULL,
    created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
CREATE TABLE voice_emotions (
    id VARCHAR(32) NOT NULL PRIMARY KEY, profile_id VARCHAR(32) NOT NULL, label VARCHAR(80) NOT NULL,
    aliases JSON NOT NULL, ref_path VARCHAR(500) NOT NULL, prompt_text TEXT NOT NULL, aux_refs JSON NOT NULL,
    emo_vector JSON, sort INTEGER NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
"""


def test_migration_adds_file_columns_and_marks_old_voices_manual(tmp_path: Path):
    from sqlalchemy import create_engine

    from app.db import Base

    path = tmp_path / "old.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    engine.dispose()
    conn = sqlite3.connect(path)
    conn.executescript("DROP TABLE voice_profiles; DROP TABLE voice_emotions;" + OLD_VOICE_TABLES)
    now = "2026-10-10 00:00:00.000000"
    conn.execute(
        "INSERT INTO voice_profiles VALUES ('v1', '刻晴', '[]', 'c1', 'G:/a.ckpt', 'G:/a.pth', '', 'ja', 1.0, '{}', ?, ?)",
        (now, now),
    )
    conn.execute(
        "INSERT INTO voice_emotions VALUES ('e1', 'v1', '平静', '[]', 'G:/r.wav', '原文', '[]', NULL, 0, ?, ?)", (now, now)
    )
    conn.commit()
    conn.close()

    conn = sqlite3.connect(path, isolation_level=None)
    report = apply_pending(conn, STEPS, app_version="test")
    assert report.status == "ok", report.message
    assert {"gpt_sha", "gpt_size", "gpt_name", "sovits_sha", "sovits_size", "sovits_name", "speaker_sha", "source",
            "license", "files_at"} <= columns(conn, "voice_profiles")
    assert {"ref_sha", "aux_shas"} <= columns(conn, "voice_emotions")
    assert conn.execute("SELECT files_at, gpt_weights, gpt_sha FROM voice_profiles").fetchone() == ("manual", "G:/a.ckpt", None)
    assert conn.execute("SELECT ref_path, ref_sha, aux_shas FROM voice_emotions").fetchone() == ("G:/r.wav", None, "[]")
    conn.close()


# ── 文件仓库 ──


def test_blob_store_keeps_model_extensions(tmp_path: Path):
    assert blobs.mime_for_name("刻晴_JA-e10.ckpt") == blobs.CKPT_MIME
    assert blobs.mime_for_name("a_e10_s460_l32.PTH") == blobs.PTH_MIME
    assert blobs.mime_for_name("【平静】x.wav") == "audio/wav"
    assert blobs.mime_for_name("x.mp3") == "audio/mpeg"
    assert blobs.ext_of(blobs.CKPT_MIME) == "ckpt" and blobs.ext_of(blobs.PTH_MIME) == "pth"
    store = blobs.BlobStore(tmp_path / "blobs")
    src = tmp_path / "big.ckpt"
    src.write_bytes(b"model" * 100_000)
    sha = store.put_path(src, blobs.CKPT_MIME)
    assert sha == blobs.sha_of(src.read_bytes())
    assert store.path(sha, blobs.CKPT_MIME).name == f"{sha}.ckpt"
    assert store.read(sha, blobs.CKPT_MIME) == src.read_bytes()
    assert src.is_file()  # 不 move 时原文件留着
    moved = tmp_path / "moved.pth"
    moved.write_bytes(b"pth")
    sha2 = store.put_path(moved, blobs.PTH_MIME, move=True)
    assert not moved.exists() and store.has(sha2, blobs.PTH_MIME)


def test_cleanup_counts_voice_fingerprints_as_used(tmp_path: Path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.db import Base
    from app.models import TtsConnection, VoiceEmotion, VoiceProfile

    path = tmp_path / "lib.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(TtsConnection(id="c1", name="本机", base_url="http://127.0.0.1:9880"))
        db.add(VoiceProfile(id="v1", name="刻晴", connection_id="c1", gpt_sha="a" * 64, sovits_sha="b" * 64, speaker_sha="c" * 64))
        db.add(VoiceEmotion(id="e1", profile_id="v1", label="平静", ref_sha="d" * 64, aux_shas=["e" * 64, None]))
        db.commit()
    engine.dispose()
    conn = sqlite3.connect(path)
    try:
        assert {"a" * 64, "b" * 64, "c" * 64, "d" * 64, "e" * 64} <= maintenance.shas_in(conn)
    finally:
        conn.close()


def test_changing_a_path_forgets_that_files_fingerprint(client: TestClient):
    from app.db import get_db
    from app.main import app
    from app.models import VoiceEmotion, VoiceProfile

    _, voice = _gsv_voice(client)
    calm, happy = client.get("/api/voices").json()[0]["emotions"]
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    p = db.get(VoiceProfile, voice["id"])
    p.gpt_sha, p.gpt_size, p.gpt_name, p.sovits_sha, p.files_at = "a" * 64, 10, "a.ckpt", "b" * 64, "local"
    db.get(VoiceEmotion, calm["id"]).ref_sha = "c" * 64
    e = db.get(VoiceEmotion, happy["id"])
    e.ref_sha, e.aux_shas = "d" * 64, ["e" * 64]
    db.commit()
    gen.close()

    client.put(f"/api/voices/{voice['id']}", json={"gpt_weights": "D:/new.ckpt", "sovits_weights": voice["sovits_weights"]})
    client.put(f"/api/voices/{voice['id']}/emotions/{calm['id']}", json={"prompt_text": "改原文不动指纹"})
    client.put(
        f"/api/voices/{voice['id']}/emotions/{happy['id']}",
        json={"ref_path": "D:/new.wav", "aux_refs": [*happy["aux_refs"], "D:/aux2.wav"]},
    )
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    p = db.get(VoiceProfile, voice["id"])
    assert (p.gpt_sha, p.gpt_size, p.gpt_name) == (None, None, "")
    assert p.sovits_sha == "b" * 64 and p.files_at == "local"
    assert db.get(VoiceEmotion, calm["id"]).ref_sha == "c" * 64
    e = db.get(VoiceEmotion, happy["id"])
    assert e.ref_sha is None and e.aux_shas == ["e" * 64, None]
    gen.close()
