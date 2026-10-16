"""绑定(app/bindings.py):新表是准,旧表照旧写一份;没迁过的卡读旧表;复制、删卡、名册。"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings
from app.db import get_db
from app.main import app
from app.models import AssetBinding, CardRole, CardScenePack, CardSpritePack, CardVoice


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    session.close()


def _voice(client: TestClient, name: str) -> str:
    conn = client.post("/api/tts/connections", json={"name": f"GSV {name}", "base_url": "http://gsv.test:9880"}).json()
    return client.post("/api/voices", json={"name": name, "connection_id": conn["id"]}).json()["id"]


def _old(db: Session, card_id: str):
    db.expire_all()
    sprites = [
        (r.pack_id, r.sort, r.is_current)
        for r in db.scalars(select(CardSpritePack).where(CardSpritePack.card_id == card_id).order_by(CardSpritePack.sort))
    ]
    voices = sorted((r.profile_id, r.is_main) for r in db.scalars(select(CardVoice).where(CardVoice.card_id == card_id)))
    scene = db.get(CardScenePack, card_id)
    return sprites, voices, scene.pack_id if scene else None


def test_writes_go_to_the_new_table_and_are_mirrored_to_the_old_ones(client, db, make_card, make_sprite_pack):
    card = make_card()
    a, b = make_sprite_pack("甲"), make_sprite_pack("乙")
    r = client.put(f"/api/tavern/cards/{card['id']}/sprite-packs", json={"pack_ids": [a["id"], b["id"]], "current": b["id"]})
    assert r.json() == {"card_id": card["id"], "pack_ids": [a["id"], b["id"]], "current": b["id"]}
    main, extra = _voice(client, "主"), _voice(client, "备")
    client.put(f"/api/tavern/cards/{card['id']}/voices", json={"main": main, "extras": [extra]})
    scene = client.post("/api/scene-packs", json={"name": "场景"}).json()
    client.put(f"/api/tavern/cards/{card['id']}/scene-pack", json={"pack_id": scene["id"]})

    role = bindings.main_role(db, card["id"])
    assert role is not None and role.name == "Anima"
    rows = db.scalars(select(AssetBinding).where(AssetBinding.card_id == card["id"]).order_by(AssetBinding.kind, AssetBinding.sort)).all()
    assert [(r.kind, r.target_id, r.is_primary, r.role_id == role.id) for r in rows] == [
        ("scene", scene["id"], False, False),
        ("sprite", a["id"], False, True),
        ("sprite", b["id"], True, True),
        ("voice", main, True, True),
        ("voice", extra, False, True),
    ]
    assert _old(db, card["id"]) == ([(a["id"], 0, False), (b["id"], 1, True)], sorted([(main, True), (extra, False)]), scene["id"])

    client.put(f"/api/tavern/cards/{card['id']}/sprite-packs/current", json={"pack_id": a["id"]})
    client.put(f"/api/tavern/cards/{card['id']}/scene-pack", json={"pack_id": None})
    assert _old(db, card["id"])[0] == [(a["id"], 0, True), (b["id"], 1, False)]
    assert _old(db, card["id"])[2] is None
    assert client.get(f"/api/tavern/cards/{card['id']}/scene-pack").json()["pack_id"] is None


def test_a_card_that_was_never_migrated_reads_the_old_tables(client, db, make_card, make_sprite_pack):
    card = make_card()
    pack = make_sprite_pack()
    db.add(CardSpritePack(card_id=card["id"], pack_id=pack["id"], sort=0, is_current=True))
    db.commit()
    assert bindings.main_role(db, card["id"]) is None
    got = client.get(f"/api/tavern/cards/{card['id']}/sprite-packs").json()
    assert got == {"card_id": card["id"], "pack_ids": [pack["id"]], "current": pack["id"]}
    assert client.get("/api/sprite-packs").json()[0]["card_count"] == 1

    # 第一次写:先把它迁过来(别的种类的旧绑定也搬上),再改
    main = _voice(client, "主")
    client.put(f"/api/tavern/cards/{card['id']}/voices", json={"main": main, "extras": []})
    db.expire_all()
    assert bindings.main_role(db, card["id"]) is not None
    assert bindings.bound(db, card["id"], bindings.SPRITE) == [(pack["id"], True)]


def test_deleting_a_pack_moves_current_to_the_next_one(client, db, make_card, make_sprite_pack):
    card = make_card()
    a, b, c = make_sprite_pack("甲"), make_sprite_pack("乙"), make_sprite_pack("丙")
    client.put(f"/api/tavern/cards/{card['id']}/sprite-packs", json={"pack_ids": [a["id"], b["id"], c["id"]], "current": b["id"]})
    assert client.delete(f"/api/sprite-packs/{b['id']}").status_code == 204
    got = client.get(f"/api/tavern/cards/{card['id']}/sprite-packs").json()
    assert got["pack_ids"] == [a["id"], c["id"]] and got["current"] == c["id"]
    assert _old(db, card["id"])[0] == [(a["id"], 0, False), (c["id"], 1, True)]


def test_duplicate_and_delete_card(client, db, make_card, make_sprite_pack):
    card = make_card()
    pack = make_sprite_pack()
    client.put(f"/api/tavern/cards/{card['id']}/sprite-packs", json={"pack_ids": [pack["id"]]})
    main = _voice(client, "主")
    client.put(f"/api/tavern/cards/{card['id']}/voices", json={"main": main, "extras": []})
    copy = client.post(f"/api/tavern/cards/{card['id']}/duplicate", json={}).json()
    assert client.get(f"/api/tavern/cards/{copy['id']}/sprite-packs").json()["current"] == pack["id"]
    assert client.get(f"/api/tavern/cards/{copy['id']}/voices").json()["main"] == main
    assert bindings.main_role(db, copy["id"]).id != bindings.main_role(db, card["id"]).id
    assert client.get("/api/sprite-packs").json()[0]["card_count"] == 2

    assert client.delete(f"/api/tavern/cards/{card['id']}").status_code == 204
    db.expire_all()
    assert db.scalars(select(AssetBinding).where(AssetBinding.card_id == card["id"])).all() == []
    assert db.scalars(select(CardRole).where(CardRole.card_id == card["id"])).all() == []
    assert _old(db, card["id"]) == ([], [], None)
    assert client.get("/api/sprite-packs").json()[0]["card_count"] == 1


def test_roster(client, make_card, make_sprite_pack):
    card = make_card(name="星绘")
    pack = make_sprite_pack()
    client.put(f"/api/tavern/cards/{card['id']}/sprite-packs", json={"pack_ids": [pack["id"]]})
    main, backup = _voice(client, "主"), _voice(client, "备")
    client.put(f"/api/tavern/cards/{card['id']}/voices", json={"main": main, "extras": [backup]})
    got = client.get(f"/api/tavern/cards/{card['id']}/roster").json()
    assert got["scene_packs"] == [] and got["cg_packs"] == []
    (role,) = got["roles"]
    assert role["name"] == "星绘" and role["is_main"]
    assert role["sprite_packs"] == [pack["id"]] and role["current_sprite_pack"] == pack["id"]
    assert role["voices"] == {"main": main, "backups": [backup]}
    assert client.get("/api/tavern/cards/nope/roster").status_code == 404
