"""背景 / BGM 分开绑(绑定行的 parts)、背景的默认曲能用别的包里的曲子、CG 包分来源(generated)。"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings
from app.db import get_db
from app.main import app
from app.models import AssetBinding, CardScenePack

PACKS = "/api/scene-packs"


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    session.close()


def _pack(client: TestClient, name: str, *assets: tuple[str, str]) -> dict:
    pack = client.post(PACKS, json={"name": name}).json()
    pack["assets"] = {label: client.post(f"{PACKS}/{pack['id']}/assets", json={"kind": kind, "label": label}).json() for kind, label in assets}
    return pack


def _url(card_id: str) -> str:
    return f"/api/tavern/cards/{card_id}/scene-packs"


def _parts(db: Session, card_id: str) -> dict[str, str]:
    db.expire_all()
    rows = db.scalars(select(AssetBinding).where(AssetBinding.card_id == card_id, AssetBinding.kind == "scene"))
    return {r.target_id: r.parts for r in rows}


def _old(db: Session, card_id: str) -> str | None:
    db.expire_all()
    row = db.get(CardScenePack, card_id)
    return row.pack_id if row else None


def test_backgrounds_and_music_are_bound_separately(client, db, make_card):
    card = make_card()
    a = _pack(client, "原神 · 璃月", ("bg", "玉京台"), ("bgm", "璃月"))
    b = _pack(client, "原神 · 曲集", ("bgm", "茶会"))
    assert client.get(_url(card["id"])).json() == {"card_id": card["id"], "bg": [], "bgm": []}

    r = client.put(_url(card["id"]), json={"bg": [a["id"]], "bgm": [a["id"], b["id"]]})
    assert r.status_code == 200, r.text
    assert r.json() == {"card_id": card["id"], "bg": [a["id"]], "bgm": [a["id"], b["id"]]}
    assert client.get(_url(card["id"])).json() == r.json()
    assert _parts(db, card["id"]) == {a["id"]: "", b["id"]: "bgm"}
    # 旧表只能存一个:并集里排第一的
    assert _old(db, card["id"]) == a["id"]
    assert client.get(f"/api/tavern/cards/{card['id']}/scene-pack").json()["pack_id"] == a["id"]
    assert {p["id"]: p["card_count"] for p in client.get(PACKS).json()} == {a["id"]: 1, b["id"]: 1}

    # 两份各自去重;只出背景的行 parts = bg
    r = client.put(_url(card["id"]), json={"bg": [b["id"], b["id"]], "bgm": []})
    assert r.json() == {"card_id": card["id"], "bg": [b["id"]], "bgm": []}
    assert _parts(db, card["id"]) == {b["id"]: "bg"}
    assert _old(db, card["id"]) == b["id"]

    # 已知限制:背景和 BGM 共用一个先后(背景的在前,只在 BGM 里的按 BGM 的顺序接在后面)
    r = client.put(_url(card["id"]), json={"bg": [a["id"]], "bgm": [b["id"], a["id"]]})
    assert r.json() == {"card_id": card["id"], "bg": [a["id"]], "bgm": [a["id"], b["id"]]}

    r = client.put(_url(card["id"]), json={"bg": [], "bgm": []})
    assert r.json() == {"card_id": card["id"], "bg": [], "bgm": []}
    assert _parts(db, card["id"]) == {} and _old(db, card["id"]) is None


def test_scene_packs_endpoint_checks_the_card_and_every_pack(client, make_card):
    card = make_card()
    a = _pack(client, "璃月")
    assert client.get(_url("nope")).status_code == 404
    assert client.put(_url("nope"), json={"bg": [], "bgm": []}).status_code == 404
    assert client.put(_url(card["id"]), json={"bg": [a["id"]], "bgm": ["nope"]}).status_code == 404
    assert client.put(_url(card["id"]), json={"bg": [a["id"]]}).status_code == 422
    # 没写成半截
    assert client.get(_url(card["id"])).json() == {"card_id": card["id"], "bg": [], "bgm": []}


def test_the_old_endpoint_replaces_the_first_pack_for_both_parts(client, db, make_card):
    card = make_card()
    a = _pack(client, "璃月")
    b = _pack(client, "曲集")
    c = _pack(client, "蒙德")
    client.put(_url(card["id"]), json={"bg": [a["id"]], "bgm": [a["id"], b["id"]]})

    # 旧接口照旧只换排第一的那个:换上的背景和 BGM 都用,后面叠着的 parts 不动
    r = client.put(f"/api/tavern/cards/{card['id']}/scene-pack", json={"pack_id": c["id"]})
    assert r.json() == {"card_id": card["id"], "pack_id": c["id"]}
    assert client.get(_url(card["id"])).json() == {"card_id": card["id"], "bg": [c["id"]], "bgm": [c["id"], b["id"]]}
    assert _parts(db, card["id"]) == {c["id"]: "", b["id"]: "bgm"}

    # 换上的是本来只出曲子的包:换上以后两边都用
    client.put(f"/api/tavern/cards/{card['id']}/scene-pack", json={"pack_id": b["id"]})
    assert client.get(_url(card["id"])).json() == {"card_id": card["id"], "bg": [b["id"]], "bgm": [b["id"]]}
    assert _parts(db, card["id"]) == {b["id"]: ""}
    assert _old(db, card["id"]) == b["id"]


def test_a_card_never_migrated_reads_the_one_old_pack_on_both_sides(client, db, make_card):
    card = make_card()
    a = _pack(client, "璃月")
    db.add(CardScenePack(card_id=card["id"], pack_id=a["id"]))
    db.commit()
    assert bindings.main_role(db, card["id"]) is None
    assert bindings.scene_parts(db, card["id"]) == {"bg": [a["id"]], "bgm": [a["id"]]}
    assert client.get(_url(card["id"])).json() == {"card_id": card["id"], "bg": [a["id"]], "bgm": [a["id"]]}
    assert client.get(f"/api/tavern/cards/{card['id']}/roster").json()["scene_parts"] == {"bg": [a["id"]], "bgm": [a["id"]]}

    # 第一次写:先迁过来再改
    b = _pack(client, "曲集")
    client.put(_url(card["id"]), json={"bg": [a["id"]], "bgm": [b["id"]]})
    db.expire_all()
    assert bindings.main_role(db, card["id"]) is not None
    assert _parts(db, card["id"]) == {a["id"]: "bg", b["id"]: "bgm"}


def test_roster_has_scene_parts(client, make_card):
    card = make_card()
    assert client.get(f"/api/tavern/cards/{card['id']}/roster").json()["scene_parts"] == {"bg": [], "bgm": []}
    a, b = _pack(client, "璃月"), _pack(client, "曲集")
    client.put(_url(card["id"]), json={"bg": [a["id"]], "bgm": [b["id"]]})
    got = client.get(f"/api/tavern/cards/{card['id']}/roster").json()
    assert got["scene_parts"] == {"bg": [a["id"]], "bgm": [b["id"]]}
    # 原来的字段照旧:按顺序列全部场景包
    assert got["scene_packs"] == [a["id"], b["id"]]


def test_duplicating_a_card_keeps_which_part_each_pack_gives(client, db, make_card):
    card = make_card()
    a, b = _pack(client, "璃月"), _pack(client, "曲集")
    client.put(_url(card["id"]), json={"bg": [a["id"]], "bgm": [a["id"], b["id"]]})
    copy = client.post(f"/api/tavern/cards/{card['id']}/duplicate", json={}).json()
    assert client.get(_url(copy["id"])).json() == {"card_id": copy["id"], "bg": [a["id"]], "bgm": [a["id"], b["id"]]}
    assert _parts(db, copy["id"]) == {a["id"]: "", b["id"]: "bgm"}


def test_deleting_a_pack_leaves_the_other_parts_alone(client, db, make_card):
    card = make_card()
    a, b = _pack(client, "璃月"), _pack(client, "曲集")
    client.put(_url(card["id"]), json={"bg": [a["id"]], "bgm": [a["id"], b["id"]]})
    assert client.delete(f"{PACKS}/{a['id']}").status_code == 204
    assert client.get(_url(card["id"])).json() == {"card_id": card["id"], "bg": [], "bgm": [b["id"]]}
    assert _old(db, card["id"]) == b["id"]


def test_a_background_may_use_music_from_another_pack(client, make_card):
    a = _pack(client, "璃月", ("bg", "玉京台"), ("bg", "港口"), ("bgm", "璃月"))
    b = _pack(client, "曲集", ("bgm", "茶会"), ("bg", "茶室"))
    bg, foreign = a["assets"]["玉京台"], b["assets"]["茶会"]
    url = f"{PACKS}/{a['id']}/assets/{bg['id']}"

    r = client.put(url, json={"bgm_id": foreign["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["bgm_id"] == foreign["id"]
    # 不存在的、指向背景的(本包的、别的包的)照旧不行
    assert client.put(url, json={"bgm_id": "nope"}).status_code == 400
    assert client.put(url, json={"bgm_id": a["assets"]["港口"]["id"]}).status_code == 400
    assert client.put(url, json={"bgm_id": b["assets"]["茶室"]["id"]}).status_code == 400
    # 封面曲照旧只能是本包的曲子
    assert client.put(f"{PACKS}/{a['id']}", json={"title_bgm_id": foreign["id"]}).status_code == 400
    assert client.put(f"{PACKS}/{a['id']}", json={"title_bgm_id": a["assets"]["璃月"]["id"]}).status_code == 200

    # 曲子删了:别的包里拿它当默认曲的背景也改回「不换」
    assert client.delete(f"{PACKS}/{b['id']}/assets/{foreign['id']}").status_code == 204
    assert client.get(f"{PACKS}/{a['id']}/assets").json()[0]["bgm_id"] is None

    # 整个包删了也一样
    other = client.post(f"{PACKS}/{b['id']}/assets", json={"kind": "bgm", "label": "夜曲"}).json()
    client.put(url, json={"bgm_id": other["id"]})
    assert client.delete(f"{PACKS}/{b['id']}").status_code == 204
    assert client.get(f"{PACKS}/{a['id']}/assets").json()[0]["bgm_id"] is None


def test_cg_packs_say_whether_they_were_generated(client):
    created = client.post("/api/cg-packs", json={"name": "星庇所 · CG"}).json()
    assert created["generated"] is False
    assert [p["generated"] for p in client.get("/api/cg-packs").json()] == [False]
