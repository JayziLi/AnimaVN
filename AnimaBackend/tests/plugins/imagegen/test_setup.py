"""每张卡自己的生图设置 imagegen.setup:第一次用时把旧的全局设置拆到每张卡、换连接各存各的、新卡抄上次的"""

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.models import AppSetting, CardPref

CONNS = "/api/imagegen/connections"


@pytest.fixture(autouse=True)
def no_env_token(monkeypatch):
    monkeypatch.delenv("NOVELAI_TOKEN", raising=False)


def db_of(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def setup_of(client: TestClient, card_id: str) -> dict:
    r = client.get(f"/api/imagegen/setup?card_id={card_id}")
    assert r.status_code == 200, r.text
    return r.json()


def save(client: TestClient, card_id: str, value: dict):
    return client.put(f"/api/imagegen/setup?card_id={card_id}", json={"value": value})


def test_first_use_splits_the_old_global_settings_per_card(client: TestClient, make_card):
    a, b = make_card(name="星绘"), make_card(name="香奈美")
    db = db_of(client)
    db.add(AppSetting(key="plugin.imagegen", value={
        "model": "nai-diffusion-4-5-full", "steps": 23, "styleId": "fuzi_rella", "camera": "pov",
        "auto": {"enabled": True, "cooldown": 3}, "styles": [{"id": "fuzi_rella"}],
    }))
    db.add(AppSetting(key="secret.novelai_token", value="pst-old"))
    db.add(CardPref(card_id=b["id"], key="plugin.imagegen", value={"look": "pink hair", "styleId": "anime", "autoOff": True}))
    db.commit()

    sa = setup_of(client, a["id"])
    conns = client.get(CONNS).json()
    assert [(c["kind"], c["has_key"]) for c in conns] == [("novelai", True)]
    nai_id = conns[0]["id"]
    assert sa["conn"] == nai_id and sa["styleId"] == "fuzi_rella" and sa["camera"] == "pov"
    assert sa["byConn"] == {nai_id: {"model": "nai-diffusion-4-5-full", "steps": 23}}
    assert "styles" not in sa  # 画风库留在全局
    sb = setup_of(client, b["id"])
    assert sb["styleId"] == "anime" and sb["auto"] == {"enabled": False, "cooldown": 3}
    # 搬走的字段不在卡的外观里了,外观还在
    assert client.get(f"/api/tavern/cards/{b['id']}/prefs").json()["plugin.imagegen"] == {"look": "pink hair"}
    # 旧 token 搬进了连接,老前端照样有 token
    db.expire_all()
    assert db.get(AppSetting, "secret.novelai_token") is None
    assert client.get("/api/imagegen/status").json()["has_token"] is True


def test_nothing_old_means_no_connection_is_made(client: TestClient, make_card):
    a = make_card()
    assert setup_of(client, a["id"]) == {"v": 1, "conn": None, "byConn": {}}
    assert client.get(CONNS).json() == []


def test_a_new_card_copies_the_last_one_then_they_are_separate(client: TestClient, make_card):
    a = make_card(name="星绘")
    conn = client.post(CONNS, json={"kind": "sdapi", "base_url": "http://127.0.0.1:7860"}).json()
    sa = setup_of(client, a["id"])
    assert sa["conn"] == conn["id"]  # 只有一条连接时自动用它
    sa["byConn"] = {conn["id"]: {"steps": 6}}
    assert save(client, a["id"], sa).status_code == 200
    b = make_card(name="香奈美")
    sb = setup_of(client, b["id"])
    assert sb["byConn"][conn["id"]] == {"steps": 6}
    sb["byConn"][conn["id"]]["steps"] = 30
    save(client, b["id"], sb)
    assert setup_of(client, a["id"])["byConn"][conn["id"]] == {"steps": 6}


def test_switching_connections_keeps_each_ones_settings(client: TestClient, make_card):
    a = make_card()
    c1 = client.post(CONNS, json={"kind": "sdapi", "base_url": "http://127.0.0.1:7860"}).json()["id"]
    c2 = client.post(CONNS, json={"kind": "openai", "base_url": "https://relay.example"}).json()["id"]
    s = setup_of(client, a["id"])
    assert s["conn"] is None  # 两条连接:不替玩家挑
    s.update(conn=c1, byConn={c1: {"steps": 6}, c2: {"model": "gpt-image-2"}})
    save(client, a["id"], s)
    s["conn"] = c2
    save(client, a["id"], s)
    s = setup_of(client, a["id"])
    assert s["conn"] == c2 and s["byConn"][c1] == {"steps": 6}


def test_a_deleted_connection_is_dropped_and_bad_values_are_refused(client: TestClient, make_card):
    a = make_card()
    c1 = client.post(CONNS, json={"kind": "sdapi", "base_url": "http://a:7860"}).json()["id"]
    c2 = client.post(CONNS, json={"kind": "sdapi", "base_url": "http://b:7860"}).json()["id"]
    save(client, a["id"], {"v": 1, "conn": c1, "byConn": {}})
    client.delete(f"{CONNS}/{c1}")
    assert setup_of(client, a["id"])["conn"] == c2  # 只剩一条:用那条
    assert save(client, a["id"], {"conn": "nope"}).status_code == 400
    assert save(client, a["id"], {"x": "y" * 70000}).status_code == 413
    assert client.get("/api/imagegen/setup?card_id=nope").status_code == 404
