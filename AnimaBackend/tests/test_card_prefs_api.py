"""按卡设置(card_prefs):一张卡在全局插件设置之上只改几个字段,存的就是改了的那几个。"""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_db
from app.main import app
from app.models import CardPref


def prefs(card_id: str) -> str:
    return f"/api/tavern/cards/{card_id}/prefs"


def stored() -> list[tuple[str, str]]:
    """直接看表里剩下哪些行:删掉的卡用接口查只会得到 404"""
    session = app.dependency_overrides[get_db]()
    db = next(session)
    try:
        return sorted((r.card_id, r.key) for r in db.scalars(select(CardPref)))
    finally:
        session.close()


def test_a_card_starts_with_no_overrides_and_keeps_what_is_put(client: TestClient, make_card):
    card = make_card()
    url = prefs(card["id"])
    assert client.get(url).json() == {}

    put = client.put(f"{url}/plugin.cg", json={"value": {"jev": {"threshold": 0.75}}})
    assert put.status_code == 200, put.text
    assert put.json() == {"key": "plugin.cg", "value": {"jev": {"threshold": 0.75}}}
    assert client.put(f"{url}/plugin.sprite", json={"value": {"mode": "jev"}}).status_code == 200
    # 同一个键再存是整份换掉,不和上次的合并:value 就是这张卡现在改了的全部字段
    assert client.put(f"{url}/plugin.cg", json={"value": {"jev": {"mode": "off"}}}).status_code == 200

    assert client.get(url).json() == {
        "plugin.cg": {"jev": {"mode": "off"}},
        "plugin.sprite": {"mode": "jev"},
    }
    # 别的卡不受影响
    assert client.get(prefs(make_card(name="别的卡")["id"])).json() == {}


def test_deleting_a_key_puts_the_card_back_on_the_global_setting(client: TestClient, make_card):
    url = prefs(make_card()["id"])
    client.put(f"{url}/plugin.cg", json={"value": {"jev": {"threshold": 0.75}}})
    client.put(f"{url}/plugin.player", json={"value": {"mode": "ai"}})

    assert client.delete(f"{url}/plugin.cg").status_code == 204
    assert client.get(url).json() == {"plugin.player": {"mode": "ai"}}
    assert client.delete(f"{url}/plugin.cg").status_code == 404


def test_the_value_must_be_an_object_of_overridden_fields(client: TestClient, make_card):
    url = prefs(make_card()["id"])
    for bad in ([], "jev", 0.75, None, True):
        assert client.put(f"{url}/plugin.cg", json={"value": bad}).status_code == 422, bad
    assert client.put(f"{url}/plugin.cg", json={}).status_code == 422
    assert client.get(url).json() == {}


def test_keys_follow_the_settings_rules_and_never_reach_secrets(client: TestClient, make_card):
    url = prefs(make_card()["id"])
    for bad in ("Plugin.cg", "secret.jev", "-cg", "a" * 65, "立绘"):
        assert client.put(f"{url}/{bad}", json={"value": {}}).status_code == 400, bad
        assert client.delete(f"{url}/{bad}").status_code == 400, bad
    assert client.get(url).json() == {}
    assert client.put(f"{url}/{'a' * 64}", json={"value": {}}).status_code == 200


def test_an_unknown_card_is_404(client: TestClient):
    url = prefs("missing")
    assert client.get(url).status_code == 404
    assert client.put(f"{url}/plugin.cg", json={"value": {}}).status_code == 404
    assert client.delete(f"{url}/plugin.cg").status_code == 404
    assert stored() == []


def test_a_duplicated_card_brings_its_own_copy_and_a_deleted_card_takes_its_prefs(
    client: TestClient, make_card
):
    card = make_card()
    url = prefs(card["id"])
    client.put(f"{url}/plugin.cg", json={"value": {"jev": {"threshold": 0.75}}})
    client.put(f"{url}/plugin.player", json={"value": {"mode": "ai"}})

    copy = client.post(f"/api/tavern/cards/{card['id']}/duplicate", json={}).json()
    assert client.get(prefs(copy["id"])).json() == client.get(url).json()

    # 副本是自己的一份:改副本不动原卡
    client.put(f"{prefs(copy['id'])}/plugin.cg", json={"value": {"jev": {"threshold": 0.5}}})
    assert client.get(url).json()["plugin.cg"] == {"jev": {"threshold": 0.75}}

    assert client.delete(f"/api/tavern/cards/{card['id']}").status_code == 204
    assert stored() == [(copy["id"], "plugin.cg"), (copy["id"], "plugin.player")]
