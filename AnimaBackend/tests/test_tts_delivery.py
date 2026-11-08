"""把声音文件送到语音机:走哪条路、缺什么传什么、语音机丢了文件重送"""

import asyncio
import hashlib
import json
from types import SimpleNamespace

import httpx
import pytest

from app.models import Blob
from app.storage.blobs import BlobStore
from app.tts import delivery
from app.tts.base import TTSError, VoiceSpec

DATA = b"model bytes" * 10
SHA = hashlib.sha256(DATA).hexdigest()


class Fake:
    """假的语音机:plugin=False 时 /anima/* 都 404"""

    def __init__(self, plugin=True, same=False, code="ABCD2345"):
        self.plugin, self.same, self.code = plugin, same, code
        self.stored: dict[str, bytes] = {}
        self.puts: list[str] = []
        self.calls: list[str] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req.url.path)
        if not self.plugin:
            return httpx.Response(404, json={"detail": "Not Found"})
        ok = req.headers.get("x-anima-pair") == self.code
        if req.url.path == "/anima/info":
            return httpx.Response(200, json={"plugin": 1, "pair_ok": ok})
        if req.url.path == "/anima/same-machine":
            return httpx.Response(200, json={"same": self.same})
        if not ok:
            return httpx.Response(401, json={"detail": "配对码不对"})
        if req.url.path == "/anima/have":
            shas = json.loads(req.content)["shas"]
            return httpx.Response(200, json={"have": {s: f"/cache/{s}.pth" for s in shas if s in self.stored}})
        sha = req.url.path.rsplit("/", 1)[-1]
        self.puts.append(sha)
        self.stored[sha] = req.read()
        return httpx.Response(200, json={"path": f"/cache/{sha}.pth"})


@pytest.fixture(autouse=True)
def clean():
    delivery.reset()
    yield
    delivery.reset()


@pytest.fixture
def world(monkeypatch, tmp_path):
    fake = Fake()
    blobs = BlobStore(tmp_path / "blobs")
    blobs.put(DATA, "application/x-gsv-pth")
    monkeypatch.setattr(delivery, "store", lambda: blobs)
    monkeypatch.setattr(delivery, "make_tts_client", lambda base, timeout: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: fake(r))))
    db = SimpleNamespace(scalar=lambda stmt: "application/x-gsv-pth")
    return SimpleNamespace(fake=fake, blobs=blobs, db=db)


def conn(url="http://192.168.1.20:9880", code="ABCD2345"):
    return SimpleNamespace(id="c1", base_url=url, options={"pair_code": code})


def spec(**kw):
    base = dict(gpt_weights=delivery.blob_ref(SHA), sovits_weights="D:/old/a.pth", ref_path="D:/old/a.wav", prompt_text="x", text_lang="zh", speed=1.0)
    return VoiceSpec(**{**base, **kw})


def run(coro):
    return asyncio.run(coro)


def test_path_wins_over_fingerprint():
    assert delivery.path_or_blob("D:/a.wav", SHA) == "D:/a.wav"
    assert delivery.path_or_blob("", SHA) == f"blob:{SHA}"
    assert delivery.path_or_blob("", None) == ""


def test_no_blob_means_no_network(world):
    s = spec(gpt_weights="D:/old/a.ckpt")
    assert run(delivery.localize(world.db, conn(), s)) is s
    assert world.fake.calls == []


def test_routes(world):
    assert run(delivery.route_of(conn())).kind == "plugin"
    delivery.reset()
    world.fake.same = True
    assert run(delivery.route_of(conn())).kind == "same"
    delivery.reset()
    world.fake.plugin = False
    assert run(delivery.route_of(conn())).kind == "none"
    delivery.reset()
    assert run(delivery.route_of(conn("http://127.0.0.1:9880"))).kind == "same"


def test_same_machine_uses_the_store_path(world):
    world.fake.same = True
    real = run(delivery.localize(world.db, conn(), spec()))
    assert real.gpt_weights == str(world.blobs.path(SHA, "application/x-gsv-pth").resolve())
    assert real.sovits_weights == "D:/old/a.pth"
    assert world.fake.puts == []


def test_uploads_only_what_is_missing_and_remembers(world):
    real = run(delivery.localize(world.db, conn(), spec()))
    assert real.gpt_weights == f"/cache/{SHA}.pth"
    assert world.fake.puts == [SHA] and world.fake.stored[SHA] == DATA
    world.fake.calls.clear()
    run(delivery.localize(world.db, conn(), spec()))
    assert "/anima/have" not in world.fake.calls and world.fake.puts == [SHA]


def test_aux_and_speaker_are_replaced_too(world):
    real = run(delivery.localize(world.db, conn(), spec(aux_ref_paths=(delivery.blob_ref(SHA), "D:/x.wav"), spk_ref_path=delivery.blob_ref(SHA))))
    assert real.aux_ref_paths == (f"/cache/{SHA}.pth", "D:/x.wav") and real.spk_ref_path == f"/cache/{SHA}.pth"


def test_no_route_says_what_to_do(world):
    world.fake.plugin = False
    with pytest.raises(TTSError) as e:
        run(delivery.localize(world.db, conn(), spec()))
    assert e.value.status == 400 and "插件" in e.value.message


def test_wrong_code_says_so(world):
    with pytest.raises(TTSError) as e:
        run(delivery.localize(world.db, conn(code="WRONG"), spec()))
    assert "配对码" in e.value.message and world.fake.puts == []


def test_file_gone_from_the_store(world, tmp_path):
    world.blobs.path(SHA, "application/x-gsv-pth").unlink()
    with pytest.raises(TTSError) as e:
        run(delivery.localize(world.db, conn(), spec()))
    assert "仓库" in e.value.message


def test_resends_when_the_voice_machine_lost_it(world):
    attempts = []

    async def go(real):
        attempts.append(real.gpt_weights)
        if len(attempts) == 1:
            raise TTSError(502, f"{real.gpt_weights} not exists")
        return "ok"

    assert run(delivery.with_files(world.db, conn(), spec(), go)) == "ok"
    assert len(attempts) == 2 and world.fake.calls.count("/anima/have") == 2


def test_other_errors_are_not_retried(world):
    attempts = []

    async def go(real):
        attempts.append(1)
        raise TTSError(502, "请输入有效文本")

    with pytest.raises(TTSError):
        run(delivery.with_files(world.db, conn(), spec(), go))
    assert len(attempts) == 1


def typed(api_type, **kw):
    c = conn(**kw)
    c.api_type = api_type
    return c


def test_fish_and_openai_are_always_same_machine_without_probing(world):
    for kind in ("fish", "openai"):
        assert run(delivery.route_of(typed(kind, url="https://api.fish.audio"))).kind == "same"
    assert world.fake.calls == []
    real = run(delivery.localize(world.db, typed("fish", url="https://api.fish.audio"), spec(gpt_weights="", sovits_weights="", ref_path=delivery.blob_ref(SHA))))
    assert real.ref_path == str(world.blobs.path(SHA, "application/x-gsv-pth").resolve())
    assert world.fake.calls == []


def test_indextts_is_probed_like_gsv(world):
    assert run(delivery.route_of(typed("indextts"))).kind == "plugin"
    assert "/anima/info" in world.fake.calls


def test_messages_name_the_service_of_the_connection_type(world):
    world.fake.plugin = False
    with pytest.raises(TTSError) as e:
        run(delivery.localize(world.db, typed("indextts"), spec(gpt_weights="", sovits_weights="", spk_ref_path=delivery.blob_ref(SHA))))
    assert "IndexTTS" in e.value.message and "GPT-SoVITS" not in e.value.message
    world.fake.plugin = True
    with pytest.raises(TTSError) as e:
        run(delivery.localize(world.db, typed("indextts", code="WRONG"), spec(spk_ref_path=delivery.blob_ref(SHA))))
    assert "配对码" in e.value.message
    delivery.reset()
    with pytest.raises(TTSError) as e:
        run(delivery.localize(world.db, typed("gpt_sovits", code="WRONG"), spec()))
    assert "配对码" in e.value.message
