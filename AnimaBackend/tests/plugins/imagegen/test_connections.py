"""画图连接 /api/imagegen/connections:key 只写不读、改地址要重填 key"""

import pytest
from fastapi.testclient import TestClient
from app.plugins.imagegen import nai

URL = "/api/imagegen/connections"


@pytest.fixture(autouse=True)
def no_env_token(monkeypatch):
    # 本机要是设了 NOVELAI_TOKEN,第一次用时会多出一条 NovelAI 连接
    monkeypatch.delenv("NOVELAI_TOKEN", raising=False)


def make(client: TestClient, **body) -> dict:
    r = client.post(URL, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_key_is_write_only_and_the_address_is_tidied(client: TestClient):
    c = make(client, kind="openai", base_url=" https://relay.example/v1/ ", api_key=" sk-1 ")
    assert c["name"] == "中转站" and c["base_url"] == "https://relay.example/v1" and c["has_key"] is True
    assert "sk-1" not in client.get(URL).text
    assert [x["id"] for x in client.get(URL).json()] == [c["id"]]


def test_changing_the_address_drops_the_key_unless_it_is_given_again(client: TestClient):
    c = make(client, kind="openai", base_url="https://relay.example", api_key="sk-1")
    r = client.put(f"{URL}/{c['id']}", json={"name": "我的中转"}).json()
    assert r["name"] == "我的中转" and r["has_key"] is True
    r = client.put(f"{URL}/{c['id']}", json={"base_url": "https://other.example"}).json()
    assert r["has_key"] is False
    r = client.put(f"{URL}/{c['id']}", json={"base_url": "https://relay2.example", "api_key": "sk-2"}).json()
    assert r["has_key"] is True and r["base_url"] == "https://relay2.example"
    r = client.put(f"{URL}/{c['id']}", json={"api_key": ""}).json()
    assert r["has_key"] is False


def test_unknown_kinds_are_refused_and_names_default_to_the_kind(client: TestClient):
    assert client.post(URL, json={"kind": "comfyui", "base_url": "http://127.0.0.1:8188"}).status_code == 422
    assert make(client, kind="novelai")["name"] == "NovelAI"
    assert make(client, kind="sdapi", base_url="http://127.0.0.1:7860")["name"] == "本地 SD"


def test_options_are_kept_and_deleting_works(client: TestClient):
    c = make(client, kind="openai", base_url="https://relay.example", options={"route": "images"})
    assert client.get(URL).json()[0]["options"] == {"route": "images"}
    assert client.put(f"{URL}/{c['id']}", json={"options": {"x": "y" * 30000}}).status_code == 413
    assert client.delete(f"{URL}/{c['id']}").status_code == 204
    assert client.put(f"{URL}/{c['id']}", json={"name": "x"}).status_code == 404
    assert client.get(URL).json() == []


def test_the_old_token_page_writes_the_novelai_connection(client: TestClient):
    assert client.put("/api/imagegen/token", json={"token": " pst-abc "}).json() == {"has_token": True, "source": "settings"}
    conns = client.get(URL).json()
    assert [(c["kind"], c["name"], c["has_key"]) for c in conns] == [("novelai", "NovelAI", True)]
    # 再填一次是改同一条,不会多一条
    client.put("/api/imagegen/token", json={"token": "pst-new"})
    assert len(client.get(URL).json()) == 1
    assert client.put("/api/imagegen/token", json={"token": ""}).json()["has_token"] is False


def test_a_token_left_in_the_old_place_still_counts(client: TestClient):
    from app.db import get_db
    from app.models import AppSetting

    db = next(client.app.dependency_overrides[get_db]())
    db.add(AppSetting(key="secret.novelai_token", value="pst-old"))
    db.commit()
    assert client.get("/api/imagegen/status").json() == {"has_token": True, "source": "settings"}
    # 用老页面重新填:写进连接,旧的删掉
    client.put("/api/imagegen/token", json={"token": "pst-new"})
    db.expire_all()
    assert db.get(AppSetting, "secret.novelai_token") is None


def test_usage_counts_the_cards_that_chose_each_connection(client: TestClient, make_card):
    a, b, c = make_card(name="星绘"), make_card(name="香奈美"), make_card(name="Mira")
    sd = make(client, kind="sdapi", base_url="http://127.0.0.1:7860")["id"]
    novelai = make(client, kind="novelai")["id"]
    for card, conn in ((a, sd), (b, sd), (c, novelai)):
        r = client.put(f"/api/imagegen/setup?card_id={card['id']}", json={"value": {"v": 1, "conn": conn, "byConn": {}}})
        assert r.status_code == 200, r.text
    assert client.get(f"{URL}/usage").json() == {sd: 2, novelai: 1}


def test_account_of_a_novelai_connection_uses_its_own_key_and_address(client: TestClient, monkeypatch):
    seen = []

    async def account(token, host=nai.HOST):
        seen.append((token, host))
        return {"tier": 3, "active": True, "anlas": 1200, "v5_percent": 80, "v5_next_percent_s": 0}

    monkeypatch.setattr(nai, "account", account)
    main = make(client, kind="novelai", api_key="pst-main")
    relay = make(client, kind="novelai", name="NAI 中转", base_url="https://nai-relay.example", api_key="pst-relay")
    assert client.get(f"{URL}/{main['id']}/account").json()["anlas"] == 1200
    assert client.get(f"{URL}/{relay['id']}/account").status_code == 200
    assert seen == [("pst-main", nai.HOST), ("pst-relay", "https://nai-relay.example")]
    # 不是 NovelAI、没填 key(也没有环境变量):400
    sd = make(client, kind="sdapi", base_url="http://127.0.0.1:7860")
    assert client.get(f"{URL}/{sd['id']}/account").status_code == 400
    empty = make(client, kind="novelai")
    assert client.get(f"{URL}/{empty['id']}/account").status_code == 400

    async def bad(token, host=nai.HOST):
        raise nai.NaiError(401, "NovelAI token 无效或过期了,到插件页重新填")

    monkeypatch.setattr(nai, "account", bad)
    r = client.get(f"{URL}/{main['id']}/account")
    assert r.status_code == 502 and "token" in r.json()["detail"]
