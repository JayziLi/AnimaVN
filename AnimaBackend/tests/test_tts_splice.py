"""语音接口留给卡带的两个口子:拼接器(register_splicer)和删声音时的清理(register_profile_cleanup)。
真的拼接器在卡带里,有它自己的测试;这里用假的。"""

from fastapi.testclient import TestClient

from app.api import tts, voices
from app.tts import cache as tts_cache
from tests.test_tts_api import setup_voice


class FakePlan:
    label = "假素材"

    def __init__(self):
        self.synthesized = 0

    def material(self, base: dict) -> dict:
        return {"fake": 1, "base": base}

    async def synthesize(self, spec, engine, db):
        self.synthesized += 1
        return b"RIFFspliced", "audio/wav"

    def describe(self) -> list[dict]:
        return [
            {"kind": "speech", "text": "说话"},
            {"kind": "sfx", "text": "嗯", "category": "c", "clip_id": "x", "clip_text": "嗯~"},
        ]


def post(client: TestClient, path: str, profile_id: str, **kw):
    return client.post(f"/api/tts/{path}", json={"profile_id": profile_id, "text": "说话嗯", **kw})


def test_a_registered_splicer_decides_and_caches_under_its_own_key(client: TestClient, gsv, monkeypatch):
    _, voice = setup_voice(client)
    plan = FakePlan()
    asked: list[str] = []

    def splicer(text, v, db):
        asked.append(text)
        return plan

    monkeypatch.setattr(tts, "_splicer", splicer)
    first = post(client, "speak", voice["id"], sfx=True)
    assert first.status_code == 200, first.text
    assert (first.content, first.headers["x-tts-cache"]) == (b"RIFFspliced", "miss")
    assert gsv.names().count("tts") == 0
    assert post(client, "speak", voice["id"], sfx=True).headers["x-tts-cache"] == "hit"
    assert plan.synthesized == 1

    explained = post(client, "explain", voice["id"], sfx=True).json()
    assert explained["cached"] is True
    assert explained["sfx_pack"] == "假素材"
    assert [s["kind"] for s in explained["sfx"]] == ["speech", "sfx"]
    assert explained["sfx"][1] == {"kind": "sfx", "text": "嗯", "category": "c", "clip_id": "x", "clip_text": "嗯~"}

    # 不要拼接的请求不问拼接器,照常交给模型
    plain = post(client, "speak", voice["id"])
    assert plain.content == b"RIFF" + "说话嗯".encode()
    assert asked == ["说话嗯", "说话嗯", "说话嗯"]


def test_without_a_splicer_the_flag_is_ignored(client: TestClient, gsv, monkeypatch):
    _, voice = setup_voice(client)
    monkeypatch.setattr(tts, "_splicer", None)
    r = post(client, "speak", voice["id"], sfx=True)
    assert r.content == b"RIFF" + "说话嗯".encode()
    assert post(client, "explain", voice["id"], sfx=True).json()["sfx"] is None


def test_a_splicer_that_says_no_leaves_the_line_as_it_was(client: TestClient, gsv, monkeypatch):
    _, voice = setup_voice(client)
    monkeypatch.setattr(tts, "_splicer", lambda text, v, db: None)
    r = post(client, "speak", voice["id"], sfx=True)
    assert r.content == b"RIFF" + "说话嗯".encode()
    # 缓存键和不带开关时同一个
    assert post(client, "speak", voice["id"]).headers["x-tts-cache"] == "hit"


def test_material_wraps_the_engine_material_only_when_splicing():
    class Engine:
        def cache_material(self, text, spec):
            return {"text": text}

    class V:
        spec = None

    assert tts._material("あ", V(), Engine(), None) == {"text": "あ"}
    assert tts._material("あ", V(), Engine(), FakePlan()) == {"fake": 1, "base": {"text": "あ"}}
    assert tts_cache.cache_key({"fake": 1, "base": {"text": "あ"}}) != tts_cache.cache_key({"text": "あ"})


def test_deleting_a_voice_runs_the_registered_cleanups(client: TestClient, gsv, monkeypatch):
    _, voice = setup_voice(client)
    seen: list[str] = []
    monkeypatch.setattr(voices, "_profile_cleanups", [])
    cleanup = lambda profile_id, db: seen.append(profile_id)  # noqa: E731
    voices.register_profile_cleanup(cleanup)
    voices.register_profile_cleanup(cleanup)  # 登记两次也只跑一次
    assert client.delete(f"/api/voices/{voice['id']}").status_code == 204
    assert seen == [voice["id"]]
