"""中转站(OpenAI 兼容 /audio/speech)引擎,以及连接上的 key / 模型 / 地址整理。全部 httpx.MockTransport"""

import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.tts import _clean_url
from app.tts import openai_speech as oa
from app.tts.base import TTSError, VoiceSpec
from app.tts.openai_speech import OpenAiSpeechEngine
from app.tts.registry import reset_engines

BASE = "https://relay.test/v1"
KEY = "sk-relay-secret-999"
MP3 = b"ID3\x04\x00\x00" + b"\x00" * 20


def spec(voice="alloy", speed=1.0) -> VoiceSpec:
    return VoiceSpec(gpt_weights="", sovits_weights="", ref_path="", prompt_text="", text_lang="zh", speed=speed, params={"voice": voice})


class FakeRelay:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.speech: httpx.Response | Exception | None = None
        self.models: httpx.Response | Exception | None = None
        self.kwargs: list[dict] = []
        self.timeouts: list[float] = []

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        reply = self.models if req.url.path.endswith("/models") else self.speech
        if isinstance(reply, Exception):
            raise reply
        if reply is not None:
            return reply
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "gpt-4o"}, {"id": "tts-1"}, {"id": "gpt-4o-mini-tts"}]})
        return httpx.Response(200, content=b"RIFF....WAVE", headers={"content-type": "audio/wav"})


@pytest.fixture
def relay(monkeypatch):
    f = FakeRelay()

    def make(base_url, timeout, **kw):
        f.kwargs.append(kw)
        f.timeouts.append(timeout)
        # 302 要跟随:MockTransport 本身不跟随,按 kw 里的开关交给 httpx
        return httpx.AsyncClient(transport=httpx.MockTransport(f.handler), follow_redirects=kw.get("follow_redirects", False))

    monkeypatch.setattr(oa, "make_tts_client", make)
    reset_engines()
    yield f
    reset_engines()


def run(coro):
    return asyncio.run(coro)


def engine(base=BASE, model="tts-1", key=KEY):
    return OpenAiSpeechEngine(base, model, key)


def test_request_body_and_headers(relay):
    data, mime = run(engine(BASE + "/").synthesize("你好", spec("nova", speed=1.2)))
    assert (data, mime) == (b"RIFF....WAVE", "audio/wav")
    req = relay.requests[0]
    assert (req.method, str(req.url)) == ("POST", BASE + "/audio/speech")
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert json.loads(req.content) == {"model": "tts-1", "input": "你好", "voice": "nova", "speed": 1.2, "response_format": "wav"}
    assert relay.kwargs == [{"follow_redirects": True}]
    assert relay.timeouts == [60.0]


def test_follows_302_to_the_audio_file(relay):
    def handler(req):
        relay.requests.append(req)
        if req.url.host == "relay.test":
            return httpx.Response(302, headers={"location": "https://cdn.test/a.mp3"})
        return httpx.Response(200, content=MP3, headers={"content-type": "application/octet-stream"})

    relay_handler = relay.handler
    relay.handler = handler  # type: ignore[method-assign]
    try:
        data, mime = run(engine().synthesize("嗨", spec()))
    finally:
        relay.handler = relay_handler  # type: ignore[method-assign]
    assert data == MP3
    assert mime == "audio/mpeg"
    assert [r.url.host for r in relay.requests] == ["relay.test", "cdn.test"]


def test_json_with_status_200_is_an_error(relay):
    relay.speech = httpx.Response(200, json={"error": {"message": "quota exceeded"}}, headers={"content-type": "application/json"})
    with pytest.raises(TTSError) as e:
        run(engine().synthesize("嗨", spec()))
    assert (e.value.status, e.value.message) == (502, "quota exceeded")
    # 没标 json 但首字节是 {
    relay.speech = httpx.Response(200, content=b'{"message": "bad voice"}', headers={"content-type": "audio/mpeg"})
    with pytest.raises(TTSError) as e:
        run(engine().synthesize("嗨", spec()))
    assert e.value.message == "bad voice"


@pytest.mark.parametrize(
    ("reply", "shown"),
    [
        (httpx.Response(401, json={"error": {"message": "Incorrect API key provided"}}), "Incorrect API key provided"),
        (httpx.Response(400, json={"error": "voice not found"}), "voice not found"),
        (httpx.Response(429, json={"message": "slow down"}), "slow down"),
        (httpx.Response(500, json={"detail": "internal"}), "internal"),
        (httpx.Response(502, text="Bad gateway from nginx"), "Bad gateway from nginx"),
        (httpx.Response(500, text="x" * 800), "x" * 500),
    ],
)
def test_error_formats_are_shown_verbatim(relay, reply, shown):
    relay.speech = reply
    with pytest.raises(TTSError) as e:
        run(engine().synthesize("嗨", spec()))
    assert (e.value.status, e.value.message) == (502, shown)
    assert KEY not in e.value.message


def test_mime_comes_from_magic_bytes_then_header(relay):
    cases = [
        (b"RIFF\x00\x00\x00\x00WAVE", "audio/wav"),
        (b"ID3\x03\x00", "audio/mpeg"),
        (b"\xff\xfb\x90\x00", "audio/mpeg"),
        (b"\xff\xf3\x90\x00", "audio/mpeg"),
        (b"\xff\xf2\x90\x00", "audio/mpeg"),
        (b"OggS\x00\x02", "audio/ogg"),
        (b"fLaC\x00\x00", "audio/flac"),
    ]
    for body, want in cases:
        relay.speech = httpx.Response(200, content=body, headers={"content-type": "application/octet-stream"})
        assert run(engine().synthesize("嗨", spec()))[1] == want
    relay.speech = httpx.Response(200, content=b"\x00\x01\x02", headers={"content-type": "audio/x-foo; charset=x"})
    assert run(engine().synthesize("嗨", spec()))[1] == "audio/x-foo"


def test_ping_counts_models_and_lists_them(relay):
    e = engine()
    run(e.ping())
    assert e.last_model_count == 3
    assert (relay.requests[0].method, str(relay.requests[0].url)) == ("GET", BASE + "/models")
    assert run(e.list_models()) == ["gpt-4o", "tts-1", "gpt-4o-mini-tts"]
    relay.models = httpx.Response(401, json={"error": {"message": "bad key"}})
    with pytest.raises(TTSError) as err:
        run(e.ping())
    assert err.value.message == "bad key"


def test_missing_address_is_said_plainly(relay):
    with pytest.raises(TTSError) as e:
        run(OpenAiSpeechEngine("", "tts-1", KEY).synthesize("嗨", spec()))
    assert e.value.message == "这条中转站连接还没填地址"
    assert relay.requests == []


def test_transport_error_and_unsupported_calls(relay):
    relay.speech = httpx.ConnectError("refused")
    with pytest.raises(TTSError) as e:
        run(engine().synthesize("嗨", spec()))
    assert e.value.status == 503
    run(engine().warmup(spec(), False))
    for call in (engine().reference_audio("x"), engine().download("x", None)):
        with pytest.raises(TTSError) as err:
            run(call)
        assert err.value.status == 501


def test_voice_name_goes_into_cache_key_and_key_stays_out():
    e = engine()
    a = e.cache_material("你好", spec("alloy"))
    assert a == {"engine": "openai", "base": BASE, "model": "tts-1", "voice": "alloy", "speed": 1.0, "text": "你好"}
    assert e.cache_material("你好", spec("nova")) != a
    blob = json.dumps(a) + json.dumps(e.request_body("你好", spec("alloy")))
    assert KEY not in blob


# ── 地址整理 ──


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("https://relay.test", "https://relay.test/v1"),
        ("https://relay.test/", "https://relay.test/v1"),
        ("https://relay.test/v1", "https://relay.test/v1"),
        ("https://relay.test/v1/", "https://relay.test/v1"),
        ("https://relay.test/v1/chat/completions", "https://relay.test/v1"),
        ("https://relay.test/v1/audio/speech", "https://relay.test/v1"),
        ("https://relay.test/v1/models", "https://relay.test/v1"),
        ("https://relay.test/api/v3", "https://relay.test/api/v3"),
        ("https://relay.test/chat/completions", "https://relay.test/v1"),
    ],
)
def test_clean_url_for_openai(raw, want):
    assert _clean_url(raw, "openai") == want


def test_clean_url_for_fish_and_gsv():
    assert _clean_url("", "fish") == "https://api.fish.audio"
    assert _clean_url("  ", "fish") == "https://api.fish.audio"
    assert _clean_url("http://my.fish:8080/", "fish") == "http://my.fish:8080"
    assert _clean_url(" http://127.0.0.1:9880/ ") == "http://127.0.0.1:9880"
    with pytest.raises(HTTPException) as e:
        _clean_url("", "gpt_sovits")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        _clean_url("", "openai")
    with pytest.raises(HTTPException):
        _clean_url("relay.test", "openai")


# ── 连接接口:key、模型、抄模型页的连接 ──


def make_llm(client: TestClient, base="https://llm.test/v1/chat/completions", key="sk-llm-777") -> dict:
    r = client.post("/api/connections", json={"name": "我的中转", "api_type": "openai_compatible", "base_url": base, "api_key": key})
    assert r.status_code in (200, 201), r.text
    return r.json()


def post_conn(client, **kw):
    payload = {"name": "中转站", "api_type": "openai", "base_url": BASE, **kw}
    r = client.post("/api/tts/connections", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def stored_options(client: TestClient, conn_id: str) -> dict:
    from app.db import get_db
    from app.main import app
    from app.models import TtsConnection

    db = next(app.dependency_overrides[get_db]())
    return dict(db.get(TtsConnection, conn_id).options or {})


def test_connection_stores_key_and_model_but_never_returns_the_key(client: TestClient):
    conn = post_conn(client, api_key=KEY, model="tts-1")
    assert (conn["has_api_key"], conn["model"]) == (True, "tts-1")
    assert KEY not in json.dumps(client.get("/api/tts/connections").json())
    assert stored_options(client, conn["id"])["api_key"] == KEY
    # 留空 = 不改;改模型不动 key
    r = client.put(f"/api/tts/connections/{conn['id']}", json={"api_key": "", "model": "tts-2"}).json()
    assert (r["has_api_key"], r["model"]) == (True, "tts-2")
    assert stored_options(client, conn["id"])["api_key"] == KEY
    r = client.put(f"/api/tts/connections/{conn['id']}", json={"api_key": "sk-new"}).json()
    assert stored_options(client, conn["id"])["api_key"] == "sk-new"
    assert "sk-new" not in json.dumps(r)
    r = client.put(f"/api/tts/connections/{conn['id']}", json={"clear_api_key": True}).json()
    assert r["has_api_key"] is False
    assert "api_key" not in stored_options(client, conn["id"])
    # GSV 老连接两项照旧
    plain = client.post("/api/tts/connections", json={"name": "g", "base_url": "http://a.test:9880"}).json()
    assert (plain["has_api_key"], plain["model"]) == (False, "")


def test_fish_connection_defaults_to_the_official_address(client: TestClient):
    conn = client.post("/api/tts/connections", json={"name": "Fish", "api_type": "fish", "base_url": "", "api_key": KEY, "model": "s1"}).json()
    assert (conn["base_url"], conn["api_type"], conn["model"]) == ("https://api.fish.audio", "fish", "s1")


def test_copy_from_llm_takes_key_and_fills_url_only_when_blank(client: TestClient):
    llm = make_llm(client)
    a = client.post("/api/tts/connections", json={"name": "中转站", "api_type": "openai", "base_url": "", "copy_from_llm": llm["id"]})
    assert a.status_code == 200, a.text
    a = a.json()
    assert a["base_url"] == "https://llm.test/v1" and a["has_api_key"] is True
    assert "sk-llm-777" not in json.dumps(a)
    assert stored_options(client, a["id"])["api_key"] == "sk-llm-777"
    b = post_conn(client, copy_from_llm=llm["id"])  # 表单填了地址:不抄地址
    assert b["base_url"] == BASE and b["has_api_key"] is True
    missing = client.post("/api/tts/connections", json={"name": "x", "api_type": "openai", "base_url": BASE, "copy_from_llm": "nope"})
    assert missing.status_code == 400


def test_connection_test_for_openai_reports_model_count(client: TestClient, relay):
    conn = post_conn(client, api_key=KEY)
    r = client.post(f"/api/tts/connections/{conn['id']}/test")
    assert r.status_code == 200, r.text
    assert r.json()["model_count"] == 3
    relay.models = httpx.Response(401, json={"error": {"message": "Incorrect API key"}})
    bad = client.post(f"/api/tts/connections/{conn['id']}/test")
    assert (bad.status_code, bad.json()["detail"]) == (502, "Incorrect API key")


def test_models_endpoints(client: TestClient, relay):
    conn = post_conn(client, api_key=KEY)
    r = client.post(f"/api/tts/connections/{conn['id']}/models")
    assert r.json() == {"models": ["gpt-4o", "tts-1", "gpt-4o-mini-tts"]}
    assert relay.requests[-1].headers["authorization"] == f"Bearer {KEY}"
    # 还没保存:表单里的地址 + key
    r = client.post("/api/tts/connections/models-preview", json={"base_url": "https://relay.test", "api_key": "sk-form"})
    assert r.json()["models"][1] == "tts-1"
    assert str(relay.requests[-1].url) == "https://relay.test/v1/models"
    assert relay.requests[-1].headers["authorization"] == "Bearer sk-form"
    # key 留空 + connection_id:用存着的
    client.post("/api/tts/connections/models-preview", json={"base_url": BASE, "api_key": "", "connection_id": conn["id"]})
    assert relay.requests[-1].headers["authorization"] == f"Bearer {KEY}"
    # copy_from_llm:抄 key 和地址
    llm = make_llm(client)
    client.post("/api/tts/connections/models-preview", json={"base_url": "", "copy_from_llm": llm["id"]})
    assert str(relay.requests[-1].url) == "https://llm.test/v1/models"
    assert relay.requests[-1].headers["authorization"] == "Bearer sk-llm-777"
    bad = client.post("/api/tts/connections/models-preview", json={"base_url": ""})
    assert bad.status_code == 400
    # 引擎类型不对
    gsv = client.post("/api/tts/connections", json={"name": "g", "base_url": "http://a.test:9880"}).json()
    assert client.post(f"/api/tts/connections/{gsv['id']}/models").status_code == 400


def test_openai_voice_speaks_with_its_voice_name_and_never_splices(client: TestClient, relay):
    conn = post_conn(client, api_key=KEY, model="tts-1")
    voice = client.post("/api/voices", json={"name": "alloy", "connection_id": conn["id"], "text_lang": "ja", "params": {"voice": "alloy"}})
    assert voice.status_code in (200, 201), voice.text
    pid = voice.json()["id"]
    r = client.post("/api/tts/speak", json={"profile_id": pid, "text": "こんにちは"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/wav"
    assert json.loads(relay.requests[-1].content)["voice"] == "alloy"
    again = client.post("/api/tts/speak", json={"profile_id": pid, "text": "こんにちは"})
    assert again.headers["x-tts-cache"] == "hit"
    # 没填音色名
    blank = client.post("/api/voices", json={"name": "空", "connection_id": conn["id"]}).json()
    bad = client.post("/api/tts/speak", json={"profile_id": blank["id"], "text": "你好"})
    assert (bad.status_code, bad.json()["detail"]) == (400, "声音「空」没填音色名")


def test_splice_plan_skips_openai(client: TestClient, relay):
    from app.api import tts as tts_api

    calls = []
    tts_api.register_splicer(lambda text, v, db: calls.append(1))
    try:
        conn = post_conn(client, api_key=KEY, model="tts-1")
        pid = client.post("/api/voices", json={"name": "a", "connection_id": conn["id"], "params": {"voice": "alloy"}}).json()["id"]
        r = client.post("/api/tts/speak", json={"profile_id": pid, "text": "你好", "sfx": True})
        assert r.status_code == 200
        assert calls == []
    finally:
        tts_api.register_splicer(None)
