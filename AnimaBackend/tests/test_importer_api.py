"""导入的接口(实施计划第 3 段 B5):出计划 → 执行(一个事务里建卡、建包、绑定,记一条导入记录)→ 认领没认出来的文件 → 撤销。

三个综合用例端到端走一遍(酒馆卡 + 平铺表情 zip;「角色素材\\刻晴」那种角色文件夹拖到已有的卡上;
带 import.json 的 CG 文件夹),外加重复包「另存一份 / 共用」、卡「更新」再撤销、中途出错整体回滚、认领、
拖到卡上不换当前服装、超大文件跳过、暂存清理。素材都是合成的:图用 cv2.imencode,曲子是假的 MP3 头或者
wave 模块写的真 WAV(装了 PyAV 时它会转成 m4a)。
"""

import json
import os
import time
import zipfile
import zlib
from io import BytesIO
from pathlib import Path, PurePosixPath

import cv2
import numpy as np
import pytest

from app.config import settings
from app.importer import staging
from app.storage import refs
from tests.fixtures.cards.make_cards import b64, png
from tests.test_importer_audio import real_wav

API = "/api/import"


# ── 素材 ──


def _color(seed: str) -> tuple[int, int, int]:
    n = zlib.crc32(seed.encode("utf-8"))
    return n & 255, (n >> 8) & 255, (n >> 16) & 255


def img(seed: str) -> bytes:
    """内容各不相同的小 PNG"""
    return cv2.imencode(".png", np.full((6, 8, 3), _color(seed), np.uint8))[1].tobytes()


def jpg(seed: str) -> bytes:
    arr = np.full((9, 16, 3), _color(seed), np.uint8)
    arr[0, 0] = (zlib.crc32(seed.encode()) >> 24) & 255
    return cv2.imencode(".jpg", arr)[1].tobytes()


def noise_png(seed: int = 1, size: int = 64) -> bytes:
    """压不小的 PNG(十几 KB),测大小上限用"""
    rng = np.random.default_rng(seed)
    return cv2.imencode(".png", rng.integers(0, 256, (size, size, 3), dtype=np.uint8))[1].tobytes()


def mp3(seed: str) -> bytes:
    return b"ID3\x04\x00\x00\x00\x00\x00\x00" + seed.encode("utf-8") + bytes(32)


def fake_wav(seed: str) -> bytes:
    return b"RIFF\x00\x00\x00\x00WAVEfmt " + seed.encode("utf-8") + bytes(16)


def card_png(name: str, **fields) -> bytes:
    return png(("chara", b64({"spec": "chara_card_v2", "data": {"name": name, **fields}})))


def js(value) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def zipped(entries: dict[str, bytes]) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


EXPRESSIONS = ["joy", "joy-1", "neutral", "admiration", "anger", "love", "surprise"]


def seraphina_files() -> dict[str, bytes]:
    return {
        "Seraphina.png": card_png("Seraphina", description="森林守护者", first_mes="你醒了", alternate_greetings=["又见面了"]),
        "expressions.zip": zipped({f"Seraphina/{n}.png": img(n) for n in EXPRESSIONS}),
    }


# ── 接口 ──


def plan(client, files: dict[str, bytes], target: str | None = None, kind: str | None = None, status: int = 200):
    parts = [("files", (PurePosixPath(p).name, data, "application/octet-stream")) for p, data in files.items()]
    form = {"paths": json.dumps(list(files), ensure_ascii=False)}
    if target is not None:
        form["target_card_id"] = target
    if kind is not None:
        form["kind"] = kind
    r = client.post(f"{API}/plan", files=parts, data=form)
    assert r.status_code == status, r.text
    return r.json()


def apply(client, plan_id: str, status: int = 200, **body):
    r = client.post(f"{API}/{plan_id}/apply", json=body)
    assert r.status_code == status, r.text
    return r.json()


def do_import(client, files, target=None, kind=None, **body) -> tuple[dict, dict]:
    p = plan(client, files, target, kind)
    return p, apply(client, p["plan_id"], **body)


def undo(client, job_id: str, status: int = 200):
    r = client.post(f"{API}/jobs/{job_id}/undo")
    assert r.status_code == status, r.text
    return r.json()


def get(client, url: str):
    r = client.get(url)
    assert r.status_code == 200, r.text
    return r.json()


def group(p: dict, type_: str, n: int = 0) -> dict:
    return [g for g in p["groups"] if g["type"] == type_][n]


def sprite_packs_of(client, card_id: str) -> dict:
    out = get(client, f"/api/tavern/cards/{card_id}/sprite-packs")
    return {"pack_ids": out["pack_ids"], "current": out["current"]}


def scene_parts_of(client, card_id: str) -> dict:
    out = get(client, f"/api/tavern/cards/{card_id}/scene-packs")
    return {"bg": out["bg"], "bgm": out["bgm"]}


def pack_names(client, kind: str) -> list[str]:
    url = {"sprite": "/api/sprite-packs", "scene": "/api/scene-packs", "cg": "/api/cg-packs"}[kind]
    return [p["name"] for p in get(client, url)]


def pack_named(client, kind: str, name: str) -> dict:
    url = {"sprite": "/api/sprite-packs", "scene": "/api/scene-packs", "cg": "/api/cg-packs"}[kind]
    found = [p for p in get(client, url) if p["name"] == name]
    assert len(found) == 1, [p["name"] for p in get(client, url)]
    return found[0]


def sprites(client, pack_id: str) -> list[dict]:
    return get(client, f"/api/sprite-packs/{pack_id}/sprites")


def has_line(lines: list[str], *parts: str) -> bool:
    return any(all(p in line for p in parts) for line in lines)


def jobs(client) -> list[dict]:
    return get(client, f"{API}/jobs")


# ── 综合 1:酒馆卡 + 平铺表情 zip ──


def test_tavern_card_with_a_flat_expression_zip(client):
    p = plan(client, seraphina_files())
    assert p["needs_confirm"] is False
    assert [(g["key"], g["type"], g["name"], g["count"], g["owner"], g["duplicate_of"]) for g in p["groups"]] == [
        ("card:1", "card", "Seraphina", 1, None, None),
        ("sprite_pack:1", "sprite_pack", "Seraphina", 6, "card:1", None),
    ]
    assert p["unknown"] == []
    assert has_line(p["skipped"], "joy-1.png", "备用图")

    result = apply(client, p["plan_id"])
    assert result["job_id"] == p["plan_id"]
    card_id = result["card_id"]
    assert result["notice"] == {
        "title": "Seraphina.png 导入完成 · 已自动绑定配套的立绘",
        "detail": "新建 角色卡 1 张、立绘包 1 个",
        "unknown": [],
    }
    report = result["report"]
    assert has_line(report, "角色卡「Seraphina」", "开场白 2 条")
    assert has_line(report, "立绘包「Seraphina」6 张", "中文别名 12 个", "默认差分 neutral")
    assert has_line(report, "joy-1.png", "备用图")
    assert has_line(report, "6 张没找到脸")

    card = get(client, f"/api/tavern/cards/{card_id}")
    assert (card["name"], card["description"], card["alternate_greetings"], card["has_avatar"]) == (
        "Seraphina",
        "森林守护者",
        ["又见面了"],
        True,
    )
    pack = pack_named(client, "sprite", "Seraphina")
    assert sprite_packs_of(client, card_id) == {"pack_ids": [pack["id"]], "current": pack["id"]}
    rows = sprites(client, pack["id"])
    assert [r["label"] for r in rows] == ["neutral", "admiration", "anger", "joy", "love", "surprise"]
    assert [r["sort"] for r in rows] == list(range(6))
    assert rows[0]["aliases"] == ["平静", "默认"] and rows[3]["aliases"] == ["开心", "高兴"]
    assert all(r["has_image"] and r["face_scan"] is not None for r in rows)
    image = client.get(f"/api/sprite-packs/{pack['id']}/sprites/{rows[3]['id']}/image")
    assert image.content == img("joy")

    listed = jobs(client)
    assert [(j["id"], j["title"], j["status"], j["card_id"]) for j in listed] == [
        (p["plan_id"], "Seraphina.png + 1 个文件", "done", card_id)
    ]
    assert listed[0]["counts"] == {
        "cards": 1,
        "sprite_packs": 1,
        "scene_packs": 0,
        "cg_packs": 0,
        "bound": 0,
        "updated_cards": 0,
        "unknown": 0,
    }

    preview = get(client, f"{API}/jobs/{p['plan_id']}/undo-preview")
    assert preview["cards"] == [{"id": card_id, "name": "Seraphina"}]
    assert preview["packs"] == [{"kind": "sprite", "id": pack["id"], "name": "Seraphina", "other_cards": []}]
    assert (preview["unbind"], preview["restore_cards"]) == ([], [])
    assert has_line(preview["lines"], "角色卡「Seraphina」")

    done = undo(client, p["plan_id"])
    assert done["status"] == "undone"
    assert client.get(f"/api/tavern/cards/{card_id}").status_code == 404
    assert get(client, "/api/sprite-packs") == []
    assert jobs(client)[0]["status"] == "undone"
    undo(client, p["plan_id"], status=409)


# ── 综合 2:「角色素材\刻晴」那种文件夹拖到已有的卡上 ──


def keqing_files() -> dict[str, bytes]:
    return {
        "刻晴/刻晴角色卡.md": "# 刻晴".encode(),
        "刻晴/立绘（玉衡星）/00_微笑.png": img("a smile"),
        "刻晴/立绘（玉衡星）/01_开心.png": img("a joy"),
        "刻晴/立绘（玉衡星）/02_喜爱.png": img("a love"),
        "刻晴/立绘（玉衡星·平涂）/00_微笑.png": img("b smile"),
        "刻晴/立绘（玉衡星·平涂）/01_开心.png": img("b joy"),
        "刻晴/背景/刻晴的房间.jpg": jpg("room"),
        "刻晴/背景/璃月港·夜.jpg": jpg("port"),
        "刻晴/BGM候选/原神.mp3": mp3("原神"),
        "刻晴/BGM候选/杯中明月.mp3": mp3("杯中明月"),
        "刻晴/BGM候选/晚安_璃月.wav": real_wav(),
        "刻晴/BGM候选/落选.mp3": mp3("落选"),
        "刻晴/BGM候选/picks.json": js({"封面": ["原神.mp3"], "日常": ["杯中明月.mp3"], "温馨": ["晚安_璃月.wav"]}),
        "刻晴/语音参考/gen_zh/vo_keqing_01.wav": fake_wav("1"),
        "刻晴/语音参考/index.html": b"<html>",
    }


def test_character_folder_dropped_onto_an_existing_card(client, make_card, make_sprite_pack):
    card = make_card(name="刻晴")["id"]
    old_sprites = make_sprite_pack("刻晴 · 旧", card_id=card)["id"]
    old_scene = client.post("/api/scene-packs", json={"name": "原神 · 璃月"}).json()["id"]
    client.put(f"/api/tavern/cards/{card}/scene-packs", json={"bg": [old_scene], "bgm": [old_scene]})
    old_cg = client.post("/api/cg-packs", json={"name": "旧 CG"}).json()["id"]
    client.put(f"/api/tavern/cards/{card}/cg-packs", json={"pack_ids": [old_cg]})
    before = (sprite_packs_of(client, card), scene_parts_of(client, card))

    p = plan(client, keqing_files(), target=card)
    assert p["needs_confirm"] is True
    assert [(g["type"], g["name"], g["count"], g["owner"]) for g in p["groups"]] == [
        ("sprite_pack", "刻晴 · 玉衡星", 3, "target"),
        ("sprite_pack", "刻晴 · 玉衡星·平涂", 2, "target"),
        ("scene_pack", "刻晴", 5, "target"),
    ]
    scene_group = group(p, "scene_pack")
    assert (scene_group["bg_count"], scene_group["bgm_count"]) == (2, 3)

    result = apply(client, p["plan_id"])
    assert result["card_id"] == card
    assert result["notice"]["title"] == "刻晴 导入完成 · 已自动绑定配套的立绘、背景、BGM"
    report = result["report"]
    assert has_line(report, "立绘包「刻晴 · 玉衡星」3 张", "默认差分 微笑")
    assert has_line(report, "场景包「刻晴」", "背景 2 张", "曲子 3 首", "封面曲 原神")
    assert has_line(report, "当前服装", "刻晴 · 旧")
    assert has_line(report, "声音包这次不认")
    assert has_line(report, "1 首没挑中")

    official = pack_named(client, "sprite", "刻晴 · 玉衡星")
    flat = pack_named(client, "sprite", "刻晴 · 玉衡星·平涂")
    assert [r["label"] for r in sprites(client, official["id"])] == ["微笑", "开心", "喜爱"]
    # 原有的卡只「再挂一套」,当前服装不换
    assert sprite_packs_of(client, card) == {"pack_ids": [old_sprites, official["id"], flat["id"]], "current": old_sprites}

    scene = pack_named(client, "scene", "刻晴")
    assert scene_parts_of(client, card) == {"bg": [old_scene, scene["id"]], "bgm": [old_scene, scene["id"]]}
    assets = get(client, f"/api/scene-packs/{scene['id']}/assets")
    bg = [a for a in assets if a["kind"] == "bg"]
    bgm = [a for a in assets if a["kind"] == "bgm"]
    assert [a["label"] for a in bg] == ["刻晴的房间", "璃月港·夜"]
    assert [a["label"] for a in bgm] == ["原神", "日常", "温馨"]
    assert scene["title_bgm_id"] == bgm[0]["id"]
    assert bgm[0]["mime"] == "audio/mpeg"
    if pytest.importorskip("app.importer.audio").available():
        # WAV 转成了 m4a
        assert bgm[2]["mime"] == "audio/mp4"
        data = client.get(f"/api/scene-packs/{scene['id']}/assets/{bgm[2]['id']}/file").content
        assert data[4:8] == b"ftyp"
        assert has_line(report, "转成了 m4a")
    # CG 没导,原来的 CG 包照旧
    assert get(client, f"/api/tavern/cards/{card}/cg-packs")["pack_ids"] == [old_cg]

    job = jobs(client)[0]
    assert (job["title"], job["counts"]["bound"]) == ("刻晴", 3)
    preview = get(client, f"{API}/jobs/{p['plan_id']}/undo-preview")
    assert preview["cards"] == []
    assert [x["name"] for x in preview["packs"]] == ["刻晴 · 玉衡星", "刻晴 · 玉衡星·平涂", "刻晴"]
    assert all(x["other_cards"] == [] for x in preview["packs"])

    undo(client, p["plan_id"])
    assert (sprite_packs_of(client, card), scene_parts_of(client, card)) == before
    assert pack_names(client, "sprite") == ["刻晴 · 旧"]
    assert pack_names(client, "scene") == ["原神 · 璃月"]
    assert get(client, f"/api/tavern/cards/{card}")["name"] == "刻晴"


def test_background_only_and_music_only_drops_bind_one_side(client, make_card):
    card = make_card(name="刻晴")["id"]
    _, bg = do_import(client, {"背景/璃月港.jpg": jpg("port"), "背景/总务司.jpg": jpg("office")}, target=card)
    assert bg["notice"]["title"] == "背景 导入完成 · 已自动绑定配套的背景"
    bg_pack = pack_named(client, "scene", "刻晴 · 背景")
    _, music = do_import(client, {"bgm/日常.mp3": mp3("daily")}, target=card)
    assert music["notice"]["title"] == "bgm 导入完成 · 已自动绑定配套的BGM"
    bgm_pack = pack_named(client, "scene", "刻晴 · BGM")
    assert scene_parts_of(client, card) == {"bg": [bg_pack["id"]], "bgm": [bgm_pack["id"]]}
    undo(client, music["job_id"])
    assert scene_parts_of(client, card) == {"bg": [bg_pack["id"]], "bgm": []}


# ── 综合 3:带 import.json 的 CG 文件夹 ──


def test_cg_folder_with_a_manifest(client, make_card):
    card = make_card(name="爱弥斯")["id"]
    old_cg = client.post("/api/cg-packs", json={"name": "旧 CG"}).json()["id"]
    client.put(f"/api/tavern/cards/{card}/cg-packs", json={"pack_ids": [old_cg]})
    base = "C:\\Users\\someone\\Desktop\\角色素材\\爱弥斯\\CG\\"
    comps = {"海边烟花": ["开心", "害羞"], "雨中": ["难过"]}
    manifest = [
        {
            "name": name,
            "desc": f"{name} 的说明",
            "file": f"{base}{name}\\默认.jpg",
            "forms": ["日常"] if name == "雨中" else [],
            "focus": 30 if name == "海边烟花" else None,
            "variants": [{"label": v, "aliases": ["得意"] if v == "害羞" else [], "file": f"{base}{name}\\{v}.jpg"} for v in vs],
        }
        for name, vs in comps.items()
    ]
    files = {"CG/import.json": js(manifest)}
    for name, vs in comps.items():
        files[f"CG/{name}/默认.jpg"] = jpg(name)
        for v in vs:
            files[f"CG/{name}/{v}.jpg"] = jpg(name + v)
    p = plan(client, files, target=card)
    assert [(g["type"], g["name"], g["count"], g["owner"]) for g in p["groups"]] == [("cg_pack", "爱弥斯 · CG", 2, "target")]
    result = apply(client, p["plan_id"])
    assert result["notice"]["title"] == "CG 导入完成 · 已自动绑定配套的CG"
    assert has_line(result["report"], "CG 包「爱弥斯 · CG」2 个构图", "3 张差分")

    pack = pack_named(client, "cg", "爱弥斯 · CG")
    assert pack["generated"] is False
    assert get(client, f"/api/tavern/cards/{card}/cg-packs")["pack_ids"] == [old_cg, pack["id"]]
    rows = get(client, f"/api/cg-packs/{pack['id']}/assets")
    comps_out = [r for r in rows if r["parent_id"] is None]
    assert [(c["label"], c["description"], c["forms"], c["focus_x"]) for c in comps_out] == [
        ("海边烟花", "海边烟花 的说明", [], 30),
        ("雨中", "雨中 的说明", ["日常"], 50),
    ]
    variants = {c["label"]: [(v["label"], v["aliases"]) for v in rows if v["parent_id"] == c["id"]] for c in comps_out}
    assert variants == {"海边烟花": [("开心", []), ("害羞", ["得意"])], "雨中": [("难过", [])]}
    assert all(r["has_file"] for r in rows)

    undo(client, p["plan_id"])
    assert get(client, f"/api/tavern/cards/{card}/cg-packs")["pack_ids"] == [old_cg]
    assert pack_names(client, "cg") == ["旧 CG"]


def test_undo_also_deletes_packs_other_cards_started_using(client, make_card, make_sprite_pack):
    """已经被别的卡用上的包也照删:undo-preview 先列出来(确认框写「还有 N 张卡在用」)"""
    _, result = do_import(client, seraphina_files())
    pack = pack_named(client, "sprite", "Seraphina")["id"]
    other = make_card(name="别的卡")["id"]
    own = make_sprite_pack("自己的", card_id=other)["id"]
    client.put(f"/api/tavern/cards/{other}/sprite-packs", json={"pack_ids": [own, pack], "current": pack})
    preview = get(client, f"{API}/jobs/{result['job_id']}/undo-preview")
    assert preview["packs"][0]["other_cards"] == [{"id": other, "name": "别的卡"}]
    assert has_line(preview["lines"], "「别的卡」也在用")
    undo(client, result["job_id"])
    assert sprite_packs_of(client, other) == {"pack_ids": [own], "current": own}


def test_classifying_leftovers_into_new_packs_later(client):
    """导完再认领:没有同类包就新建「角色 · 补充」;卡还没有立绘时它成为当前服装;WAV 当 BGM 时转成 m4a"""
    files = {"Seraphina.png": card_png("Seraphina"), "IMG_1.png": img("1"), "song.wav": real_wav(), "IMG_2.png": img("2")}
    p = plan(client, files)
    # 根上散着的曲子本来就当 BGM;两张图没认出来
    assert p["unknown"] == ["IMG_1.png", "IMG_2.png"]
    result = apply(client, p["plan_id"])
    job, card = result["job_id"], result["card_id"]
    r = client.post(f"{API}/jobs/{job}/classify", json={"path": "IMG_1.png", "kind": "sprite"}).json()
    pack = pack_named(client, "sprite", "Seraphina · 补充")["id"]
    assert sprite_packs_of(client, card) == {"pack_ids": [pack], "current": pack}
    r = client.post(f"{API}/jobs/{job}/classify", json={"path": "IMG_2.png", "kind": "cg"}).json()
    assert r["notice"]["unknown"] == []
    cg = pack_named(client, "cg", "Seraphina · 补充")["id"]
    assert get(client, f"/api/tavern/cards/{card}/cg-packs")["pack_ids"] == [cg]
    assert r["notice"]["title"] == "Seraphina.png 导入完成 · 已自动绑定配套的立绘、BGM、CG"
    # 认领完暂存目录就不留了
    assert not (Path(settings.import_staging_dir) / job).exists()
    undo(client, job)
    assert get(client, "/api/sprite-packs") == [] and get(client, "/api/cg-packs") == [] and get(client, "/api/scene-packs") == []


# ── 重复导入 ──


def test_repeat_import_defaults_to_a_new_copy_and_share_binds_the_existing_pack(client, make_card):
    first, second = make_card(name="甲")["id"], make_card(name="乙")["id"]
    files = {"expressions/joy.png": img("joy"), "expressions/neutral.png": img("neutral")}
    _, a = do_import(client, files, target=first)
    original = sprite_packs_of(client, first)["current"]

    p = plan(client, files, target=second)
    g = group(p, "sprite_pack")
    assert g["duplicate_of"] == {"id": original, "name": "甲", "card_count": 1}
    assert p["needs_confirm"] is True
    copy = apply(client, p["plan_id"])
    assert has_line(copy["report"], "一模一样", "另存了一份")
    new_pack = sprite_packs_of(client, second)["current"]
    assert new_pack not in (None, original)
    shas = lambda pid: sorted(r["image_sha"] for r in sprites(client, pid))  # noqa: E731
    assert shas(new_pack) == shas(original)  # 文件按指纹共用
    undo(client, copy["job_id"])
    assert sprite_packs_of(client, second) == {"pack_ids": [], "current": None}

    p = plan(client, files, target=second)
    shared = apply(client, p["plan_id"], decisions={group(p, "sprite_pack")["key"]: "share"})
    assert has_line(shared["report"], "共用")
    assert sprite_packs_of(client, second) == {"pack_ids": [original], "current": original}
    assert pack_names(client, "sprite") == ["甲"]
    assert jobs(client)[0]["counts"]["sprite_packs"] == 0
    undo(client, shared["job_id"])
    # 共用的包不删,只从乙身上拿掉
    assert sprite_packs_of(client, second) == {"pack_ids": [], "current": None}
    assert sprite_packs_of(client, first) == {"pack_ids": [original], "current": original}


def test_a_duplicate_card_is_saved_as_another_card_by_default(client, make_card):
    old = make_card(name="Seraphina", description="森林守护者", first_mes="你醒了")["id"]
    p = plan(client, {"Seraphina.png": card_png("Seraphina", description="森林守护者", first_mes="你醒了")})
    assert group(p, "card")["duplicate_of"] == {"id": old, "name": "Seraphina"}
    assert p["needs_confirm"] is True
    result = apply(client, p["plan_id"])
    assert result["card_id"] != old
    assert [c["name"] for c in get(client, "/api/tavern/cards")] == ["Seraphina", "Seraphina"]
    assert result["notice"]["title"] == "Seraphina.png 导入完成"


def test_updating_a_duplicate_card_and_undoing_restores_its_old_fields(client, make_card, make_debug_chat, make_sprite_pack):
    old = make_card(
        name="Seraphina", description="森林守护者", first_mes="你醒了", tags=["旧"], creator="旧作者", alternate_greetings=[]
    )["id"]
    chat = make_debug_chat(card_id=old)
    pack = make_sprite_pack("旧立绘", card_id=old)["id"]
    files = {
        "Seraphina.png": card_png(
            "Seraphina", description="森林守护者", first_mes="你醒了", tags=["新"], creator="新作者", alternate_greetings=["又见面了"]
        )
    }
    p = plan(client, files)
    result = apply(client, p["plan_id"], decisions={"card:1": "update"})
    assert result["card_id"] == old
    assert has_line(result["report"], "更新了角色卡「Seraphina」")
    assert result["notice"]["detail"] == "更新 角色卡 1 张"
    card = get(client, f"/api/tavern/cards/{old}")
    assert (card["tags"], card["creator"], card["alternate_greetings"], card["has_avatar"]) == (["新"], "新作者", ["又见面了"], True)
    assert len(get(client, "/api/tavern/cards")) == 1
    # 对话和绑定都留着
    assert get(client, f"/api/debug/chats/{chat['id']}")["card_id"] == old
    assert sprite_packs_of(client, old) == {"pack_ids": [pack], "current": pack}
    assert jobs(client)[0]["counts"]["updated_cards"] == 1
    preview = get(client, f"{API}/jobs/{result['job_id']}/undo-preview")
    assert preview["restore_cards"] == [{"id": old, "name": "Seraphina"}]

    undo(client, result["job_id"])
    card = get(client, f"/api/tavern/cards/{old}")
    assert (card["tags"], card["creator"], card["alternate_greetings"], card["has_avatar"]) == (["旧"], "旧作者", [], False)
    assert get(client, f"/api/debug/chats/{chat['id']}")["card_id"] == old
    assert sprite_packs_of(client, old) == {"pack_ids": [pack], "current": pack}


# ── 事务 ──


def test_a_failure_halfway_rolls_everything_back_and_keeps_the_staged_files(client, monkeypatch):
    files = {
        **seraphina_files(),
        "CG/海边/默认.png": img("sea"),
        "CG/海边/开心.png": img("sea joy"),
    }
    p = plan(client, files)
    real = refs.save

    def boom(ref, *args, **kwargs):
        if ref is refs.CG_ASSET:
            raise RuntimeError("磁盘满了")
        return real(ref, *args, **kwargs)

    monkeypatch.setattr(refs, "save", boom)
    r = client.post(f"{API}/{p['plan_id']}/apply", json={})
    assert r.status_code == 500
    assert "导入失败" in r.json()["detail"] and "磁盘满了" in r.json()["detail"]
    assert get(client, "/api/tavern/cards") == []
    assert get(client, "/api/sprite-packs") == []
    assert get(client, "/api/cg-packs") == []
    assert jobs(client) == []
    assert (Path(settings.import_staging_dir) / p["plan_id"] / "files" / "Seraphina.png").is_file()

    monkeypatch.setattr(refs, "save", real)
    result = apply(client, p["plan_id"])
    assert [c["name"] for c in get(client, "/api/tavern/cards")] == ["Seraphina"]
    assert result["notice"]["title"] == "Seraphina.png 导入完成 · 已自动绑定配套的立绘、CG"
    apply(client, p["plan_id"], status=409)


# ── 认领没认出来的文件 ──


def test_classifying_an_unknown_file_after_the_import(client):
    p = plan(client, {"Seraphina.png": card_png("Seraphina"), "IMG_0231.png": img("photo")})
    assert p["unknown"] == ["IMG_0231.png"]
    result = apply(client, p["plan_id"])
    assert result["notice"] == {"title": "Seraphina.png 导入完成", "detail": "新建 角色卡 1 张", "unknown": ["IMG_0231.png"]}
    assert has_line(result["report"], "1 个文件没认出来", "IMG_0231.png")
    job = result["job_id"]

    bad = client.post(f"{API}/jobs/{job}/classify", json={"path": "nope.png", "kind": "bg"})
    assert bad.status_code == 400
    bad = client.post(f"{API}/jobs/{job}/classify", json={"path": "IMG_0231.png", "kind": "voice"})
    assert bad.status_code == 400
    bad = client.post(f"{API}/jobs/{job}/classify", json={"path": "IMG_0231.png", "kind": "bgm"})
    assert bad.status_code == 400  # 图不能当曲子

    r = client.post(f"{API}/jobs/{job}/classify", json={"path": "IMG_0231.png", "kind": "bg"})
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["job_id"] == job and after["card_id"] == result["card_id"]
    assert after["notice"]["unknown"] == []
    assert after["notice"]["title"] == "Seraphina.png 导入完成 · 已自动绑定配套的背景"
    assert has_line(after["report"], "IMG_0231.png", "Seraphina · 补充")
    pack = pack_named(client, "scene", "Seraphina · 补充")
    assert scene_parts_of(client, result["card_id"]) == {"bg": [pack["id"]], "bgm": []}
    assert [a["label"] for a in get(client, f"/api/scene-packs/{pack['id']}/assets")] == ["IMG_0231"]
    assert jobs(client)[0]["counts"]["scene_packs"] == 1

    undo(client, job)
    assert get(client, "/api/scene-packs") == []
    assert client.post(f"{API}/jobs/{job}/classify", json={"path": "IMG_0231.png", "kind": "bg"}).status_code == 409


def test_unknown_files_classified_in_the_confirm_dialog_join_the_new_pack(client):
    files = {**seraphina_files(), "IMG_0231.png": img("photo"), "IMG_0232.png": img("photo 2")}
    p = plan(client, files)
    assert p["unknown"] == ["IMG_0231.png", "IMG_0232.png"]
    bad = client.post(f"{API}/{p['plan_id']}/apply", json={"classify": {"other.png": "sprite"}})
    assert bad.status_code == 400
    result = apply(client, p["plan_id"], classify={"IMG_0231.png": "sprite", "IMG_0232.png": "skip"})
    assert result["notice"]["unknown"] == []
    pack = pack_named(client, "sprite", "Seraphina")
    assert [r["label"] for r in sprites(client, pack["id"])][-1] == "IMG_0231"


def test_the_result_lists_what_was_created(client):
    """created:这次新建的卡和包(按建的先后,共用库里的不算;认领时新建的补充包也记进去)。
    没有卡可开时前端照它打开素材管理页、选中第一个新建的包"""
    _, with_card = do_import(client, seraphina_files())
    assert with_card["created"] == {
        "cards": [with_card["card_id"]],
        "sprite_packs": [pack_named(client, "sprite", "Seraphina")["id"]],
        "scene_packs": [],
        "cg_packs": [],
    }

    # 只有包、没拖到卡上:card_id 是 null
    sprite_files = {"立绘/joy.png": img("n joy"), "立绘/neutral.png": img("n neutral")}
    p = plan(client, {**sprite_files, "bgm/日常.mp3": mp3("daily"), "IMG_1.png": img("1")})
    assert p["unknown"] == ["IMG_1.png"]
    result = apply(client, p["plan_id"])
    assert result["card_id"] is None
    (sprite,) = [s["id"] for s in get(client, "/api/sprite-packs") if s["name"] != "Seraphina"]
    (music,) = [s["id"] for s in get(client, "/api/scene-packs")]
    assert result["created"] == {"cards": [], "sprite_packs": [sprite], "scene_packs": [music], "cg_packs": []}

    after = client.post(f"{API}/jobs/{result['job_id']}/classify", json={"path": "IMG_1.png", "kind": "cg"}).json()
    extra = pack_named(client, "cg", "补充")["id"]
    assert after["created"] == {**result["created"], "cg_packs": [extra]}

    # 再拖一次同样的立绘、选「不导这份」:什么都没新建
    again = plan(client, sprite_files)
    key = group(again, "sprite_pack")["key"]
    shared = apply(client, again["plan_id"], decisions={key: "share"})
    assert shared["created"] == {"cards": [], "sprite_packs": [], "scene_packs": [], "cg_packs": []}


# ── 拖到卡上不换当前服装 ──


def test_dropping_sprites_on_a_card_keeps_its_current_outfit_unless_asked(client, make_card, make_sprite_pack):
    card = make_card(name="Anima")["id"]
    old = make_sprite_pack("旧", card_id=card)["id"]
    _, first = do_import(client, {"夜莺/joy.png": img("n joy"), "夜莺/neutral.png": img("n neutral")}, target=card)
    nightingale = pack_named(client, "sprite", "Anima · 夜莺")["id"]
    assert sprite_packs_of(client, card) == {"pack_ids": [old, nightingale], "current": old}

    _, second = do_import(
        client, {"泳装/joy.png": img("s joy"), "泳装/anger.png": img("s anger")}, target=card, make_current=True
    )
    swimsuit = pack_named(client, "sprite", "Anima · 泳装")["id"]
    assert sprite_packs_of(client, card) == {"pack_ids": [old, nightingale, swimsuit], "current": swimsuit}
    assert has_line(second["report"], "当前服装换成了「Anima · 泳装」")

    undo(client, second["job_id"])
    assert sprite_packs_of(client, card) == {"pack_ids": [old, nightingale], "current": old}


def test_a_card_without_sprites_gets_the_first_dropped_set_as_current(client, make_card):
    card = make_card(name="Anima")["id"]
    do_import(client, {"夜莺/joy.png": img("n joy"), "夜莺/neutral.png": img("n neutral")}, target=card)
    pack = pack_named(client, "sprite", "Anima · 夜莺")["id"]
    assert sprite_packs_of(client, card) == {"pack_ids": [pack], "current": pack}


# ── 名字、大小 ──


def test_pack_names_taken_in_the_library_get_a_number(client, make_card):
    client.post("/api/sprite-packs", json={"name": "Seraphina"})
    _, result = do_import(client, seraphina_files())
    assert sorted(pack_names(client, "sprite")) == ["Seraphina", "Seraphina 2"]
    assert has_line(result["report"], "立绘包「Seraphina 2」", "改叫")


def test_files_over_the_size_limit_are_skipped_with_a_line_in_the_report(client, monkeypatch):
    from app.importer import apply as apply_module

    big = noise_png()
    monkeypatch.setattr(apply_module, "MAX_IMAGE_BYTES", len(big) - 1)
    monkeypatch.setattr(apply_module, "MAX_AUDIO_BYTES", 60)
    files = {
        "Seraphina.png": card_png("Seraphina"),
        "expressions/joy.png": big,
        "expressions/neutral.png": img("neutral"),
        "bgm/日常.mp3": mp3("daily"),
        "bgm/很长的歌.mp3": mp3("long") + bytes(100),
    }
    _, result = do_import(client, files)
    pack = pack_named(client, "sprite", "Seraphina")
    assert [r["label"] for r in sprites(client, pack["id"])] == ["neutral"]
    assert has_line(result["report"], "joy.png", "太大")
    assert has_line(result["report"], "很长的歌.mp3", "太大")
    scene = pack_named(client, "scene", "Seraphina · BGM")
    assert [a["label"] for a in get(client, f"/api/scene-packs/{scene['id']}/assets")] == ["日常"]


def test_images_that_will_not_open_are_named_in_the_plan_and_the_report(client):
    """Chub 的表情 zip 里起名 joy.png 的 HTML 错误页:计划和导入报告都说图打不开,不说「无关文件」"""
    files = {
        "Seraphina.png": card_png("Seraphina"),
        "expressions.zip": zipped({"joy.png": b"<!DOCTYPE html><html>502</html>", "neutral.png": img("neutral")}),
    }
    p, result = do_import(client, files)
    line = "1 张图打不开,没导入(文件名是图片,内容不是;可能下载时坏了):joy.png"
    assert has_line(p["skipped"], line)
    assert has_line(result["report"], line)
    assert not has_line(result["report"], "无关文件")


def test_reimporting_a_converted_song_is_recognised_as_a_duplicate(client):
    pytest.importorskip("av")
    files = {"BGM/晚安.wav": real_wav()}
    _, first = do_import(client, files)
    pack = pack_named(client, "scene", "BGM")
    p = plan(client, files)
    assert group(p, "scene_pack")["duplicate_of"] == {"id": pack["id"], "name": "BGM", "card_count": 0}
    assert first["notice"]["title"] == "BGM 导入完成 · 还没绑定到角色卡"


# ── 出错 ──


def test_plan_rejects_bad_requests(client, make_card):
    files = {"a/joy.png": img("joy")}
    assert plan(client, files, kind="voice", status=400)["detail"]
    assert plan(client, files, kind="ai", status=400)["detail"]
    assert plan(client, files, kind="whatever", status=400)["detail"]
    assert plan(client, files, target="0" * 32, status=404)["detail"] == "角色卡不存在"
    parts = [("files", ("joy.png", img("joy"), "image/png"))]
    r = client.post(f"{API}/plan", files=parts, data={"paths": json.dumps(["a", "b"])})
    assert r.status_code == 400
    r = client.post(f"{API}/plan", files=parts, data={"paths": json.dumps(["../joy.png"])})
    assert r.status_code == 400
    # 只给文件不给路径:用文件名
    r = client.post(f"{API}/plan", files=parts)
    assert r.status_code == 200 and r.json()["unknown"] == [] and group(r.json(), "sprite_pack")["count"] == 1


def test_plan_with_a_forced_kind(client, make_card):
    card = make_card(name="刻晴")["id"]
    p = plan(client, {"随便/IMG_1.png": img("1"), "随便/IMG_2.png": img("2")}, target=card, kind="bg")
    assert [(g["type"], g["owner"]) for g in p["groups"]] == [("scene_pack", "target")]
    apply(client, p["plan_id"])
    assert scene_parts_of(client, card)["bg"] == [pack_named(client, "scene", "刻晴 · 背景")["id"]]


def test_apply_and_job_errors(client):
    assert client.post(f"{API}/{'0' * 32}/apply", json={}).status_code == 404
    assert client.post(f"{API}/not-a-plan/apply", json={}).status_code == 404
    p = plan(client, seraphina_files())
    assert client.post(f"{API}/{p['plan_id']}/apply", json={"decisions": {"card:1": "maybe"}}).status_code == 400
    assert client.post(f"{API}/{p['plan_id']}/apply", json={"decisions": {"card:9": "new"}}).status_code == 400
    assert client.get(f"{API}/jobs/{'0' * 32}/undo-preview").status_code == 404
    assert client.post(f"{API}/jobs/{'0' * 32}/undo").status_code == 404
    assert client.post(f"{API}/jobs/{'0' * 32}/classify", json={"path": "a", "kind": "bg"}).status_code == 404


def test_the_target_card_must_still_exist_when_applying(client, make_card):
    card = make_card(name="刻晴")["id"]
    p = plan(client, {"背景/a.jpg": jpg("a")}, target=card)
    client.delete(f"/api/tavern/cards/{card}")
    assert client.post(f"{API}/{p['plan_id']}/apply", json={}).status_code == 404


# ── 暂存清理 ──


def test_staging_older_than_a_week_is_purged_at_startup(monkeypatch):
    from app import main as main_module
    from app.migrations.runner import MigrationReport

    root = Path(settings.import_staging_dir)
    old, new = root / ("a" * 32), root / ("b" * 32)
    for d in (old, new):
        (d / "files").mkdir(parents=True)
    week_ago = time.time() - 8 * 24 * 3600
    os.utime(old, (week_ago, week_ago))

    # 只跑启动流程里的清理:迁移器报「失败」时后面的建表、写默认数据都不做,不碰任何库
    monkeypatch.setattr(main_module.migrations_startup, "run", lambda version: MigrationReport(mode="off", status="failed"))
    from fastapi.testclient import TestClient

    with TestClient(main_module.app):
        pass
    assert not old.exists() and new.exists()

    def broken(*args, **kwargs):
        raise OSError("盘坏了")

    monkeypatch.setattr(staging, "purge", broken)
    main_module._purge_import_staging()  # 出错也不挡启动


def test_cancelling_a_plan_discards_its_staged_files(client):
    """确认框点「取消」:暂存的文件马上删掉(一整个角色文件夹几百 MB,别等 7 天);执行过的不能这样删"""
    p = plan(client, seraphina_files())
    staged = Path(settings.import_staging_dir) / p["plan_id"]
    assert staged.is_dir()
    r = client.delete(f"{API}/{p['plan_id']}")
    assert r.status_code == 204, r.text
    assert not staged.exists()
    apply(client, p["plan_id"], status=404)
    assert client.delete(f"{API}/{p['plan_id']}").status_code == 404
    assert client.delete(f"{API}/not-a-plan").status_code == 404

    p2, done = do_import(client, seraphina_files())
    assert client.delete(f"{API}/{p2['plan_id']}").status_code == 409
    assert done["job_id"] == p2["plan_id"]
