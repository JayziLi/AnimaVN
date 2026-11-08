"""Fish Audio 引擎:msgpack 编码、请求、WAV 头修复、ping、报错原文。全部走 httpx.MockTransport,不连真接口"""

import asyncio
import json
import struct

import httpx
import pytest

from app.tts import fish as fish_mod
from app.tts.base import TTSError, VoiceSpec
from app.tts.fish import FishEngine, fix_wav
from app.tts.msgpack_lite import packb

URL = "https://api.fish.audio"
SECRET = "sk-fish-secret-123"


# ── 手写的小解码器:验证编码出来的东西能被读回 ──


def unpack(data: bytes):
    obj, pos = _read(data, 0)
    assert pos == len(data)
    return obj


def _read(b: bytes, i: int):
    t = b[i]
    i += 1
    if t <= 0x7F:
        return t, i
    if 0x80 <= t <= 0x8F:
        return _map(b, i, t & 0x0F)
    if 0x90 <= t <= 0x9F:
        return _arr(b, i, t & 0x0F)
    if 0xA0 <= t <= 0xBF:
        n = t & 0x1F
        return b[i : i + n].decode(), i + n
    if t >= 0xE0:
        return t - 256, i
    if t == 0xC0:
        return None, i
    if t == 0xC2:
        return False, i
    if t == 0xC3:
        return True, i
    if t == 0xC4:
        n = b[i]
        return bytes(b[i + 1 : i + 1 + n]), i + 1 + n
    if t == 0xC5:
        n = struct.unpack(">H", b[i : i + 2])[0]
        return bytes(b[i + 2 : i + 2 + n]), i + 2 + n
    if t == 0xC6:
        n = struct.unpack(">I", b[i : i + 4])[0]
        return bytes(b[i + 4 : i + 4 + n]), i + 4 + n
    if t == 0xCB:
        return struct.unpack(">d", b[i : i + 8])[0], i + 8
    if t == 0xCC:
        return b[i], i + 1
    if t == 0xCD:
        return struct.unpack(">H", b[i : i + 2])[0], i + 2
    if t == 0xCE:
        return struct.unpack(">I", b[i : i + 4])[0], i + 4
    if t == 0xCF:
        return struct.unpack(">Q", b[i : i + 8])[0], i + 8
    if t == 0xD0:
        return struct.unpack(">b", b[i : i + 1])[0], i + 1
    if t == 0xD1:
        return struct.unpack(">h", b[i : i + 2])[0], i + 2
    if t == 0xD2:
        return struct.unpack(">i", b[i : i + 4])[0], i + 4
    if t == 0xD3:
        return struct.unpack(">q", b[i : i + 8])[0], i + 8
    if t == 0xD9:
        n = b[i]
        return b[i + 1 : i + 1 + n].decode(), i + 1 + n
    if t == 0xDA:
        n = struct.unpack(">H", b[i : i + 2])[0]
        return b[i + 2 : i + 2 + n].decode(), i + 2 + n
    if t == 0xDB:
        n = struct.unpack(">I", b[i : i + 4])[0]
        return b[i + 4 : i + 4 + n].decode(), i + 4 + n
    if t == 0xDC:
        return _arr(b, i + 2, struct.unpack(">H", b[i : i + 2])[0])
    if t == 0xDE:
        return _map(b, i + 2, struct.unpack(">H", b[i : i + 2])[0])
    raise AssertionError(f"没处理的类型 {t:#x}")


def _arr(b, i, n):
    out = []
    for _ in range(n):
        v, i = _read(b, i)
        out.append(v)
    return out, i


def _map(b, i, n):
    out = {}
    for _ in range(n):
        k, i = _read(b, i)
        v, i = _read(b, i)
        out[k] = v
    return out, i


def test_msgpack_matches_hand_computed_bytes():
    assert packb(None) == b"\xc0"
    assert packb(False) == b"\xc2"
    assert packb(True) == b"\xc3"
    assert packb(0) == b"\x00"
    assert packb(127) == b"\x7f"
    assert packb(128) == b"\xcc\x80"
    assert packb(256) == b"\xcd\x01\x00"
    assert packb(300) == b"\xcd\x01\x2c"
    assert packb(1000000) == b"\xce\x00\x0f\x42\x40"
    assert packb(2**32) == b"\xcf\x00\x00\x00\x01\x00\x00\x00\x00"
    assert packb(-1) == b"\xff"
    assert packb(-32) == b"\xe0"
    assert packb(-33) == b"\xd0\xdf"
    assert packb(-200) == b"\xd1\xff\x38"
    assert packb(1.5) == b"\xcb\x3f\xf8\x00\x00\x00\x00\x00\x00"
    assert packb("hi") == b"\xa2hi"
    assert packb("你") == b"\xa3" + "你".encode()
    assert packb("x" * 32) == b"\xd9\x20" + b"x" * 32
    assert packb("x" * 300) == b"\xda\x01\x2c" + b"x" * 300
    assert packb(b"\x01") == b"\xc4\x01\x01"
    assert packb(b"a" * 300) == b"\xc5\x01\x2c" + b"a" * 300
    assert packb([1, 2]) == b"\x92\x01\x02"
    assert packb({"a": 1}) == b"\x81\xa1a\x01"


def test_msgpack_round_trips_nested_and_big_values():
    obj = {"text": "你好", "references": [{"audio": b"RIFF" * 70000, "text": "原文"}], "t": 0.9, "n": None, "ok": True, "l": list(range(20))}
    assert unpack(packb(obj)) == obj
    with pytest.raises(TypeError):
        packb({"x": object()})


# ── 引擎 ──


def wav(riff=None, data_size=None, body=b"\x00\x01" * 10) -> bytes:
    size = len(body)
    return (
        b"RIFF"
        + struct.pack("<I", 36 + size if riff is None else riff)
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16)
        + b"data"
        + struct.pack("<I", size if data_size is None else data_size)
        + body
    )


def test_fix_wav_repairs_placeholder_sizes_and_leaves_normal_headers_alone():
    good = wav()
    assert fix_wav(good) == good
    broken = wav(riff=0xFFFFFFFF, data_size=0xFFFFFFFF)
    fixed = fix_wav(broken)
    assert fixed == good
    only_data = wav(data_size=0xFFFFFF00)
    assert fix_wav(only_data) == good
    assert fix_wav(b"ID3\x03abc") == b"ID3\x03abc"
    assert fix_wav(b"RI") == b"RI"


def spec(ref_path: str, text="参考原文", **params) -> VoiceSpec:
    return VoiceSpec(gpt_weights="", sovits_weights="", ref_path=ref_path, prompt_text=text, text_lang="zh", speed=1.0, params=params)


@pytest.fixture
def ref(tmp_path):
    p = tmp_path / "ref.wav"
    p.write_bytes(b"REFERENCE-WAV-BYTES")
    return str(p)


class FakeFish:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.reply: httpx.Response | Exception | None = None
        self.timeouts: list[float] = []

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if isinstance(self.reply, Exception):
            raise self.reply
        if self.reply is not None:
            return self.reply
        if req.url.path == "/v1/tts":
            return httpx.Response(200, content=wav(), headers={"content-type": "audio/wav"})
        return httpx.Response(200, json={"credit": "1"})


@pytest.fixture
def fake(monkeypatch):
    f = FakeFish()

    def make(base_url, timeout, **kw):
        f.timeouts.append(timeout)
        return httpx.AsyncClient(transport=httpx.MockTransport(f.handler))

    monkeypatch.setattr(fish_mod, "make_tts_client", make)
    return f


def run(coro):
    return asyncio.run(coro)


def test_synthesize_sends_msgpack_with_headers_and_reference(fake, ref):
    engine = FishEngine(URL + "/", "drama-3", SECRET)
    data, mime = run(engine.synthesize("你好呀", spec(ref, temperature=0.7)))
    assert (data, mime) == (wav(), "audio/wav")
    req = fake.requests[0]
    assert (req.method, str(req.url)) == ("POST", URL + "/v1/tts")
    assert req.headers["content-type"] == "application/msgpack"
    assert req.headers["model"] == "drama-3"
    assert req.headers["authorization"] == f"Bearer {SECRET}"
    body = unpack(req.content)
    assert body["text"] == "你好呀"
    assert body["references"] == [{"audio": b"REFERENCE-WAV-BYTES", "text": "参考原文"}]
    assert (body["format"], body["temperature"], body["top_p"], body["latency"]) == ("wav", 0.7, 0.9, "normal")
    assert fake.timeouts == [90.0]


def test_no_key_means_no_authorization_header_and_default_model(fake, ref):
    run(FishEngine(URL, "", "").synthesize("嗨", spec(ref)))
    req = fake.requests[0]
    assert "authorization" not in req.headers
    assert req.headers["model"] == "drama-3"
    assert unpack(req.content)["temperature"] == 1.0


def test_synthesize_repairs_streaming_wav_header(fake, ref):
    fake.reply = httpx.Response(200, content=wav(riff=0xFFFFFFFF, data_size=0xFFFFFFFF), headers={"content-type": "audio/wav"})
    data, _ = run(FishEngine(URL, "s1", SECRET).synthesize("嗨", spec(ref)))
    assert data == wav()


def test_error_text_is_shown_as_the_service_said_it(fake, ref):
    engine = FishEngine(URL, "drama-3", SECRET)
    fake.reply = httpx.Response(401, json={"status": 401, "message": "Invalid api key"})
    with pytest.raises(TTSError) as e:
        run(engine.synthesize("嗨", spec(ref)))
    assert (e.value.status, e.value.message) == (502, "Invalid api key")
    fake.reply = httpx.Response(402, text="Payment Required: balance too low")
    with pytest.raises(TTSError) as e:
        run(engine.synthesize("嗨", spec(ref)))
    assert e.value.message == "Payment Required: balance too low"
    fake.reply = httpx.Response(500, json={"detail": "boom"})
    with pytest.raises(TTSError) as e:
        run(engine.synthesize("嗨", spec(ref)))
    assert e.value.message == "boom"
    assert SECRET not in e.value.message


def test_missing_reference_file_points_to_pull_back(fake, tmp_path):
    with pytest.raises(TTSError) as e:
        run(FishEngine(URL, "drama-3", SECRET).synthesize("嗨", spec(str(tmp_path / "gone.wav"))))
    assert e.value.status == 400
    assert e.value.message == "这个声音的文件不在文件仓库里,先在导出框点「拉回来」"
    assert fake.requests == []


def test_transport_failure_becomes_tts_error(fake, ref):
    fake.reply = httpx.ConnectError("refused")
    with pytest.raises(TTSError) as e:
        run(FishEngine(URL, "drama-3", SECRET).synthesize("嗨", spec(ref)))
    assert e.value.status == 503
    assert "Fish Audio" in e.value.message


def test_cache_material_has_no_bytes_and_no_key():
    engine = FishEngine(URL, "drama-3", SECRET)
    s = spec("/blobs/aa.wav", temperature=0.6)
    material = engine.cache_material("你好", s)
    assert material == {
        "engine": "fish",
        "model": "drama-3",
        "ref": "/blobs/aa.wav",
        "prompt": "参考原文",
        "text": "你好",
        "temperature": 0.6,
        "top_p": 0.9,
    }
    assert SECRET not in json.dumps(material) + json.dumps(engine.request_body("你好", s))
    body = engine.request_body("你好", s)
    assert body["reference_text"] == "参考原文" and body["model"] == "drama-3" and body["text"] == "你好"
    assert not any(isinstance(v, bytes) for v in body.values())
    other = FishEngine(URL, "s1", SECRET).cache_material("你好", s)
    assert other != material


def test_ping_official_checks_credit_and_reports_bad_key(fake):
    run(FishEngine(URL, "drama-3", SECRET).ping())
    req = fake.requests[0]
    assert (req.method, req.url.path) == ("GET", "/wallet/self/api-credit")
    assert req.headers["authorization"] == f"Bearer {SECRET}"
    fake.reply = httpx.Response(401, json={"message": "nope"})
    with pytest.raises(TTSError) as e:
        run(FishEngine(URL, "drama-3", SECRET).ping())
    assert "key 不对" in e.value.message
    fake.reply = httpx.Response(500, text="server exploded")
    with pytest.raises(TTSError) as e:
        run(FishEngine(URL, "drama-3", SECRET).ping())
    assert e.value.message == "server exploded"


def test_ping_custom_address_just_needs_any_answer(fake):
    fake.reply = httpx.Response(404, text="nothing here")
    run(FishEngine("http://self.hosted:8080", "drama-3", "").ping())
    assert fake.requests[0].url.path == "/v1/health"


def test_warmup_is_noop_and_file_endpoints_unsupported(fake):
    engine = FishEngine(URL, "drama-3", SECRET)
    run(engine.warmup(spec("x"), True))
    assert fake.requests == []
    with pytest.raises(TTSError) as e:
        run(engine.reference_audio("x"))
    assert e.value.status == 501
    with pytest.raises(TTSError) as e:
        run(engine.download("x", None))
    assert e.value.status == 501
