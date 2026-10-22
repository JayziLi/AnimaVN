"""角色包导出(第 3 步 A1):从一张卡收齐要带的行和文件(app/bundle/collect.py),写成 zip(write.py),三个接口。

库是 tests/bundle_seed.py 那份:主卡 + 状态卡、立绘包(两张,一张有认词记录)、场景包(背景 1 的默认曲在同包,
背景 2 的默认曲在别的场景包)、CG 包(构图 + 差分)、配对表、预设绑定、按卡设置、声音和 secret.*(都不该带)。
"""

import json
import zipfile
from collections.abc import Iterator
from io import BytesIO
from urllib.parse import unquote

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.bundle import collect, write
from app.db import Base, get_db
from app.main import app
from app.models import WordRecord
from tests.bundle_seed import SECRET, png, seed


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture(autouse=True)
def export_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(write, "TMP_DIR", tmp_path / "export-tmp")
    return tmp_path / "export-tmp"


def _zip(bundle, tmp_path) -> zipfile.ZipFile:
    path = tmp_path / "out.zip"
    write.write_zip(bundle, path)
    return zipfile.ZipFile(path)


def _json(zf: zipfile.ZipFile, name: str):
    return json.loads(zf.read(name).decode("utf-8"))


def test_bundle_has_the_whole_state_group_and_everything_bound(db, tmp_path):
    ids = seed(db)
    # 从状态卡出发也是整组,主卡是组里的主卡
    zf = _zip(collect.collect_card(db, ids["state"], exclude=[], with_preset=True, note="一起看花火"), tmp_path)
    m = _json(zf, "animavn.json")
    assert m["format"] == "animavn" and m["version"] == 1 and len(m["bundle"]) == 32
    assert m["title"] == "刻晴" and m["note"] == "一起看花火"
    assert m["main_card"] == ids["main"]
    assert [c["key"] for c in m["cards"]] == [ids["main"], ids["state"]]
    for c in m["cards"]:
        card = _json(zf, c["file"])
        assert card["spec"] == "chara_card_v3" and card["spec_version"] == "3.0"
        assert card["data"]["name"] == "刻晴"
        assert card["data"]["character_book"]["entries"][0]["content"] == "她用剑"
        assert card["data"]["extensions"]["talkativeness"] == "0.5"
        assert card["data"]["extensions"]["animavn"] == {"bundle": m["bundle"], "card": c["key"]}
        assert "avatar" not in card["data"]
        assert zf.read(c["avatar"]) == png("avatar")
    assert m["preview"] == m["cards"][0]["avatar"]

    group = m["state_group"]
    assert group["row"]["main_card_id"] == ids["main"]
    assert [(s["card"], s["name"], s["sort"], s["show_in_pick"]) for s in group["states"]] == [
        (ids["main"], "普通", 0, False),
        (ids["state"], "夜晚", 1, True),
    ]
    assert {r["card"] for r in m["roles"]} == {ids["main"], ids["state"]}
    assert all(r["is_main"] and r["name"] == "刻晴" for r in m["roles"])

    assert [(p["key"], p["kind"]) for p in m["packs"]] == [
        (ids["sprite_pack"], "sprite"),
        (ids["scene_pack"], "scene"),
        (ids["cg_pack"], "cg"),
    ]
    main_bindings = sorted((b["kind"], b["pack"], b["is_primary"], b["parts"]) for b in m["bindings"] if b["card"] == ids["main"])
    assert main_bindings == [
        ("cg", ids["cg_pack"], False, ""),
        ("scene", ids["scene_pack"], False, ""),
        ("sprite", ids["sprite_pack"], True, ""),
    ]
    role_of_main = next(r["key"] for r in m["roles"] if r["card"] == ids["main"])
    assert next(b for b in m["bindings"] if b["card"] == ids["main"] and b["kind"] == "sprite")["role"] == role_of_main
    # 声音不带
    assert all(b["kind"] != "voice" for b in m["bindings"])


def test_packs_carry_rows_files_and_internal_references(db, tmp_path):
    ids = seed(db)
    zf = _zip(collect.collect_card(db, ids["main"], exclude=[], with_preset=True), tmp_path)
    m = _json(zf, "animavn.json")
    files = {p["kind"]: _json(zf, p["file"]) for p in m["packs"]}

    sprite = files["sprite"]
    assert sprite["format"] == "animapack" and sprite["kind"] == "sprite" and sprite["key"] == ids["sprite_pack"]
    assert sprite["pack"] == {"name": "刻晴 · 玉衡星", "description": "官方立绘"}
    s1, s2 = sprite["items"]
    assert s1["key"] == ids["s1"] and s1["label"] == "微笑" and s1["aliases"] == ["smile"]
    assert s1["effect"]["motion"] == "hop" and s1["face_scan"] == {"face": [1, 2, 3, 4]}
    assert s2["enabled"] is False
    assert zf.read(s1["file"]) == png("微笑")
    assert "image_sha" not in s1 and "id" not in s1 and "pack_id" not in s1
    assert sprite["layouts"] == [{"auto": False, "zoom": 1.2, "dx": 0.1, "dy": -0.05}]
    assert "word_records" not in sprite  # .animavn 里放清单

    scene = files["scene"]
    assert scene["pack"]["title_bgm_id"] == ids["bgm"]
    by_label = {i["label"]: i for i in scene["items"]}
    assert by_label["港口"]["bgm_id"] == ids["bgm"]
    assert by_label["港口"]["focus_x"] == 30
    assert by_label["远山"]["bgm_id"] is None  # 跨包的曲子不在这次导出里
    assert "远方" not in by_label

    cg = files["cg"]
    assert cg["pack"] == {"name": "刻晴 · CG", "description": "", "generated": False}
    comp, var = cg["items"]
    assert comp["parent_id"] is None and comp["forms"] == ["普通"]
    assert var["parent_id"] == ids["comp"]

    # 同一个文件只放一份:s2 和卡头像是同一张图
    assert s2["file"] == m["cards"][0]["avatar"]
    names = [n for n in zf.namelist() if n.startswith("assets/")]
    assert len(names) == len(set(names))
    assert len(names) == 7  # 头像/生气、微笑、港口、远山、日常、花火、花火微笑
    assert zf.getinfo(s1["file"]).compress_type == zipfile.ZIP_STORED
    assert zf.getinfo("animavn.json").compress_type == zipfile.ZIP_DEFLATED


def test_follows_word_records_pairings_prefs_and_preset(db, tmp_path):
    ids = seed(db)
    zf = _zip(collect.collect_card(db, ids["main"], exclude=[], with_preset=True), tmp_path)
    m = _json(zf, "animavn.json")
    assert [(w["list"], w["word"], w["item"], w["source"], w["guessed"], w["score"]) for w in m["word_records"]] == [
        (f"pack:{ids['sprite_pack']}", "开心", ids["s1"], "model", True, 0.8)
    ]
    assert len(m["pairings"]) == 1  # 语音的配对表第 4 步再带
    p = m["pairings"][0]
    assert (p["follower"], p["list"], p["target"], p["card"]) == ("cg", f"pack:{ids['sprite_pack']}", ids["comp"], None)
    assert sorted((r["item"], r["value"], r["source"]) for r in p["rows"]) == sorted(
        [(ids["s1"], ids["var"], "name"), (ids["s2"], None, "local")]
    )
    prefs = {(c["card"], c["key"]): c["value"] for c in m["card_prefs"]}
    assert set(prefs) == {(ids["main"], "plugin.imagegen"), (ids["state"], "plugin.cg")}  # 只带 plugin.*
    assert prefs[(ids["main"], "plugin.imagegen")]["ref"]["id"] == ids["s1"]

    assert m["preset"]["name"] == "刻晴 DeepSeek"
    assert sorted(m["preset"]["cards"]) == sorted([ids["main"], ids["state"]])
    preset = _json(zf, m["preset"]["file"])
    assert preset["name"] == "刻晴 DeepSeek" and preset["squash_system_messages"] is True
    assert preset["prompt_order"][0]["character_id"] == 100000

    everything = b"".join(zf.read(n) for n in zf.namelist())
    assert SECRET.encode() not in everything
    assert "G:/models".encode() not in everything and "台式机".encode() not in everything
    assert ids["voice"].encode() not in everything


def test_exclude_and_no_preset(db, tmp_path):
    ids = seed(db)
    bundle = collect.collect_card(db, ids["main"], exclude=[f"sprite:{ids['sprite_pack']}"], with_preset=False)
    zf = _zip(bundle, tmp_path)
    m = _json(zf, "animavn.json")
    assert [p["kind"] for p in m["packs"]] == ["scene", "cg"]
    assert all(b["kind"] != "sprite" for b in m["bindings"])
    assert m["word_records"] == [] and m["pairings"] == []
    # 生图参考的立绘没导出:去掉 ref,别的留着
    pref = next(c for c in m["card_prefs"] if c["key"] == "plugin.imagegen")
    assert "ref" not in pref["value"] and pref["value"]["look"] == "purple hair"
    assert m["preset"] is None
    assert not any(n.startswith("presets/") for n in zf.namelist())


def test_builtin_word_records_go_with_a_card_without_sprites(db, tmp_path):
    ids = seed(db)
    db.add(WordRecord(list_ref="builtin", word="笑嘻嘻", item="开心", source="model"))
    db.commit()
    m = _json(_zip(collect.collect_card(db, ids["lonely"], exclude=[], with_preset=True), tmp_path), "animavn.json")
    assert m["state_group"] is None and m["packs"] == [] and m["preview"] is None
    assert [(w["list"], w["word"], w["item"]) for w in m["word_records"]] == [("builtin", "笑嘻嘻", "开心")]
    assert m["preset"]["name"] == "别的预设"
    # 有立绘的卡不带内置名单的记录
    m2 = _json(_zip(collect.collect_card(db, ids["main"], exclude=[], with_preset=True), tmp_path), "animavn.json")
    assert all(w["list"] != "builtin" for w in m2["word_records"])


def test_single_pack_file_carries_its_word_records(db, tmp_path):
    ids = seed(db)
    zf = _zip(collect.collect_pack(db, "sprite", ids["sprite_pack"]), tmp_path)
    p = _json(zf, "pack.json")
    assert p["kind"] == "sprite" and len(p["items"]) == 2
    assert [(w["list"], w["word"], w["item"]) for w in p["word_records"]] == [
        (f"pack:{ids['sprite_pack']}", "开心", ids["s1"])
    ]
    scene = _json(_zip(collect.collect_pack(db, "scene", ids["scene_pack"]), tmp_path), "pack.json")
    assert {i["label"]: i["bgm_id"] for i in scene["items"] if i["kind"] == "bg"} == {"港口": ids["bgm"], "远山": None}
    assert "word_records" not in scene


# ── 接口 ──


@pytest.fixture
def api(client):
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    ids = seed(session)
    yield client, ids, session
    gen.close()


def test_summary(api):
    client, ids, _ = api
    r = client.get(f"/api/export/bundle/{ids['state']}/summary")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["title"] == "刻晴" and s["file_name"] == "刻晴.animavn"
    assert s["avatar"].startswith("data:image/png;base64,")
    assert s["cards"] == [
        {"id": ids["main"], "name": "刻晴", "state": "普通", "main": True},
        {"id": ids["state"], "name": "刻晴", "state": "夜晚", "main": False},
    ]
    assert s["card_bytes"] > 0
    items = {i["key"]: i for i in s["items"]}
    assert list(items) == [f"sprite:{ids['sprite_pack']}", f"scene:{ids['scene_pack']}", f"cg:{ids['cg_pack']}"]
    sp = items[f"sprite:{ids['sprite_pack']}"]
    assert sp["kind"] == "sprite" and sp["name"] == "刻晴 · 玉衡星" and sp["detail"] == "2 张" and sp["current"] is True
    assert sp["bytes"] == len(png("微笑")) + len(png("avatar"))
    assert sp["thumb"].startswith("/api/blobs/")
    assert items[f"scene:{ids['scene_pack']}"]["detail"] == "2 张背景、1 首 BGM"
    assert items[f"cg:{ids['cg_pack']}"]["detail"] == "1 张 CG、1 张差分"
    assert "认词记录 1 条" in s["follows"] and "配对表 1 张" in s["follows"] and "立绘位置和特效" in s["follows"]
    assert s["preset"]["id"] == ids["preset"] and s["preset"]["name"] == "刻晴 DeepSeek" and s["preset"]["bytes"] > 0
    assert s["previews"][0] == {"kind": "avatar"}
    assert {"kind": "sprite", "id": ids["s1"], "thumb": s["previews"][1]["thumb"]} == s["previews"][1]
    assert s["not_included"] == ["声音(第 4 步再加)", "人设", "对话记录", "你的 API key 和设置"]
    assert client.get("/api/export/bundle/nope/summary").status_code == 404


def test_download_bundle(api, export_tmp):
    client, ids, _ = api
    r = client.post(
        f"/api/export/bundle/{ids['main']}",
        json={"exclude": [f"cg:{ids['cg_pack']}"], "preset": False, "note": "说明", "preview": {"kind": "sprite", "id": ids["s1"]}},
    )
    assert r.status_code == 200, r.text
    cd = r.headers["content-disposition"]
    assert "filename*=UTF-8''" in cd and unquote(cd.split("filename*=UTF-8''")[1]) == "刻晴.animavn"
    zf = zipfile.ZipFile(BytesIO(r.content))
    m = json.loads(zf.read("animavn.json"))
    assert m["note"] == "说明" and m["preset"] is None
    assert [p["kind"] for p in m["packs"]] == ["sprite", "scene"]
    assert zf.read(m["preview"]) == png("微笑")
    # 发完临时文件删掉
    assert not export_tmp.exists() or not any(export_tmp.iterdir())


def test_download_pack(api):
    client, ids, _ = api
    r = client.get(f"/api/export/pack/cg/{ids['cg_pack']}")
    assert r.status_code == 200, r.text
    assert unquote(r.headers["content-disposition"].split("filename*=UTF-8''")[1]) == "刻晴 · CG.animapack"
    p = json.loads(zipfile.ZipFile(BytesIO(r.content)).read("pack.json"))
    assert p["kind"] == "cg" and len(p["items"]) == 2
    assert client.get(f"/api/export/pack/voice/{ids['voice']}").status_code == 404
    assert client.get("/api/export/pack/sprite/nope").status_code == 404
