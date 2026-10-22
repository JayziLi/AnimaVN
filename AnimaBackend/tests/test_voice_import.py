"""第 4 步 B4:带声音的角色包 / 单独的声音包接进导入流程,「另一台电脑」那条路(files.zip、placed),全走 HTTP。

库是 tests/bundle_seed.py 那份:声音挂在台式机(10.0.0.2,不是本机)上,文件已经在仓库里。
"""

import io
import zipfile

import pytest
from sqlalchemy import func, select

from app.bundle import write
from app.db import Base, get_db
from app.importer import staging
from app.main import app
from app.models import TtsConnection, VoiceEmotion, VoiceProfile
from app.storage.blobs import sha_of
from tests.bundle_seed import VOICE_FILES, seed

API = "/api/import"


@pytest.fixture(autouse=True)
def export_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(write, "TMP_DIR", tmp_path / "export-tmp")


@pytest.fixture
def lib(client):
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    ids = seed(session)
    yield client, ids, session
    gen.close()


def _counts(db) -> dict:
    db.expire_all()
    return {
        t.name: db.scalar(select(func.count()).select_from(t))
        for t in Base.metadata.sorted_tables
        if t.name not in ("import_jobs", "blobs")
    }


def _plan(client, name: str, data: bytes, status: int = 200) -> dict:
    r = client.post(f"{API}/plan", files=[("files", (name, data))])
    assert r.status_code == status, r.text
    return r.json()


def _apply(client, plan: dict, options: dict | None = None, status: int = 200) -> dict:
    r = client.post(f"{API}/{plan['plan_id']}/apply", json={"options": options or {}})
    assert r.status_code == status, r.text
    return r.json()


def test_bundle_plan_lists_the_voice_and_where_it_will_go(lib):
    client, ids, db = lib
    data = client.post(f"/api/export/bundle/{ids['main']}", json={}).content
    plan = _plan(client, "刻晴.animavn", data)
    d = plan["groups"][0]["detail"]
    assert d["has_voice"] is True
    assert d["voices"] == [
        {
            "name": "刻晴声音",
            "detail": "3 段参考 + 2 个模型",
            "connection": {"id": ids["tts"], "name": "台式机", "local": False},
            "missing": 0,
        }
    ]
    assert all(p["kind"] != "voice" for p in d["packs"])

    # 选本机的语音服务:导完路径就指向仓库里的文件
    local = client.post("/api/tts/connections", json={"name": "本机", "base_url": "http://127.0.0.1:9880"}).json()
    before = _counts(db)
    out = _apply(client, plan, {plan["groups"][0]["key"]: {"preset": False, "connection_id": local["id"]}})
    (vid,) = out["created"]["voices"]
    v = client.get("/api/voices").json()
    new = next(x for x in v if x["id"] == vid)
    assert new["connection_id"] == local["id"] and new["files_at"] == "local" and new["files_missing"] == 0
    assert new["gpt_weights"].endswith(".ckpt") and new["emotions"][0]["ref_path"].endswith(".wav")
    assert client.get(f"/api/tavern/cards/{out['card_id']}/voices").json()["main"] == vid
    assert any("刻晴声音 2" in line for line in out["report"])

    # 撤销:声音、绑定、语音配对表一起删
    r = client.post(f"{API}/jobs/{out['job_id']}/undo")
    assert r.status_code == 200, r.text
    assert _counts(db) == before


def test_bad_connection_choice_is_refused(lib):
    client, ids, _ = lib
    data = client.post(f"/api/export/bundle/{ids['main']}", json={}).content
    plan = _plan(client, "刻晴.animavn", data)
    key = plan["groups"][0]["key"]
    r = _apply(client, plan, {key: {"connection_id": "nope"}}, status=400)
    assert "语音服务" in r["detail"]


def test_single_voice_pack_is_a_pack_file_group_that_asks_first(lib):
    client, ids, db = lib
    data = client.get(f"/api/export/pack/voice/{ids['voice']}").content
    plan = _plan(client, "刻晴声音.animapack", data)
    assert plan["needs_confirm"] is True
    (g,) = plan["groups"]
    assert g["type"] == "pack_file"
    d = g["detail"]
    assert d["kind"] == "voice" and d["name"] == "刻晴声音" and d["detail"] == "3 段参考 + 2 个模型"
    assert d["voices"] == [
        {"name": "刻晴声音", "detail": "3 段参考 + 2 个模型", "connection": {"id": ids["tts"], "name": "台式机", "local": False}, "missing": 0}
    ]
    out = _apply(client, plan)
    (vid,) = out["created"]["voices"]
    assert db.get(VoiceProfile, vid).files_at == "pending"
    assert any("声音「刻晴声音」还没绑定到角色卡" in line for line in out["report"])


def test_without_any_voice_service_the_plan_says_none_and_apply_makes_a_local_one(lib):
    client, ids, db = lib
    data = client.get(f"/api/export/pack/voice/{ids['voice']}").content
    db.query(VoiceEmotion).delete()
    db.query(VoiceProfile).delete()
    db.query(TtsConnection).delete()
    db.commit()
    before = _counts(db)
    plan = _plan(client, "刻晴声音.animapack", data)
    assert plan["groups"][0]["detail"]["voices"][0]["connection"] is None
    out = _apply(client, plan)
    conns = client.get("/api/tts/connections").json()
    assert [(c["name"], c["base_url"]) for c in conns] == [("本机 GPT-SoVITS", "http://127.0.0.1:9880")]
    assert client.get("/api/voices").json()[0]["files_at"] == "local"
    client.post(f"{API}/jobs/{out['job_id']}/undo")
    assert _counts(db) == before  # 新建的语音服务也撤掉


def test_another_computer_export_the_files_then_say_where_they_are(lib):
    client, ids, db = lib
    data = client.get(f"/api/export/pack/voice/{ids['voice']}").content
    out = _apply(client, _plan(client, "刻晴声音.animapack", data))
    (vid,) = out["created"]["voices"]

    r = client.get(f"/api/voices/{vid}/files.zip")
    assert r.status_code == 200, r.text
    assert "filename*=UTF-8''" in r.headers["content-disposition"]
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = sorted(zf.namelist())
    assert names == sorted(
        ["models/keqing-e10.ckpt", "models/keqing_e10_s460.pth", "refs/【平静】你好.wav", "refs/【开心】太好了.wav", "refs/aux_" + sha_of(VOICE_FILES["aux"])[:12] + ".wav"]
    )
    assert zf.read("models/keqing-e10.ckpt") == VOICE_FILES["gpt"]
    assert zf.read("refs/【平静】你好.wav") == VOICE_FILES["calm"]

    r = client.post(f"/api/voices/{vid}/placed", json={"folder": " D:\\AnimaVoice\\imports\\刻晴_ja\\ "})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["id"] == vid and v["files_at"] == "manual"
    base = "D:/AnimaVoice/imports/刻晴_ja"
    assert v["gpt_weights"] == f"{base}/models/keqing-e10.ckpt" and v["sovits_weights"] == f"{base}/models/keqing_e10_s460.pth"
    calm, happy = v["emotions"]
    assert calm["ref_path"] == f"{base}/refs/【平静】你好.wav"
    assert happy["aux_refs"] == [f"{base}/refs/aux_{sha_of(VOICE_FILES['aux'])[:12]}.wav"]
    # 指纹还在:以后再导出这个声音不用再拉
    db.expire_all()
    assert db.get(VoiceProfile, vid).gpt_sha == sha_of(VOICE_FILES["gpt"])

    assert client.post(f"/api/voices/{vid}/placed", json={"folder": "  "}).status_code == 400
    assert client.post("/api/voices/nope/placed", json={"folder": "D:/x"}).status_code == 404
    # 手填路径的老声音没有可导出的文件时也照样给 zip(只放仓库里有的)
    assert client.get(f"/api/voices/{ids['voice']}/files.zip").status_code == 200


def test_reference_audio_of_an_imported_voice_plays_from_the_store(lib):
    client, ids, db = lib
    data = client.get(f"/api/export/pack/voice/{ids['voice']}").content
    local = client.post("/api/tts/connections", json={"name": "本机", "base_url": "http://127.0.0.1:9880"}).json()
    plan = _plan(client, "刻晴声音.animapack", data)
    out = _apply(client, plan, {plan["groups"][0]["key"]: {"connection_id": local["id"]}})
    v = next(x for x in client.get("/api/voices").json() if x["id"] == out["created"]["voices"][0])
    r = client.get("/api/tts/reference", params={"profile_id": v["id"], "path": v["emotions"][0]["ref_path"]})
    assert r.status_code == 200 and r.content == VOICE_FILES["calm"]


def test_import_limit_is_8_gib():
    assert staging.MAX_TOTAL_BYTES == 8 * 1024**3
