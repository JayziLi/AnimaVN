"""第 4 步 B3:声音跟着角色包 / 单独的声音包走(app/bundle/collect.py)。格式见技术计划第 4 步「格式」。

库是 tests/bundle_seed.py 那份(声音的文件已经在仓库里);拉文件的那几条用假语音机。
"""

import json
import zipfile
from collections.abc import Iterator
from io import BytesIO

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.bundle import canon, collect, write
from app.db import Base, get_db
from app.main import app
from app.models import TtsConnection, VoiceEmotion, VoiceProfile
from app.storage.blobs import sha_of, store
from app.tts import files as voice_files
from tests.bundle_seed import VOICE_FILES, seed


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


@pytest.fixture(autouse=True)
def export_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(write, "TMP_DIR", tmp_path / "export-tmp")


def _zip(archive, tmp_path) -> zipfile.ZipFile:
    path = tmp_path / "out.zip"
    write.write_zip(archive, path)
    return zipfile.ZipFile(path)


def test_voice_pack_json_follows_the_format(db, tmp_path):
    ids = seed(db)
    zf = _zip(collect.collect_pack(db, "voice", ids["voice"]), tmp_path)
    p = json.loads(zf.read("pack.json"))
    assert (p["format"], p["version"], p["kind"], p["key"]) == ("animapack", 1, "voice", ids["voice"])
    head = p["pack"]
    gpt, sovits = VOICE_FILES["gpt"], VOICE_FILES["sovits"]
    assert head == {
        "name": "刻晴声音",
        "aliases": ["刻晴"],
        "engine": "gpt_sovits",
        "text_lang": "ja",
        "speed": 1.1,
        "params": {"top_k": 12},
        "source": "自己练的",
        "license": "",
        "models": {
            "gpt": {"file": f"assets/{sha_of(gpt)}.ckpt", "sha256": sha_of(gpt), "size": len(gpt), "name": "keqing-e10.ckpt"},
            "sovits": {"file": f"assets/{sha_of(sovits)}.pth", "sha256": sha_of(sovits), "size": len(sovits), "name": "keqing_e10_s460.pth"},
        },
        "speaker_ref": None,
    }
    calm, happy = p["items"]
    assert calm == {
        "key": ids["calm"],
        "label": "平静",
        "aliases": ["calm"],
        "prompt_text": "你好",
        "sort": 0,
        "emo_vector": None,
        "file": f"assets/{sha_of(VOICE_FILES['calm'])}.wav",
        "aux": [],
    }
    assert happy["aux"] == [f"assets/{sha_of(VOICE_FILES['aux'])}.wav"]
    for path, data in ((calm["file"], VOICE_FILES["calm"]), (head["models"]["gpt"]["file"], gpt)):
        assert zf.read(path) == data
        assert zf.getinfo(path).compress_type == zipfile.ZIP_STORED
    assert collect.collect_pack(db, "voice", ids["voice"]).file_name == "刻晴声音.animapack"
    with pytest.raises(collect.NotFound):
        collect.collect_pack(db, "voice", "nope")


def test_bundle_carries_the_voice_binding_and_its_pairing(db, tmp_path):
    ids = seed(db)
    m = json.loads(_zip(collect.collect_card(db, ids["main"]), tmp_path).read("animavn.json"))
    voice = [b for b in m["bindings"] if b["kind"] == "voice"]
    assert sorted((b["card"], b["pack"], b["is_primary"]) for b in voice) == sorted(
        [(ids["main"], ids["voice"], True), (ids["state"], ids["voice"], True)]
    )
    vp = next(p for p in m["pairings"] if p["follower"] == "voice")
    assert (vp["list"], vp["target"], vp["card"]) == (f"pack:{ids['sprite_pack']}", ids["voice"], None)
    assert sorted((r["item"], r["value"]) for r in vp["rows"]) == sorted([(ids["s1"], ids["happy"]), (ids["s2"], None)])
    # 勾掉声音:绑定、配对表、文件都不带
    m2 = json.loads(_zip(collect.collect_card(db, ids["main"], exclude=[f"voice:{ids['voice']}"]), tmp_path).read("animavn.json"))
    assert all(b["kind"] != "voice" for b in m2["bindings"]) and all(p["follower"] != "voice" for p in m2["pairings"])
    assert all(p["kind"] != "voice" for p in m2["packs"])


def test_files_the_store_does_not_have_are_written_as_null(db, tmp_path):
    ids = seed(db)
    p = db.get(VoiceProfile, ids["voice"])
    p.gpt_sha = None  # 模型没拉到
    db.get(VoiceEmotion, ids["calm"]).ref_sha = None
    db.commit()
    b = collect.collect_card(db, ids["main"])
    info = next(i for i in b.packs if i.kind == "voice")
    assert info.missing == 2 and info.detail == "3 段参考 + 2 个模型"
    pack = info.data
    assert pack["pack"]["models"]["gpt"] == {"name": "keqing-e10.ckpt", "size": len(VOICE_FILES["gpt"])}
    assert pack["items"][0]["file"] is None and pack["items"][1]["file"]
    _zip(b, tmp_path)  # 照样写得出来


def test_tone_rows_registered_by_a_cartridge_stay_out(db, tmp_path, monkeypatch):
    ids = seed(db)
    db.add(VoiceEmotion(profile_id=ids["voice"], label="夜晚·低语", ref_path="D:/refs/x.wav", prompt_text="x", sort=5))
    db.commit()
    monkeypatch.setattr(voice_files, "_row_filters", [lambda e: e.label.endswith("·低语")])
    info = collect.collect_pack(db, "voice", ids["voice"]).pack
    assert [i["label"] for i in info.data["items"]] == ["平静", "开心"]
    assert info.missing == 0


@pytest.mark.parametrize(
    ("text", "warn"),
    [("", True), ("AI Hobbyist 合集,不可再分发", True), ("CC-BY 4.0,可以再分发", False), ("自己录的,可以分享", False)],
)
def test_warning_unless_the_license_says_it_can_be_shared(text, warn):
    assert (collect.voice_warn(text) is not None) is warn


def test_canonical_form_includes_the_voice(db):
    ids = seed(db)
    c = canon.canonical(db, ids["main"])
    (v,) = c["voices"]
    assert v["pack"]["name"] == "刻晴声音" and v["pack"]["models"]["gpt"]["sha256"] == sha_of(VOICE_FILES["gpt"])
    assert [e["label"] for e in v["items"]] == ["平静", "开心"]
    assert c["cards"][0]["voice"] == [["刻晴声音", True]]
    assert any(p[0] == "voice" for p in c["pairings"])
    # 只比设置(拉不到文件时):指纹都不算
    light = canon.canonical(db, ids["main"], files=False)
    assert "sha256" not in json.dumps(light["voices"]) and light["voices"][0]["items"][0]["file"] is None


# ── 接口:导出前先从语音机拉 ──


class Machine:
    def __init__(self, files):
        self.files, self.requests = files, []

    async def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/docs":
            return httpx.Response(200, text="docs")
        if request.url.path == "/anima/ref":
            path = request.url.params["path"]
            self.requests.append(path)
            if path in self.files:
                return httpx.Response(200, content=self.files[path])
            return httpx.Response(403, json={"detail": "路径不在允许的目录里"})
        return httpx.Response(404, json={"detail": "Not Found"})


@pytest.fixture
def api(client, monkeypatch):
    from app.tts.registry import reset_engines

    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    ids = seed(session)
    # 一个还没拉过的老声音:只有语音机上的路径
    session.add(VoiceProfile(id="v2", name="琴柳", connection_id=ids["tts"], gpt_weights="D:/m/q.ckpt", sovits_weights="G:/m/q.pth"))
    session.add(VoiceEmotion(id="q1", profile_id="v2", label="平静", ref_path="D:/r/【平静】嗯.wav", prompt_text="嗯"))
    session.commit()
    machine = Machine({"D:/m/q.ckpt": b"q-gpt" * 10, "D:/r/【平静】嗯.wav": b"RIFFqin"})
    monkeypatch.setattr(
        "app.tts.gpt_sovits.make_tts_client",
        lambda base_url, timeout: httpx.AsyncClient(transport=httpx.MockTransport(machine.handler)),
    )
    reset_engines()
    yield client, ids, session, machine
    gen.close()
    reset_engines()


def test_export_pulls_missing_files_first_and_brings_settings_for_the_rest(api):
    client, ids, session, machine = api
    r = client.get("/api/export/pack/voice/v2")
    assert r.status_code == 200, r.text
    zf = zipfile.ZipFile(BytesIO(r.content))
    p = json.loads(zf.read("pack.json"))
    assert sorted(machine.requests) == sorted(["D:/m/q.ckpt", "G:/m/q.pth", "D:/r/【平静】嗯.wav"])
    assert zf.read(p["pack"]["models"]["gpt"]["file"]) == b"q-gpt" * 10
    assert p["pack"]["models"]["sovits"] == {"name": "q.pth", "size": None}  # 旧脚本不让读 G 盘
    assert zf.read(p["items"][0]["file"]) == b"RIFFqin"
    assert store().has(sha_of(b"RIFFqin"), "audio/wav")
    # 老声音的路径不动
    session.expire_all()
    assert session.get(VoiceProfile, "v2").gpt_weights == "D:/m/q.ckpt"
    assert session.get(VoiceProfile, "v2").files_at == "manual"


def test_summary_counts_what_could_not_be_pulled(api):
    client, ids, session, machine = api
    from app import bindings

    bindings.replace(session, ids["lonely"], bindings.VOICE, ["v2"], "v2")
    session.commit()
    s = client.get(f"/api/export/bundle/{ids['lonely']}/summary").json()
    (v,) = [i for i in s["items"] if i["kind"] == "voice"]
    assert v["key"] == "voice:v2" and v["missing"] == 1 and v["detail"] == "1 段参考 + 2 个模型"
    assert v["bytes"] == len(b"q-gpt" * 10) + len(b"RIFFqin")
    assert "声音(第 4 步再加)" not in s["not_included"]
    # 语音机关着:照样导出,只带设置
    machine.files = {}
    session.get(TtsConnection, ids["tts"]).base_url = "http://10.0.0.3:9880"
    session.commit()
    r = client.post(f"/api/export/bundle/{ids['lonely']}", json={})
    assert r.status_code == 200
