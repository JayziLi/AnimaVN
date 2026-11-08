"""GSV 小插件(tools/voice-helper/anima_gsv_routes.py)的接口。插件只依赖 fastapi,这里直接挂到空 app 上测"""

import hashlib
import importlib.util
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

SRC = Path(__file__).resolve().parents[2] / "tools" / "voice-helper" / "anima_gsv_routes.py"
spec = importlib.util.spec_from_file_location("anima_gsv_routes", SRC)
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)

DATA = b"RIFF fake audio" * 100
SHA = hashlib.sha256(DATA).hexdigest()


@pytest.fixture
def env(tmp_path):
    app = FastAPI()
    extra = tmp_path / "voices"
    extra.mkdir()
    code = routes.register(app, tmp_path / "gsv", [extra])
    return TestClient(app, client=("127.0.0.1", 5000)), code, tmp_path, app


def auth(code):
    return {"X-Anima-Pair": code}


def test_info_reports_whether_the_code_is_right(env):
    c, code, *_ = env
    assert c.get("/anima/info").json() == {"plugin": 1, "pair_ok": False}
    assert c.get("/anima/info", headers=auth(code)).json() == {"plugin": 1, "pair_ok": True}


def test_upload_needs_the_code(env):
    c, *_ = env
    assert c.put(f"/anima/blob/{SHA}?ext=wav", content=DATA).status_code == 401
    assert c.post("/anima/have", json={"shas": [SHA]}).status_code == 401


def test_upload_then_have_returns_the_path(env):
    c, code, *_ = env
    assert c.post("/anima/have", json={"shas": [SHA]}, headers=auth(code)).json() == {"have": {}}
    res = c.put(f"/anima/blob/{SHA}?ext=wav", content=DATA, headers=auth(code))
    assert res.status_code == 200
    path = res.json()["path"]
    assert Path(path).read_bytes() == DATA and path.endswith(f"{SHA}.wav")
    assert c.post("/anima/have", json={"shas": [SHA]}, headers=auth(code)).json() == {"have": {SHA: path}}


def test_wrong_fingerprint_leaves_nothing(env):
    c, code, tmp, _ = env
    res = c.put(f"/anima/blob/{'0' * 64}?ext=wav", content=DATA, headers=auth(code))
    assert res.status_code == 400
    assert not [p for p in (tmp / "gsv" / "anima_cache").rglob("*") if p.is_file()]


@pytest.mark.parametrize("ext", ["py", "exe", "wav/../x"])
def test_only_audio_and_model_extensions(env, ext):
    c, code, *_ = env
    assert c.put(f"/anima/blob/{SHA}", params={"ext": ext}, content=DATA, headers=auth(code)).status_code == 400


def test_bad_sha_in_have_is_ignored(env):
    c, code, *_ = env
    assert c.post("/anima/have", json={"shas": ["../../x"]}, headers=auth(code)).json() == {"have": {}}


def test_same_machine_needs_matching_content(env):
    c, _, tmp, _ = env
    f = tmp / "probe.txt"
    f.write_bytes(b"abc")
    good = hashlib.sha256(b"abc").hexdigest()
    assert c.post("/anima/same-machine", json={"path": str(f), "sha256": good}).json() == {"same": True}
    assert c.post("/anima/same-machine", json={"path": str(f), "sha256": SHA}).json() == {"same": False}
    assert c.post("/anima/same-machine", json={"path": str(tmp / "no.txt"), "sha256": good}).json() == {"same": False}


def test_public_address_is_refused(env):
    _, code, _, app = env
    far = TestClient(app, client=("8.8.8.8", 5000))
    assert far.get("/anima/info").status_code == 403
    assert far.put(f"/anima/blob/{SHA}?ext=wav", content=DATA, headers=auth(code)).status_code == 403


@pytest.mark.parametrize("host", ["127.0.0.1", "::1", "192.168.1.5", "10.0.0.2", "172.16.0.5", "100.64.1.5"])
def test_local_addresses_are_allowed(env, host):
    _, _, _, app = env
    assert TestClient(app, client=(host, 5000)).get("/anima/info").status_code == 200


def test_ref_reads_extra_roots_and_cache_only(env):
    c, code, tmp, _ = env
    f = tmp / "voices" / "a.wav"
    f.write_bytes(DATA)
    assert c.get("/anima/ref", params={"path": str(f)}).content == DATA
    other = tmp / "secret.wav"
    other.write_bytes(DATA)
    assert c.get("/anima/ref", params={"path": str(other)}).status_code == 403
    path = c.put(f"/anima/blob/{SHA}?ext=wav", content=DATA, headers=auth(code)).json()["path"]
    assert c.get("/anima/ref", params={"path": path}).status_code == 200


def test_code_stays_the_same_after_restart(tmp_path):
    p = tmp_path / "anima_pair.txt"
    a = routes.load_pair_code(p)
    assert len(a) == 8 and routes.load_pair_code(p) == a
