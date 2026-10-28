"""插件页「素材直接换」用的后台约定:每样只用一个,选了就把这张卡这一样原来的绑定整个替换成这一个。

不另开接口,用的是已有的「整组替换」PUT(立绘包、声音、场景包两栏、CG 包),这里把「替换成一个」的语义钉死:
  立绘包  只剩选的这个,当前包就是它
  声音    只剩选的这个当主声音,不留备用
  场景包  背景和 BGM 各挂各的:换背景那一栏不动 BGM 那一栏,反过来也一样;旧卡上这一栏原有的多个包一起被换掉
  CG 包   一次一个
没迁过的卡(只有旧表)第一次写时也一样:先迁过来,再替换,旧表跟着镜像。
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings
from app.db import get_db
from app.main import app
from app.models import AssetBinding, CardScenePack, CardSpritePack, CardVoice

CARD = "/api/tavern/cards/{}"


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    session.close()


def _voice(client: TestClient, name: str) -> str:
    conn = client.post("/api/tts/connections", json={"name": f"GSV {name}", "base_url": "http://gsv.test:9880"}).json()
    return client.post("/api/voices", json={"name": name, "connection_id": conn["id"]}).json()["id"]


def _scene(client: TestClient, name: str) -> str:
    return client.post("/api/scene-packs", json={"name": name}).json()["id"]


def _cg(client: TestClient, name: str) -> str:
    return client.post("/api/cg-packs", json={"name": name}).json()["id"]


def _rows(db: Session, card_id: str, kind: str) -> list[tuple[str, bool, str]]:
    db.expire_all()
    rows = db.scalars(
        select(AssetBinding).where(AssetBinding.card_id == card_id, AssetBinding.kind == kind).order_by(AssetBinding.sort)
    )
    return [(r.target_id, r.is_primary, r.parts) for r in rows]


def test_sprite_pack_replaced_by_one(client, db, make_card, make_sprite_pack):
    card = make_card()
    a, b, c = (make_sprite_pack(n)["id"] for n in "甲乙丙")
    url = CARD.format(card["id"]) + "/sprite-packs"
    client.put(url, json={"pack_ids": [a, b], "current": b})

    r = client.put(url, json={"pack_ids": [c], "current": c})
    assert r.json() == {"card_id": card["id"], "pack_ids": [c], "current": c}
    assert _rows(db, card["id"], "sprite") == [(c, True, "")]
    # 旧表跟着只剩一个
    assert [(x.pack_id, x.is_current) for x in db.scalars(select(CardSpritePack).where(CardSpritePack.card_id == card["id"]))] == [(c, True)]


def test_voice_replaced_by_one_leaves_no_backup(client, db, make_card):
    card = make_card()
    ja, zh, other = _voice(client, "日"), _voice(client, "中"), _voice(client, "别")
    url = CARD.format(card["id"]) + "/voices"
    client.put(url, json={"main": ja, "extras": [zh]})

    r = client.put(url, json={"main": other, "extras": []})
    assert r.json() == {"card_id": card["id"], "main": other, "extras": []}
    assert _rows(db, card["id"], "voice") == [(other, True, "")]
    assert [(x.profile_id, x.is_main) for x in db.scalars(select(CardVoice).where(CardVoice.card_id == card["id"]))] == [(other, True)]

    # 选「不念」= 一个都不留
    assert client.put(url, json={"main": None, "extras": []}).json()["main"] is None
    assert _rows(db, card["id"], "voice") == []


def test_cg_pack_replaced_by_one(client, db, make_card):
    card = make_card()
    a, b, c = _cg(client, "甲"), _cg(client, "乙"), _cg(client, "丙")
    url = CARD.format(card["id"]) + "/cg-packs"
    client.put(url, json={"pack_ids": [a, b]})

    assert client.put(url, json={"pack_ids": [c]}).json()["pack_ids"] == [c]
    assert _rows(db, card["id"], "cg") == [(c, False, "")]


def test_scene_background_and_music_are_replaced_independently(client, db, make_card):
    card = make_card()
    a, b, c, d = _scene(client, "甲"), _scene(client, "乙"), _scene(client, "丙"), _scene(client, "丁")
    url = CARD.format(card["id"]) + "/scene-packs"
    # 旧卡:背景挂着甲、乙两个,BGM 挂着乙、丙两个(乙两边都出)
    client.put(url, json={"bg": [a, b], "bgm": [b, c]})
    assert client.get(url).json() == {"card_id": card["id"], "bg": [a, b], "bgm": [b, c]}

    # 玩家在「背景」那个下拉框里选丁:背景整个换成丁,BGM 那一栏原样留着(它自己的多个要等玩家去换 BGM 才换)
    now = client.get(url).json()
    r = client.put(url, json={"bg": [d], "bgm": now["bgm"]})
    assert r.json()["bg"] == [d] and r.json()["bgm"] == [b, c]
    assert {t: p for t, _, p in _rows(db, card["id"], "scene")} == {d: "bg", b: "bgm", c: "bgm"}

    # 再在「BGM」下拉框里选甲:BGM 整个换成甲,背景还是丁
    now = client.get(url).json()
    r = client.put(url, json={"bg": now["bg"], "bgm": [a]})
    assert r.json()["bg"] == [d] and r.json()["bgm"] == [a]
    assert {t: p for t, _, p in _rows(db, card["id"], "scene")} == {d: "bg", a: "bgm"}

    # 两边选同一个包:一行,两样都出
    now = client.get(url).json()
    client.put(url, json={"bg": now["bg"], "bgm": [d]})
    assert _rows(db, card["id"], "scene") == [(d, False, "")]
    assert client.get(url).json()["bgm"] == [d]


def test_card_that_was_never_migrated_is_migrated_on_the_first_replace(client, db, make_card, make_sprite_pack):
    card = make_card()
    a, b = make_sprite_pack("甲")["id"], make_sprite_pack("乙")["id"]
    # 只有旧表(迁移器关着时旧卡的样子)
    db.add_all([CardSpritePack(card_id=card["id"], pack_id=a, sort=0, is_current=True)])
    db.add(CardScenePack(card_id=card["id"], pack_id=a))
    db.commit()
    assert bindings.main_role(db, card["id"]) is None
    assert client.get(CARD.format(card["id"]) + "/scene-packs").json()["bg"] == [a]

    r = client.put(CARD.format(card["id"]) + "/sprite-packs", json={"pack_ids": [b], "current": b})
    assert r.json()["pack_ids"] == [b]
    assert bindings.main_role(db, card["id"]) is not None
    # 迁过来的场景包还在(两边都出),立绘包被换掉
    assert _rows(db, card["id"], "scene") == [(a, False, "")]
    assert _rows(db, card["id"], "sprite") == [(b, True, "")]
