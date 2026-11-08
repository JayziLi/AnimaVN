"""从文件夹导入声音(实施计划 2 的 Task 4):认出声音文件夹、能挂到哪些语音服务、执行后的声音(路径空、只记指纹、files_at = pending)。

文件夹名和文件名特意带中文、空格、单引号。模型是几个字节的假文件(只看名字和大小,不会真读进 GSV)。
"""

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.importer.classify import build_plan, voice_folder_targets
from app.importer.staging import stage
from app.main import app
from app.models import VoiceEmotion, VoiceProfile
from app.storage.blobs import sha_of

API = "/api/import"
ROOT = "凯露 's 声音"


def wav(seed: str) -> bytes:
    return b"RIFF\x00\x00\x00\x00WAVEfmt " + seed.encode("utf-8") + bytes(16)


def folder(root: str = ROOT, *, models: bool = True, jp: bool = False) -> dict[str, bytes]:
    hello, glad, again = ("こんにちは。", "嬉しい!", "もう一回") if jp else ("你好呀。", "太好了!", "再来一次")
    files = {
        f"{root}/refs/【开心】{glad}.wav": wav("glad"),
        f"{root}/refs/【平静】{hello}.wav": wav("calm"),
        f"{root}/refs/【开心】{again}.wav": wav("again"),
        f"{root}/refs/随便一段.wav": wav("bad name"),
        f"{root}/readme.txt": b"hi",
    }
    if models:
        files |= {
            f"{root}/models/凯露-e8.ckpt": b"old gpt",
            f"{root}/models/凯露-e15.ckpt": b"new gpt weights",
            f"{root}/models/凯露_e8_s152.pth": b"sovits weights",
        }
    return files


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def plan_of(tmp_path, db, files):
    return build_plan(stage(list(files.items()), tmp_path / "staging"), db)


# ── 认出来 ──


def test_a_voice_folder_becomes_one_group_with_the_newest_models(tmp_path, db):
    plan = plan_of(tmp_path, db, folder())
    (g,) = plan.groups
    assert g.type == "voice_folder" and g.owner is None and g.key == "voice:1"
    d = g.detail
    assert d["name"] == ROOT and d["folder"] == ROOT and d["lang"] == "zh"
    assert [(m["kind"], m["name"], m["size"]) for m in d["models"]] == [
        ("gpt", "凯露-e15.ckpt", len(b"new gpt weights")),
        ("sovits", "凯露_e8_s152.pth", len(b"sovits weights")),
    ]
    # 平静排最前;同一个情绪第二段起标签加 2
    assert [(r["label"], r["text"]) for r in d["refs"]] == [("平静", "你好呀。"), ("开心", "再来一次"), ("开心 2", "太好了!")]
    assert d["skipped"] == ["凯露-e8.ckpt", "随便一段.wav"]
    assert d["existing"] is None and d["connections"] == []
    assert g.files == [m["file"] for m in d["models"]] + [r["file"] for r in d["refs"]]
    assert plan.unknown == [] and not any("声音包这次不认" in s for s in plan.skipped)


def test_everyday_labels_go_before_shy_ones(tmp_path, db):
    files = {"甲/x.ckpt": b"g", "甲/【害羞】一.wav": wav("a"), "甲/【微笑】二.wav": wav("b"), "甲/【日常】三.wav": wav("c")}
    (g,) = plan_of(tmp_path, db, files).groups
    assert [r["label"] for r in g.detail["refs"]] == ["日常", "微笑", "害羞"]


def test_japanese_text_adds_the_language_to_the_name_unless_it_has_one(tmp_path, db):
    (g,) = plan_of(tmp_path, db, folder(jp=True)).groups
    assert g.detail["lang"] == "ja" and g.name == f"{ROOT}(日语)"
    (g,) = plan_of(tmp_path, db, folder("凯露(日语)", jp=True)).groups
    assert g.name == "凯露(日语)"
    (g,) = plan_of(tmp_path, db, folder("凯露 日文版", jp=True)).groups
    assert g.name == "凯露 日文版"


def test_refs_only_folder_and_a_bare_refs_folder_named_after_its_parent(tmp_path, db):
    (g,) = plan_of(tmp_path, db, folder("凯露/refs", models=False)).groups
    assert g.name == "凯露" and g.detail["models"] == [] and len(g.detail["refs"]) == 3
    # 文件直接放在文件夹里也行
    (g,) = plan_of(tmp_path, db, {f"裸文件/【平静】你好。.wav": wav("a"), "裸文件/x.ckpt": b"g"}).groups
    assert g.detail["refs"][0]["label"] == "平静" and [m["kind"] for m in g.detail["models"]] == ["gpt"]


def test_no_valid_reference_audio_means_no_voice_group(tmp_path, db):
    plan = plan_of(tmp_path, db, {"凯露/models/a.ckpt": b"g", "凯露/models/a.pth": b"s", "凯露/refs/随便.wav": wav("x")})
    assert plan.groups == []


def test_a_character_folder_with_sprites_keeps_its_voice_folder_separate(tmp_path, db):
    files = {"刻晴/立绘/微笑.png": bytes.fromhex("89504e470d0a1a0a") + b"x", **folder("刻晴/声音")}
    plan = plan_of(tmp_path, db, files)
    assert [g.type for g in plan.groups if g.type == "voice_folder"] == ["voice_folder"]


# ── 能挂到哪 ──


def test_targets_gsv_needs_models_indextts_takes_only_references():
    conns = [
        {"id": "i1", "name": "IndexTTS 一号", "api_type": "indextts"},
        {"id": "g1", "name": "GSV 一号", "api_type": "gpt_sovits"},
        {"id": "g2", "name": "GSV 二号", "api_type": "gpt_sovits"},
    ]
    with_models = voice_folder_targets(True, conns)
    assert [(t["id"], t["usable"], t["reason"], t["note"], t["best"]) for t in with_models] == [
        ("i1", True, "", "只用参考音频", False),
        ("g1", True, "", "", True),  # 有模型:第一条 GSV
        ("g2", True, "", "", False),
    ]
    only_refs = voice_folder_targets(False, conns)
    assert [(t["id"], t["usable"], t["reason"], t["note"], t["best"]) for t in only_refs] == [
        ("i1", True, "", "用参考音频", True),
        ("g1", False, "没有模型", "", False),
        ("g2", False, "没有模型", "", False),
    ]
    assert voice_folder_targets(False, conns[1:]) and not any(t["best"] for t in voice_folder_targets(False, conns[1:]))
    assert voice_folder_targets(True, conns[:1])[0]["best"] is True
    assert voice_folder_targets(True, []) == []
    fish, relay = voice_folder_targets(True, [{"id": "f", "name": "鱼", "api_type": "fish"}, {"id": "o", "name": "中转", "api_type": "openai"}])
    assert (fish["usable"], fish["note"], fish["best"]) == (True, "只用参考音频克隆,没那么像", True)
    assert (relay["usable"], relay["reason"]) == (False, "用不上:只认音色名")


# ── 执行 ──


@pytest.fixture
def lib(client):
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield client, session
    gen.close()


def _conn(client, name, api_type="gpt_sovits", url="http://10.0.0.2:9880") -> str:
    r = client.post("/api/tts/connections", json={"name": name, "base_url": url, "api_type": api_type})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _plan(client, files: dict[str, bytes]) -> dict:
    r = client.post(f"{API}/plan", files=[("files", (name, data)) for name, data in files.items()])
    assert r.status_code == 200, r.text
    return r.json()


def _apply(client, plan, options=None, status=200) -> dict:
    r = client.post(f"{API}/{plan['plan_id']}/apply", json={"options": options or {}})
    assert r.status_code == status, r.text
    return r.json()


def _counts(db) -> dict:
    db.expire_all()
    return {
        t.name: db.scalar(select(func.count()).select_from(t))
        for t in Base.metadata.sorted_tables
        if t.name not in ("import_jobs", "blobs")
    }


def test_plan_lists_connections_and_asks_first(lib):
    client, _ = lib
    gsv, idx = _conn(client, "台式机"), _conn(client, "索引", "indextts", "http://10.0.0.3:9890")
    plan = _plan(client, folder())
    assert plan["needs_confirm"] is True
    (g,) = plan["groups"]
    assert g["type"] == "voice_folder" and g["count"] == 3
    assert [(c["id"], c["usable"], c["best"]) for c in g["detail"]["connections"]] == [(gsv, True, True), (idx, True, False)]


def test_apply_makes_a_pending_voice_with_fingerprints_only_and_undo_removes_it(lib):
    client, db = lib
    gsv = _conn(client, "台式机")
    before = _counts(db)
    plan = _plan(client, folder())
    out = _apply(client, plan, {"voice:1": {"connection_id": gsv}})
    (vid,) = out["created"]["voices"]
    v = db.get(VoiceProfile, vid)
    assert (v.name, v.connection_id, v.text_lang, v.files_at) == (ROOT, gsv, "zh", "pending")
    assert (v.gpt_weights, v.sovits_weights, v.ref_path) == ("", "", "")
    assert v.gpt_sha == sha_of(b"new gpt weights") and v.sovits_sha == sha_of(b"sovits weights")
    assert (v.gpt_name, v.sovits_name) == ("凯露-e15.ckpt", "凯露_e8_s152.pth") and v.speaker_sha is None
    rows = db.scalars(select(VoiceEmotion).where(VoiceEmotion.profile_id == vid).order_by(VoiceEmotion.sort)).all()
    assert [(e.label, e.prompt_text, e.ref_path, e.ref_sha) for e in rows] == [
        ("平静", "你好呀。", "", sha_of(wav("calm"))),
        ("开心", "再来一次", "", sha_of(wav("again"))),
        ("开心 2", "太好了!", "", sha_of(wav("glad"))),
    ]
    api = next(x for x in client.get("/api/voices").json() if x["id"] == vid)
    assert api["gpt_weights"] == f"blob:{v.gpt_sha}" and api["files_missing"] == 0
    assert (api["gpt_name"], api["sovits_name"]) == ("凯露-e15.ckpt", "凯露_e8_s152.pth")  # 界面拿原名当文件名,不露指纹
    assert any("声音「" in line and "还没绑定到角色卡" in line for line in out["report"])
    assert client.post(f"{API}/jobs/{out['job_id']}/undo").status_code == 200
    assert _counts(db) == before


def test_name_and_language_can_be_changed_when_importing(lib):
    client, db = lib
    gsv = _conn(client, "台式机")
    out = _apply(client, _plan(client, folder()), {"voice:1": {"connection_id": gsv, "name": "新名字", "lang": "ja"}})
    v = db.get(VoiceProfile, out["created"]["voices"][0])
    assert (v.name, v.text_lang) == ("新名字", "ja")


def test_refs_only_goes_to_indextts_with_the_first_reference_as_speaker(lib):
    client, db = lib
    idx = _conn(client, "索引", "indextts", "http://10.0.0.3:9890")
    out = _apply(client, _plan(client, folder(models=False)), {"voice:1": {"connection_id": idx}})
    v = db.get(VoiceProfile, out["created"]["voices"][0])
    assert v.connection_id == idx and v.gpt_sha is None and v.sovits_sha is None
    assert v.speaker_sha == sha_of(wav("calm"))  # 第一段(平静)


def test_models_with_an_indextts_connection_keep_only_references(lib):
    client, db = lib
    idx = _conn(client, "索引", "indextts", "http://10.0.0.3:9890")
    out = _apply(client, _plan(client, folder()), {"voice:1": {"connection_id": idx}})
    v = db.get(VoiceProfile, out["created"]["voices"][0])
    assert v.gpt_sha is None and v.sovits_sha is None and v.speaker_sha


def test_gsv_without_models_is_refused_with_the_reason(lib):
    client, db = lib
    gsv = _conn(client, "台式机")
    plan = _plan(client, folder(models=False))
    (g,) = plan["groups"]
    assert g["detail"]["connections"][0]["usable"] is False
    r = _apply(client, plan, {"voice:1": {"connection_id": gsv}}, status=400)
    assert "没有模型" in r["detail"]
    assert db.scalar(select(func.count()).select_from(VoiceProfile)) == 0


def test_when_no_connection_can_take_it_the_files_are_kept_on_the_first_one(lib):
    client, db = lib
    gsv = _conn(client, "台式机")
    out = _apply(client, _plan(client, folder(models=False)))  # 没选:不拒绝
    v = db.get(VoiceProfile, out["created"]["voices"][0])
    assert v.connection_id == gsv and v.gpt_sha is None and v.files_at == "pending"
    assert db.scalar(select(func.count()).select_from(VoiceEmotion)) == 3


def test_unknown_connection_and_bad_options_are_refused(lib):
    client, _ = lib
    _conn(client, "台式机")
    plan = _plan(client, folder())
    assert "语音服务" in _apply(client, plan, {"voice:1": {"connection_id": "nope"}}, status=400)["detail"]
    assert "声音名" in _apply(client, plan, {"voice:1": {"name": "  "}}, status=400)["detail"]


def test_without_any_connection_a_local_one_is_made(lib):
    client, db = lib
    out = _apply(client, _plan(client, folder()))
    (cid,) = out["created"]["tts_connections"]
    assert client.get("/api/tts/connections").json()[0]["id"] == cid
    assert db.get(VoiceProfile, out["created"]["voices"][0]).connection_id == cid


def test_importing_the_same_folder_again_reuses_the_voice(lib):
    client, db = lib
    gsv = _conn(client, "台式机")
    first = _apply(client, _plan(client, folder()), {"voice:1": {"connection_id": gsv}})
    (vid,) = first["created"]["voices"]
    plan = _plan(client, folder())
    assert plan["groups"][0]["detail"]["existing"] == {"id": vid, "name": ROOT}
    second = _apply(client, plan, {"voice:1": {"connection_id": gsv}})
    assert second["created"].get("voices", []) == []
    assert any("已经有了" in line for line in second["report"])
    assert db.scalar(select(func.count()).select_from(VoiceProfile)) == 1


def test_only_new_is_allowed(lib):
    client, _ = lib
    plan = _plan(client, folder())
    r = client.post(f"{API}/{plan['plan_id']}/apply", json={"decisions": {"voice:1": "share"}})
    assert r.status_code == 400
