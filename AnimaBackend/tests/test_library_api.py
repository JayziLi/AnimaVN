"""素材管理页的接口(实施计划第 4 段 B6;设计稿 6.7、12.1 10-15):

- 复制包:POST /api/sprite-packs/{id}/duplicate、/api/scene-packs/{id}/duplicate、/api/cg-packs/{id}/duplicate
  (素材行照抄、文件按指纹共用;立绘连同摆法、入场动效、找脸结果、认词记录;场景包的默认曲、封面曲、CG 差分换成副本里的);
- GET /api/library/{kind}:按包列(立绘 / 背景 / BGM / CG / 声音),数量、占用空间、绑了哪些卡、封面、找重复用的
  content_key、来自哪次导入;
- GET /api/library/{kind}/{id}/usage:删之前问一句用的(哪些卡在用、删了它们会怎样、一起删掉多少文件)。

图是 cv2.imencode 生成的小 PNG(内容各不相同),曲子只有 MP3 文件头。
"""

import hashlib
import zlib
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models import CardScenePack, CardSpritePack, CardVoice, CgPack, ImportJob, PackSprite, SceneAsset
from app.storage.blobs import sha_of

SPRITES, SCENES, CGS = "/api/sprite-packs", "/api/scene-packs", "/api/cg-packs"


# ── 素材 ──


def png(seed: str, w: int = 8) -> bytes:
    n = zlib.crc32(seed.encode("utf-8"))
    color = (n & 255, (n >> 8) & 255, (n >> 16) & 255)
    return cv2.imencode(".png", np.full((6, w, 3), color, np.uint8))[1].tobytes()


def mp3(seed: str) -> bytes:
    return b"ID3\x04\x00\x00\x00\x00\x00\x00" + seed.encode("utf-8") + bytes(32)


@contextmanager
def session() -> Iterator[Session]:
    """测试用的那个内存库(client 夹具换进去的 get_db),直接改库用"""
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        yield db
    finally:
        gen.close()


def ok(r, status: int = 200):
    assert r.status_code == status, r.text
    return r.json() if r.content else None


# ── 立绘 ──


def new_sprite_pack(client: TestClient, name: str, description: str = "") -> dict:
    return ok(client.post(SPRITES, json={"name": name, "description": description}))


def add_sprite(client: TestClient, pack_id: str, label: str, image: bytes | None, **fields) -> dict:
    row = ok(client.post(f"{SPRITES}/{pack_id}/sprites", json={"label": label, **fields}))
    if image is not None:
        row = ok(client.put(f"{SPRITES}/{pack_id}/sprites/{row['id']}/image", files={"file": (f"{label}.png", image, "image/png")}))
    return row


def sprites_of(client: TestClient, pack_id: str) -> list[dict]:
    return ok(client.get(f"{SPRITES}/{pack_id}/sprites"))


def bind_sprites(client: TestClient, card_id: str, pack_ids: list[str], current: str | None = None) -> None:
    ok(client.put(f"/api/tavern/cards/{card_id}/sprite-packs", json={"pack_ids": pack_ids, "current": current}))


SAME_FIELDS = ("label", "aliases", "description", "has_image", "image_sha", "sort", "enabled", "face_scan", "effect")


def stage_pack(client: TestClient) -> tuple[dict, dict[str, dict]]:
    """「香奈美 · 舞台装」:三张(一张没图、一张停用、一张设了入场动效),排过序,摆法调过,记过一个词"""
    pack = new_sprite_pack(client, "香奈美 · 舞台装", "舞台")
    smile = add_sprite(client, pack["id"], "微笑", png("smile"), aliases=["笑"], description="默认表情")
    angry = add_sprite(client, pack["id"], "生气", png("angry"))
    draft = add_sprite(client, pack["id"], "草稿", None)
    base = f"{SPRITES}/{pack['id']}/sprites"
    ok(client.put(f"{base}/{smile['id']}", json={"effect": {"motion": "hop", "bubble": "heart", "sound": None}}))
    ok(client.put(f"{base}/{angry['id']}", json={"enabled": False}))
    ok(client.post(f"{base}/reorder", json={"ids": [angry["id"], smile["id"], draft["id"]]}))
    ok(client.put(f"{base}/layout", json={"auto": False, "zoom": 1.25, "dx": 0.1, "dy": -0.05}))
    ok(client.put("/api/emotion/records", json={"list_ref": f"pack:{pack['id']}", "word": "开心", "item": smile["id"]}))
    return pack, {"微笑": smile, "生气": angry, "草稿": draft}


def records_of(client: TestClient, pack_id: str) -> list[dict]:
    return ok(client.get("/api/emotion/records", params={"list_ref": f"pack:{pack_id}"}))["records"]


def test_duplicating_a_sprite_pack_copies_rows_layout_effects_and_word_records(client):
    pack, rows = stage_pack(client)
    before = sprites_of(client, pack["id"])

    copy = ok(client.post(f"{SPRITES}/{pack['id']}/duplicate", json={}))
    assert copy == {
        "id": copy["id"],
        "name": "香奈美 · 舞台装 副本",
        "description": "舞台",
        "sprite_count": 3,
        "card_count": 0,
    }
    assert copy["id"] != pack["id"]
    after = sprites_of(client, copy["id"])
    assert [r["label"] for r in after] == ["生气", "微笑", "草稿"]
    assert [{k: r[k] for k in SAME_FIELDS} for r in after] == [{k: r[k] for k in SAME_FIELDS} for r in before]
    assert not {r["id"] for r in after} & {r["id"] for r in before}
    # 文件按指纹共用:副本的图就是原来那份
    smile = next(r for r in after if r["label"] == "微笑")
    assert smile["image_sha"] == sha_of(png("smile"))
    assert client.get(f"{SPRITES}/{copy['id']}/sprites/{smile['id']}/image").content == png("smile")
    assert smile["effect"] == {"motion": "hop", "bubble": "heart", "sound": None}
    assert ok(client.get(f"{SPRITES}/{copy['id']}/sprites/layout")) == {"auto": False, "zoom": 1.25, "dx": 0.1, "dy": -0.05}
    # 认词记录跟着复制,记的那一项换成副本里的同一张
    assert [(r["word"], r["item"], r["source"]) for r in records_of(client, copy["id"])] == [("开心", smile["id"], "player")]
    assert [(r["word"], r["item"]) for r in records_of(client, pack["id"])] == [("开心", rows["微笑"]["id"])]


def test_duplicate_names_count_up_and_a_given_name_must_be_free(client):
    pack = new_sprite_pack(client, "夜莺")
    assert ok(client.post(f"{SPRITES}/{pack['id']}/duplicate", json={}))["name"] == "夜莺 副本"
    assert ok(client.post(f"{SPRITES}/{pack['id']}/duplicate"))["name"] == "夜莺 副本 2"
    assert ok(client.post(f"{SPRITES}/{pack['id']}/duplicate", json={"name": " 夜莺 · 私服 "}))["name"] == "夜莺 · 私服"
    assert client.post(f"{SPRITES}/{pack['id']}/duplicate", json={"name": "夜莺"}).status_code == 409
    assert client.post(f"{SPRITES}/nope/duplicate", json={}).status_code == 404


def test_deleting_the_copy_or_the_original_leaves_the_other_intact(client, make_card):
    pack, rows = stage_pack(client)
    card = make_card()
    bind_sprites(client, card["id"], [pack["id"]])
    copy = ok(client.post(f"{SPRITES}/{pack['id']}/duplicate", json={}))
    before = sprites_of(client, pack["id"])

    ok(client.delete(f"{SPRITES}/{copy['id']}"), 204)
    assert sprites_of(client, pack["id"]) == before
    assert ok(client.get(f"{SPRITES}/{pack['id']}/sprites/layout"))["zoom"] == 1.25
    assert [r["word"] for r in records_of(client, pack["id"])] == ["开心"]
    assert ok(client.get(f"/api/tavern/cards/{card['id']}/sprite-packs"))["current"] == pack["id"]

    second = ok(client.post(f"{SPRITES}/{pack['id']}/duplicate", json={}))
    ok(client.delete(f"{SPRITES}/{pack['id']}"), 204)
    smile = next(r for r in sprites_of(client, second["id"]) if r["label"] == "微笑")
    assert client.get(f"{SPRITES}/{second['id']}/sprites/{smile['id']}/image").content == png("smile")


def test_a_sprite_whose_image_is_still_only_in_the_database_is_copied_into_the_file_store(client):
    """还没复制进文件仓库(指纹是空的、原件在库里)的老立绘:副本放进仓库、记上指纹,不往库里再存一份"""
    pack = new_sprite_pack(client, "老包")
    row = add_sprite(client, pack["id"], "微笑", None)
    with session() as db:
        sprite = db.get(PackSprite, row["id"])
        sprite.image, sprite.mime, sprite.image_sha = png("old"), "image/png", None
        db.commit()

    copy = ok(client.post(f"{SPRITES}/{pack['id']}/duplicate", json={}))
    [new] = sprites_of(client, copy["id"])
    assert new["image_sha"] == sha_of(png("old"))
    assert client.get(f"{SPRITES}/{copy['id']}/sprites/{new['id']}/image").content == png("old")
    with session() as db:
        assert db.get(PackSprite, new["id"]).image is None


# ── 场景包 ──


def new_scene_pack(client: TestClient, name: str, description: str = "") -> dict:
    return ok(client.post(SCENES, json={"name": name, "description": description}))


def add_scene(client: TestClient, pack_id: str, kind: str, label: str, data: bytes | None, **fields) -> dict:
    row = ok(client.post(f"{SCENES}/{pack_id}/assets", json={"kind": kind, "label": label, **fields}))
    if data is not None:
        mime = "audio/mpeg" if kind == "bgm" else "image/png"
        row = ok(client.put(f"{SCENES}/{pack_id}/assets/{row['id']}/file", files={"file": (label, data, mime)}))
    return row


def scenes_of(client: TestClient, pack_id: str) -> list[dict]:
    return ok(client.get(f"{SCENES}/{pack_id}/assets"))


SCENE_FIELDS = ("kind", "label", "aliases", "description", "has_file", "mime", "size", "data_sha", "sort", "focus_x", "enabled", "forms")


def snowy_hut(client: TestClient) -> tuple[dict, dict[str, dict], dict]:
    """「雪山草庵」:两张背景(一张默认曲是包里的「日常」,一张是别的包里的「战斗」、停用了)、两首曲子(封面曲「夜晚」)"""
    other = new_scene_pack(client, "通用曲")
    battle = add_scene(client, other["id"], "bgm", "战斗", mp3("battle"))
    pack = new_scene_pack(client, "雪山草庵", "雪山上")
    daily = add_scene(client, pack["id"], "bgm", "日常", mp3("daily"))
    night = add_scene(client, pack["id"], "bgm", "夜晚", mp3("night"))
    hut = add_scene(client, pack["id"], "bg", "庵", png("hut"), aliases=["草庵"], description="小庵")
    spring = add_scene(client, pack["id"], "bg", "温泉", png("spring"))
    base = f"{SCENES}/{pack['id']}/assets"
    ok(client.put(f"{base}/{hut['id']}", json={"focus_x": 30, "bgm_id": daily["id"]}))
    ok(client.put(f"{base}/{spring['id']}", json={"bgm_id": battle["id"], "enabled": False}))
    ok(client.post(f"{base}/reorder", json={"kind": "bg", "ids": [spring["id"], hut["id"]]}))
    ok(client.put(f"{SCENES}/{pack['id']}", json={"title_bgm_id": night["id"]}))
    return pack, {"日常": daily, "夜晚": night, "庵": hut, "温泉": spring, "战斗": battle}, other


def test_duplicating_a_scene_pack_points_default_and_cover_tracks_at_the_copies(client):
    pack, rows, _ = snowy_hut(client)
    before = scenes_of(client, pack["id"])

    copy = ok(client.post(f"{SCENES}/{pack['id']}/duplicate", json={}))
    new = {r["label"]: r for r in scenes_of(client, copy["id"])}
    assert copy == {
        "id": copy["id"],
        "name": "雪山草庵 副本",
        "description": "雪山上",
        "bg_count": 2,
        "bgm_count": 2,
        "cg_count": 0,
        "card_count": 0,
        "title_bgm_id": new["夜晚"]["id"],
        "cg_pack_id": None,
    }
    after = scenes_of(client, copy["id"])
    assert [{k: r[k] for k in SCENE_FIELDS} for r in after] == [{k: r[k] for k in SCENE_FIELDS} for r in before]
    assert not {r["id"] for r in after} & {r["id"] for r in before}
    # 默认曲是包里的那首:换成副本里的同一首;是别的包里的:照旧指着它
    assert new["庵"]["bgm_id"] == new["日常"]["id"]
    assert new["温泉"]["bgm_id"] == rows["战斗"]["id"]
    assert new["庵"]["data_sha"] == sha_of(png("hut"))
    assert client.get(f"{SCENES}/{copy['id']}/assets/{new['日常']['id']}/file").content == mp3("daily")

    assert ok(client.post(f"{SCENES}/{pack['id']}/duplicate"))["name"] == "雪山草庵 副本 2"
    assert client.post(f"{SCENES}/{pack['id']}/duplicate", json={"name": "通用曲"}).status_code == 409
    assert client.post(f"{SCENES}/nope/duplicate", json={}).status_code == 404


def test_deleting_a_scene_pack_copy_leaves_the_original_intact(client, make_card):
    pack, rows, _ = snowy_hut(client)
    card = make_card()
    ok(client.put(f"/api/tavern/cards/{card['id']}/scene-packs", json={"bg": [pack["id"]], "bgm": [pack["id"]]}))
    copy = ok(client.post(f"{SCENES}/{pack['id']}/duplicate", json={}))
    before = scenes_of(client, pack["id"])

    ok(client.delete(f"{SCENES}/{copy['id']}"), 204)
    assert scenes_of(client, pack["id"]) == before
    assert ok(client.get(f"{SCENES}"))[1]["title_bgm_id"] == rows["夜晚"]["id"]
    assert ok(client.get(f"/api/tavern/cards/{card['id']}/scene-packs"))["bg"] == [pack["id"]]

    second = ok(client.post(f"{SCENES}/{pack['id']}/duplicate", json={}))
    ok(client.delete(f"{SCENES}/{pack['id']}"), 204)
    hut = next(r for r in scenes_of(client, second["id"]) if r["label"] == "庵")
    assert client.get(f"{SCENES}/{second['id']}/assets/{hut['id']}/file").content == png("hut")


def test_a_scene_pack_whose_cgs_were_split_off_is_copied_without_them(client):
    """CG 已经拆成 CG 包的场景包:游戏里出的是那个 CG 包,副本不带 CG(带了就成了没拆过的包,绑上会多出 CG)"""
    pack, _, _ = snowy_hut(client)
    add_scene(client, pack["id"], "cg", "温泉夜", png("cg"))
    assert ok(client.get(CGS))[0]["source_scene_pack_id"] == pack["id"]

    copy = ok(client.post(f"{SCENES}/{pack['id']}/duplicate", json={}))
    assert (copy["cg_count"], copy["cg_pack_id"]) == (0, None)
    assert {r["kind"] for r in scenes_of(client, copy["id"])} == {"bg", "bgm"}
    assert len(ok(client.get(CGS))) == 1


def test_an_unsplit_scene_pack_keeps_its_cgs_and_variants_point_at_the_copied_composition(client):
    pack = new_scene_pack(client, "老场景")
    comp_id = "c" * 32
    with session() as db:
        db.add(SceneAsset(id=comp_id, pack_id=pack["id"], kind="cg", label="烟花", mime="image/png", size=3, data_sha=sha_of(b"cg1")))
        db.add(SceneAsset(pack_id=pack["id"], kind="cg", label="开心", parent_id=comp_id, mime="image/png", size=3, data_sha=sha_of(b"cg2")))
        db.commit()

    copy = ok(client.post(f"{SCENES}/{pack['id']}/duplicate", json={}))
    assert copy["cg_count"] == 1
    rows = {r["label"]: r for r in scenes_of(client, copy["id"])}
    assert rows["开心"]["parent_id"] == rows["烟花"]["id"] != comp_id
    assert (rows["烟花"]["data_sha"], rows["开心"]["data_sha"]) == (sha_of(b"cg1"), sha_of(b"cg2"))
    assert ok(client.get(CGS)) == []


# ── CG 包 ──


def new_cg_pack(client: TestClient, name: str, description: str = "") -> dict:
    return ok(client.post(CGS, json={"name": name, "description": description}))


def add_cg(client: TestClient, pack_id: str, label: str, data: bytes | None, **fields) -> dict:
    row = ok(client.post(f"{CGS}/{pack_id}/assets", json={"label": label, **fields}))
    if data is not None:
        row = ok(client.put(f"{CGS}/{pack_id}/assets/{row['id']}/file", files={"file": (f"{label}.png", data, "image/png")}))
    return row


def cgs_of(client: TestClient, pack_id: str) -> list[dict]:
    return ok(client.get(f"{CGS}/{pack_id}/assets"))


CG_FIELDS = ("label", "aliases", "description", "has_file", "mime", "size", "data_sha", "sort", "focus_x", "enabled", "forms")


def fireworks(client: TestClient) -> tuple[dict, dict[str, dict]]:
    """「夏祭 · CG」:两张构图(排过序),第一张下面一张差分;标成 AI 生成的"""
    pack = new_cg_pack(client, "夏祭 · CG", "夏天")
    sky = add_cg(client, pack["id"], "烟花", png("sky"), aliases=["花火"], description="河边看烟花")
    smile = add_cg(client, pack["id"], "开心", png("sky smile"), parent_id=sky["id"], aliases=["笑"])
    stall = add_cg(client, pack["id"], "小摊", png("stall"))
    base = f"{CGS}/{pack['id']}/assets"
    ok(client.put(f"{base}/{sky['id']}", json={"focus_x": 30, "forms": ["夜晚"]}))
    ok(client.put(f"{base}/{stall['id']}", json={"enabled": False}))
    ok(client.post(f"{base}/reorder", json={"ids": [stall["id"], sky["id"]]}))
    with session() as db:
        db.get(CgPack, pack["id"]).generated = True
        db.commit()
    return pack, {"烟花": sky, "开心": smile, "小摊": stall}


def test_duplicating_a_cg_pack_copies_compositions_and_variants_under_their_copied_composition(client):
    pack, rows = fireworks(client)
    before = cgs_of(client, pack["id"])

    copy = ok(client.post(f"{CGS}/{pack['id']}/duplicate", json={}))
    assert copy == {
        "id": copy["id"],
        "name": "夏祭 · CG 副本",
        "description": "夏天",
        "cg_count": 2,
        "card_count": 0,
        "source_scene_pack_id": None,
        "generated": True,
    }
    after = cgs_of(client, copy["id"])
    assert [{k: r[k] for k in CG_FIELDS} for r in after] == [{k: r[k] for k in CG_FIELDS} for r in before]
    assert not {r["id"] for r in after} & {r["id"] for r in before}
    new = {r["label"]: r for r in after}
    assert new["开心"]["parent_id"] == new["烟花"]["id"]
    assert new["烟花"]["parent_id"] is None
    assert client.get(f"{CGS}/{copy['id']}/assets/{new['开心']['id']}/file").content == png("sky smile")

    assert ok(client.post(f"{CGS}/{pack['id']}/duplicate"))["name"] == "夏祭 · CG 副本 2"
    assert client.post(f"{CGS}/{pack['id']}/duplicate", json={"name": "夏祭 · CG"}).status_code == 409
    assert client.post(f"{CGS}/nope/duplicate", json={}).status_code == 404


def test_a_copy_of_a_cg_pack_split_from_a_scene_pack_is_not_linked_to_it(client):
    """从场景包拆出来的 CG 包:副本是单独的 CG 包,改它不往场景包里同步;原件照旧按指纹读得到"""
    scene = new_scene_pack(client, "雪山草庵")
    add_scene(client, scene["id"], "cg", "温泉夜", png("night spring"))
    [split] = ok(client.get(CGS))
    assert split["source_scene_pack_id"] == scene["id"]

    copy = ok(client.post(f"{CGS}/{split['id']}/duplicate", json={}))
    assert (copy["source_scene_pack_id"], copy["generated"]) == (None, False)
    [row] = cgs_of(client, copy["id"])
    assert client.get(f"{CGS}/{copy['id']}/assets/{row['id']}/file").content == png("night spring")
    ok(client.put(f"{CGS}/{copy['id']}/assets/{row['id']}", json={"label": "改了名"}))
    assert [r["label"] for r in scenes_of(client, scene["id"])] == ["温泉夜"]


def test_deleting_a_cg_pack_copy_leaves_the_original_intact(client, make_card):
    pack, rows = fireworks(client)
    card = make_card()
    ok(client.put(f"/api/tavern/cards/{card['id']}/cg-packs", json={"pack_ids": [pack["id"]]}))
    copy = ok(client.post(f"{CGS}/{pack['id']}/duplicate", json={}))
    before = cgs_of(client, pack["id"])

    ok(client.delete(f"{CGS}/{copy['id']}"), 204)
    assert cgs_of(client, pack["id"]) == before
    assert ok(client.get(f"/api/tavern/cards/{card['id']}/cg-packs"))["pack_ids"] == [pack["id"]]

    second = ok(client.post(f"{CGS}/{pack['id']}/duplicate", json={}))
    ok(client.delete(f"{CGS}/{pack['id']}"), 204)
    sky = next(r for r in cgs_of(client, second["id"]) if r["label"] == "烟花")
    assert client.get(f"{CGS}/{second['id']}/assets/{sky['id']}/file").content == png("sky")


# ── 素材管理页:列表 ──


def lib(client: TestClient, kind: str) -> list[dict]:
    return ok(client.get(f"/api/library/{kind}"))


def entry(items: list[dict], pack_id: str) -> dict:
    found = [i for i in items if i["id"] == pack_id]
    assert len(found) == 1, [i["name"] for i in items]
    return found[0]


def key_of(*files: bytes) -> str:
    return hashlib.sha256("\n".join(sorted(sha_of(f) for f in files)).encode()).hexdigest()


ITEM_KEYS = {"id", "name", "count", "bytes", "card_ids", "cover_sha", "content_key", "import_job_id", "created_at", "updated_at"}


def new_conn(client: TestClient) -> dict:
    return ok(client.post("/api/tts/connections", json={"name": "5090", "base_url": "http://127.0.0.1:9880"}))


def test_sprite_packs_are_listed_with_counts_bytes_cards_cover_and_a_duplicate_key(client, make_card):
    a = new_sprite_pack(client, "香奈美 · 舞台装")
    smile = add_sprite(client, a["id"], "微笑", png("smile"))
    add_sprite(client, a["id"], "生气", png("angry", w=16))
    add_sprite(client, a["id"], "同一张", png("smile"))  # 同一个文件只占一份地方
    add_sprite(client, a["id"], "草稿", None)
    ok(client.put(f"{SPRITES}/{a['id']}/sprites/{smile['id']}", json={"enabled": False}))  # 封面跳过停用的
    copy = ok(client.post(f"{SPRITES}/{a['id']}/duplicate", json={}))
    empty = new_sprite_pack(client, "空包")
    other = new_sprite_pack(client, "别的")
    add_sprite(client, other["id"], "微笑", png("other"))
    one, two = make_card(name="一"), make_card(name="二")
    bind_sprites(client, one["id"], [a["id"], empty["id"]], a["id"])
    bind_sprites(client, two["id"], [a["id"]])

    items = lib(client, "sprite")
    assert [i["name"] for i in items] == ["香奈美 · 舞台装", "香奈美 · 舞台装 副本", "空包", "别的"]
    got = entry(items, a["id"])
    assert set(got) == ITEM_KEYS
    assert {k: got[k] for k in ITEM_KEYS - {"created_at", "updated_at"}} == {
        "id": a["id"],
        "name": "香奈美 · 舞台装",
        "count": 4,
        "bytes": len(png("smile")) + len(png("angry", w=16)),
        "card_ids": sorted([one["id"], two["id"]]),
        "cover_sha": sha_of(png("angry", w=16)),
        "content_key": key_of(png("smile"), png("angry", w=16), png("smile")),
        "import_job_id": None,
    }
    assert entry(items, copy["id"])["content_key"] == got["content_key"]
    assert entry(items, copy["id"])["card_ids"] == []
    assert entry(items, other["id"])["content_key"] != got["content_key"]
    assert {k: entry(items, empty["id"])[k] for k in ("count", "bytes", "cover_sha", "content_key", "card_ids")} == {
        "count": 0,
        "bytes": 0,
        "cover_sha": None,
        "content_key": None,
        "card_ids": [one["id"]],
    }


def two_sided_scenes(client: TestClient, make_card) -> dict:
    """S1 有两张背景、一首曲子;S2 只有曲子;S3 只有背景;S4 空的。
    一:背景 [S1, S3]、BGM [S2];二:S1 两边都出;三:S1 只出 BGM"""
    s1, s2, s3, s4 = (new_scene_pack(client, n) for n in ("S1", "S2", "S3", "S4"))
    hut = add_scene(client, s1["id"], "bg", "庵", png("hut"))
    add_scene(client, s1["id"], "bg", "温泉", png("spring", w=16))
    add_scene(client, s1["id"], "bgm", "日常", mp3("daily"))
    add_scene(client, s2["id"], "bgm", "夜晚", mp3("night"))
    add_scene(client, s3["id"], "bg", "海", png("sea"))
    cards = {n: make_card(name=n) for n in ("一", "二", "三")}
    parts = {"一": ([s1, s3], [s2]), "二": ([s1], [s1]), "三": ([], [s1])}
    for n, (bg, bgm) in parts.items():
        body = {"bg": [p["id"] for p in bg], "bgm": [p["id"] for p in bgm]}
        ok(client.put(f"/api/tavern/cards/{cards[n]['id']}/scene-packs", json=body))
    return {"S1": s1, "S2": s2, "S3": s3, "S4": s4, "hut": hut, **{n: c["id"] for n, c in cards.items()}}


def test_backgrounds_and_music_are_listed_by_scene_pack_with_cards_split_by_side(client, make_card):
    w = two_sided_scenes(client, make_card)
    bg = lib(client, "bg")
    bgm = lib(client, "bgm")
    # 一个包两边都有东西就两边都列;空的场景包两边都列(不然素材管理里找不到它)
    assert [i["name"] for i in bg] == ["S1", "S3", "S4"]
    assert [i["name"] for i in bgm] == ["S1", "S2", "S4"]

    s1_bg, s1_bgm = entry(bg, w["S1"]["id"]), entry(bgm, w["S1"]["id"])
    assert set(s1_bg) == ITEM_KEYS
    assert (s1_bg["count"], s1_bg["bytes"], s1_bg["card_ids"], s1_bg["cover_sha"]) == (
        2,
        len(png("hut")) + len(png("spring", w=16)),
        sorted([w["一"], w["二"]]),
        sha_of(png("hut")),
    )
    assert s1_bg["content_key"] == key_of(png("hut"), png("spring", w=16))
    assert (s1_bgm["count"], s1_bgm["bytes"], s1_bgm["card_ids"], s1_bgm["cover_sha"]) == (
        1,
        len(mp3("daily")),
        sorted([w["二"], w["三"]]),
        None,
    )
    assert s1_bgm["content_key"] == key_of(mp3("daily"))
    assert entry(bg, w["S3"]["id"])["card_ids"] == [w["一"]]
    assert entry(bgm, w["S2"]["id"])["card_ids"] == [w["一"]]
    assert {k: entry(bg, w["S4"]["id"])[k] for k in ("count", "bytes", "content_key", "card_ids")} == {
        "count": 0,
        "bytes": 0,
        "content_key": None,
        "card_ids": [],
    }


def test_cards_not_yet_moved_to_the_new_bindings_count_from_the_old_tables(client, make_card):
    """还没迁过的卡(没有主角色位,绑定只在旧表里):场景包两边都算,立绘包、声音照旧表算"""
    scene = new_scene_pack(client, "老场景")
    add_scene(client, scene["id"], "bg", "庵", png("hut"))
    add_scene(client, scene["id"], "bgm", "日常", mp3("daily"))
    sprite = new_sprite_pack(client, "老立绘")
    voice = ok(client.post("/api/voices", json={"name": "老声音", "connection_id": new_conn(client)["id"]}))
    card = make_card()
    with session() as db:
        db.add(CardScenePack(card_id=card["id"], pack_id=scene["id"]))
        db.add(CardSpritePack(card_id=card["id"], pack_id=sprite["id"], sort=0, is_current=True))
        db.add(CardVoice(card_id=card["id"], profile_id=voice["id"], is_main=True))
        db.commit()
    assert entry(lib(client, "bg"), scene["id"])["card_ids"] == [card["id"]]
    assert entry(lib(client, "bgm"), scene["id"])["card_ids"] == [card["id"]]
    assert entry(lib(client, "sprite"), sprite["id"])["card_ids"] == [card["id"]]
    assert entry(lib(client, "voice"), voice["id"])["card_ids"] == [card["id"]]


def test_cg_packs_are_listed_with_compositions_counted_and_variants_in_the_size(client, make_card):
    pack, _ = fireworks(client)
    imported = new_cg_pack(client, "导入的")
    card = make_card()
    ok(client.put(f"/api/tavern/cards/{card['id']}/cg-packs", json={"pack_ids": [pack["id"]]}))

    items = lib(client, "cg")
    got = entry(items, pack["id"])
    assert set(got) == ITEM_KEYS | {"generated"}
    assert {k: got[k] for k in ("count", "bytes", "card_ids", "cover_sha", "generated", "content_key")} == {
        "count": 2,
        "bytes": len(png("sky")) + len(png("sky smile")) + len(png("stall")),
        "card_ids": [card["id"]],
        # 排第一的「小摊」停用了
        "cover_sha": sha_of(png("sky")),
        "generated": True,
        "content_key": key_of(png("sky"), png("sky smile"), png("stall")),
    }
    assert entry(items, imported["id"])["generated"] is False


def test_voices_are_listed_with_emotion_counts_main_and_backup_cards_and_no_files(client, make_card):
    conn = new_conn(client)
    weights = {"gpt_weights": "D:/m/a.ckpt", "sovits_weights": "D:/m/a.pth"}
    a = ok(client.post("/api/voices", json={"name": "阿米娅", "connection_id": conn["id"], **weights}))
    b = ok(client.post("/api/voices", json={"name": "琴柳", "connection_id": conn["id"]}))
    same = ok(client.post("/api/voices", json={"name": "阿米娅 v2", "connection_id": conn["id"], **weights}))
    for v in (a, same):
        for label in ("平静", "开心"):
            ok(client.post(f"/api/voices/{v['id']}/emotions", json={"label": label, "ref_path": f"D:/refs/【{label}】你好.wav"}))
    one, two = make_card(name="一"), make_card(name="二")
    ok(client.put(f"/api/tavern/cards/{one['id']}/voices", json={"main": a["id"], "extras": [b["id"]]}))
    ok(client.put(f"/api/tavern/cards/{two['id']}/voices", json={"main": b["id"]}))

    items = lib(client, "voice")
    assert [i["name"] for i in items] == ["阿米娅", "琴柳", "阿米娅 v2"]
    got = entry(items, a["id"])
    assert set(got) == ITEM_KEYS
    assert {k: got[k] for k in ("count", "bytes", "card_ids", "cover_sha", "import_job_id")} == {
        "count": 2,
        "bytes": 0,
        "card_ids": [one["id"]],
        "cover_sha": None,
        "import_job_id": None,
    }
    assert entry(items, b["id"])["card_ids"] == sorted([one["id"], two["id"]])
    # 权重和参考音频都一样的是重复的声音;换了一段参考就不是;什么都没填的空声音没得比
    assert entry(items, same["id"])["content_key"] == got["content_key"]
    assert entry(items, b["id"])["content_key"] is None
    emotion = next(v for v in ok(client.get("/api/voices")) if v["id"] == same["id"])["emotions"][0]
    ok(client.put(f"/api/voices/{same['id']}/emotions/{emotion['id']}", json={"ref_path": "D:/refs/【平静】别的.wav"}))
    assert entry(lib(client, "voice"), same["id"])["content_key"] not in (None, got["content_key"])


def test_packs_from_an_import_point_at_the_newest_import_job_still_in_effect(client):
    from tests.test_importer_api import do_import, undo

    _, result = do_import(client, {"Seraphina/expressions/joy.png": png("joy"), "Seraphina/expressions/sad.png": png("sad")})
    [pack] = ok(client.get(SPRITES))
    assert entry(lib(client, "sprite"), pack["id"])["import_job_id"] == result["job_id"]

    later = datetime.now(timezone.utc) + timedelta(hours=1)
    with session() as db:
        db.add(ImportJob(id="newer", created_at=later, status="done", created={"sprite_packs": [pack["id"]]}))
        db.add(ImportJob(id="undone", created_at=later + timedelta(hours=1), status="undone", created={"sprite_packs": [pack["id"]]}))
        db.commit()
    assert entry(lib(client, "sprite"), pack["id"])["import_job_id"] == "newer"

    undo(client, result["job_id"])
    assert lib(client, "sprite") == []


def test_files_not_yet_in_the_file_store_count_their_size_from_the_database(client):
    pack = new_sprite_pack(client, "老包")
    row = add_sprite(client, pack["id"], "微笑", None)
    scene = new_scene_pack(client, "老场景")
    bg = add_scene(client, scene["id"], "bg", "庵", None)
    with session() as db:
        sprite = db.get(PackSprite, row["id"])
        sprite.image, sprite.mime = png("old", w=24), "image/png"
        asset = db.get(SceneAsset, bg["id"])
        asset.data, asset.mime, asset.size = png("old bg"), "image/png", len(png("old bg"))
        db.commit()
    got = entry(lib(client, "sprite"), pack["id"])
    assert (got["bytes"], got["cover_sha"]) == (len(png("old", w=24)), None)
    assert got["content_key"] is not None
    assert entry(lib(client, "bg"), scene["id"])["bytes"] == len(png("old bg"))


def test_unknown_kinds_are_rejected(client):
    assert client.get("/api/library/preset").status_code == 404
    assert client.get("/api/library/preset/x/usage").status_code == 404


# ── 列表的查询次数不跟着包的个数涨 ──


@contextmanager
def counting() -> Iterator[list[str]]:
    with session() as db:
        engine = db.get_bind()
    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", count)


def queries_for(client: TestClient, kind: str) -> int:
    with counting() as statements:
        lib(client, kind)
    return len(statements)


@pytest.mark.parametrize("kind", ["sprite", "bg", "bgm", "cg", "voice"])
def test_listing_takes_the_same_number_of_queries_however_many_packs_there_are(client, make_card, kind):
    conn = new_conn(client)

    def add(i: int) -> None:
        card = make_card(name=f"卡{i}")
        if kind == "sprite":
            p = new_sprite_pack(client, f"包{i}")
            add_sprite(client, p["id"], "微笑", png(f"s{i}"))
            bind_sprites(client, card["id"], [p["id"]])
        elif kind in ("bg", "bgm"):
            p = new_scene_pack(client, f"包{i}")
            add_scene(client, p["id"], "bg", "庵", png(f"b{i}"))
            add_scene(client, p["id"], "bgm", "日常", mp3(f"m{i}"))
            ok(client.put(f"/api/tavern/cards/{card['id']}/scene-packs", json={"bg": [p["id"]], "bgm": [p["id"]]}))
        elif kind == "cg":
            p = new_cg_pack(client, f"包{i}")
            comp = add_cg(client, p["id"], "烟花", png(f"c{i}"))
            add_cg(client, p["id"], "开心", png(f"v{i}"), parent_id=comp["id"])
            ok(client.put(f"/api/tavern/cards/{card['id']}/cg-packs", json={"pack_ids": [p["id"]]}))
        else:
            v = ok(client.post("/api/voices", json={"name": f"声音{i}", "connection_id": conn["id"]}))
            ok(client.post(f"/api/voices/{v['id']}/emotions", json={"label": "平静", "ref_path": f"D:/r{i}.wav"}))
            ok(client.put(f"/api/tavern/cards/{card['id']}/voices", json={"main": v["id"]}))

    for i in range(2):
        add(i)
    few = queries_for(client, kind)
    for i in range(2, 10):
        add(i)
    assert len(lib(client, kind)) == 10
    assert queries_for(client, kind) == few <= 8


# ── 删之前问一句 ──


def usage(client: TestClient, kind: str, item_id: str) -> dict:
    return ok(client.get(f"/api/library/{kind}/{item_id}/usage"))


def effects(u: dict) -> dict[str, str]:
    return {c["name"]: c["effect"] for c in u["cards"]}


def test_sprite_usage_says_which_outfit_each_card_falls_back_to(client, make_card):
    stage = new_sprite_pack(client, "舞台装")
    add_sprite(client, stage["id"], "微笑", png("smile"))
    add_sprite(client, stage["id"], "生气", png("angry", w=16))
    add_sprite(client, stage["id"], "草稿", None)
    casual = new_sprite_pack(client, "私服")
    a, b, c = make_card(name="A卡"), make_card(name="B卡"), make_card(name="C卡")
    bind_sprites(client, a["id"], [stage["id"], casual["id"]], stage["id"])
    bind_sprites(client, b["id"], [stage["id"]])
    bind_sprites(client, c["id"], [casual["id"], stage["id"]], casual["id"])

    size = len(png("smile")) + len(png("angry", w=16))
    assert usage(client, "sprite", stage["id"]) == {
        "cards": [
            {"id": a["id"], "name": "A卡", "effect": "正在用这套;删了会换成「私服」"},
            {"id": b["id"], "name": "B卡", "effect": "正在用这套;删了就没有立绘了"},
            {"id": c["id"], "name": "C卡", "effect": "挂着没在用;删了就少一套可换"},
        ],
        "files": 2,
        "bytes": size,
        "by_kind": {"sprite": {"files": 2, "bytes": size}},
        "other_kinds": [],
    }
    # 删了以后真是这样
    ok(client.delete(f"{SPRITES}/{stage['id']}"), 204)
    current = {n: ok(client.get(f"/api/tavern/cards/{x['id']}/sprite-packs"))["current"] for n, x in (("A", a), ("B", b), ("C", c))}
    assert current == {"A": casual["id"], "B": None, "C": casual["id"]}
    assert client.get(f"/api/library/sprite/{stage['id']}/usage").status_code == 404


def test_scene_usage_covers_both_sides_because_the_whole_pack_goes(client, make_card):
    w = two_sided_scenes(client, make_card)
    s5 = new_scene_pack(client, "S5")
    add_scene(client, s5["id"], "bg", "山", png("hill"))
    four, five = make_card(name="四"), make_card(name="五")
    ok(client.put(f"/api/tavern/cards/{four['id']}/scene-packs", json={"bg": [w["S2"]["id"]], "bgm": []}))
    ok(client.put(f"/api/tavern/cards/{five['id']}/scene-packs", json={"bg": [w["S1"]["id"], w["S3"]["id"], s5["id"]], "bgm": []}))

    u = usage(client, "bg", w["S1"]["id"])
    bg_size, bgm_size = len(png("hut")) + len(png("spring", w=16)), len(mp3("daily"))
    assert {c["name"]: (c["effect"], c["parts"]) for c in u["cards"]} == {
        "一": ("还有「S3」的背景", ["bg"]),
        "二": ("删了这张卡就没有背景和 BGM 了", ["bg", "bgm"]),
        # 在背景页删,只出曲子的卡也受影响(删的是整个包)
        "三": ("删了这张卡就没有 BGM 了", ["bgm"]),
        "五": ("还有「S3」等 2 个包的背景", ["bg"]),
    }
    assert (u["files"], u["bytes"], u["other_kinds"]) == (3, bg_size + bgm_size, ["bgm"])
    assert u["by_kind"] == {"bg": {"files": 2, "bytes": bg_size}, "bgm": {"files": 1, "bytes": bgm_size}}

    assert effects(usage(client, "bg", w["S3"]["id"])) == {"一": "还有「S1」的背景", "五": "还有「S1」等 2 个包的背景"}
    s2 = usage(client, "bgm", w["S2"]["id"])
    # 「四」把只有曲子的 S2 绑在了背景那边:用不到它的东西
    assert effects(s2) == {"一": "删了这张卡就没有 BGM 了", "四": "绑着,但没用到这个包里的东西;删了没影响"}
    assert s2["other_kinds"] == []
    assert client.get("/api/library/bgm/nope/usage").status_code == 404


def test_scene_usage_mentions_cgs_only_when_they_have_not_been_split_off(client):
    split = new_scene_pack(client, "拆过的")
    add_scene(client, split["id"], "bg", "庵", png("hut"))
    add_scene(client, split["id"], "cg", "温泉夜", png("night"))
    u = usage(client, "bg", split["id"])
    # 拆出去的 CG 包留着,不算这次删掉的
    assert (u["other_kinds"], u["files"], list(u["by_kind"])) == ([], 1, ["bg"])

    unsplit = new_scene_pack(client, "没拆的")
    add_scene(client, unsplit["id"], "bg", "庵", png("hut"))
    with session() as db:
        db.add(SceneAsset(pack_id=unsplit["id"], kind="cg", label="烟花", mime="image/png", size=4, data_sha=sha_of(b"fire")))
        db.commit()
    u = usage(client, "bg", unsplit["id"])
    assert (u["other_kinds"], u["files"], u["by_kind"]["cg"]) == (["cg"], 2, {"files": 1, "bytes": 4})


def test_cg_usage(client, make_card):
    pack, _ = fireworks(client)
    other = new_cg_pack(client, "别的 CG")
    a, b = make_card(name="A卡"), make_card(name="B卡")
    ok(client.put(f"/api/tavern/cards/{a['id']}/cg-packs", json={"pack_ids": [pack["id"]]}))
    ok(client.put(f"/api/tavern/cards/{b['id']}/cg-packs", json={"pack_ids": [other["id"], pack["id"]]}))
    u = usage(client, "cg", pack["id"])
    size = len(png("sky")) + len(png("sky smile")) + len(png("stall"))
    assert effects(u) == {"A卡": "删了这张卡就没有 CG 了", "B卡": "删了就少这些 CG"}
    assert (u["files"], u["bytes"], u["by_kind"], u["other_kinds"]) == (3, size, {"cg": {"files": 3, "bytes": size}}, [])
    assert "parts" not in u["cards"][0]
    assert client.get("/api/library/cg/nope/usage").status_code == 404


def test_voice_usage(client, make_card):
    conn = new_conn(client)
    v = ok(client.post("/api/voices", json={"name": "阿米娅", "connection_id": conn["id"]}))
    other = ok(client.post("/api/voices", json={"name": "琴柳", "connection_id": conn["id"]}))
    for label in ("平静", "开心", "生气"):
        ok(client.post(f"/api/voices/{v['id']}/emotions", json={"label": label, "ref_path": f"D:/refs/【{label}】你好.wav"}))
    a, b = make_card(name="A卡"), make_card(name="B卡")
    ok(client.put(f"/api/tavern/cards/{a['id']}/voices", json={"main": v["id"]}))
    ok(client.put(f"/api/tavern/cards/{b['id']}/voices", json={"main": other["id"], "extras": [v["id"]]}))
    u = usage(client, "voice", v["id"])
    assert effects(u) == {"A卡": "主声音;删了就不念台词", "B卡": "备用声音"}
    # 参考音频在语音机上,不删:files 是情绪的行数
    assert (u["files"], u["bytes"], u["by_kind"], u["other_kinds"]) == (3, 0, {"voice": {"files": 3, "bytes": 0}}, [])
    assert client.get("/api/library/voice/nope/usage").status_code == 404
