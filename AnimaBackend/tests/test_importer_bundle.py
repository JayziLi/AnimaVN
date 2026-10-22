"""角色包 / 单包接进导入流程(第 3 步 A3):拖进来 → 计划里是一个 bundle / pack_file 组 → 执行 → 撤销后库回到导入前。

库是 tests/bundle_seed.py 那份,文件用 A1 的导出接口现做。
"""

import json
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import func, select

from app.bundle import canon, write
from app.db import Base, get_db
from app.main import app
from app.models import AppSetting, ImportJob, PromptPreset, SpritePack
from tests.bundle_seed import png, seed
from tests.test_importer_api import card_png

API = "/api/import"


@pytest.fixture(autouse=True)
def export_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(write, "TMP_DIR", tmp_path / "export-tmp")


@pytest.fixture
def lib(client):
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    ids = seed(session)
    yield client, ids, session
    gen.close()


def _counts(db) -> dict:
    db.expire_all()
    return {
        t.name: db.scalar(select(func.count()).select_from(t))
        for t in Base.metadata.sorted_tables
        if t.name not in ("import_jobs", "blobs")
    }


def _export(client, card_id: str, **body) -> bytes:
    r = client.post(f"/api/export/bundle/{card_id}", json=body)
    assert r.status_code == 200, r.text
    return r.content


def _plan(client, files: list[tuple[str, bytes]], **form) -> dict:
    r = client.post(f"{API}/plan", files=[("files", (name, data)) for name, data in files], data=form)
    assert r.status_code == 200, r.text
    return r.json()


def test_bundle_round_trip_through_import_and_undo(lib):
    client, ids, db = lib
    data = _export(client, ids["main"], note="一起看花火", preset=True)
    before = _counts(db)
    canon_before = canon.canonical(db, ids["main"])

    plan = _plan(client, [("刻晴.animavn", data)])
    assert plan["needs_confirm"] is True
    assert plan["unknown"] == []
    assert [g["type"] for g in plan["groups"]] == ["bundle"]
    g = plan["groups"][0]
    assert g["name"] == "刻晴" and g["count"] == 2
    d = g["detail"]
    assert d["note"] == "一起看花火" and d["has_voice"] is True and d["bytes"] > 0
    assert d["cards"] == [
        {"name": "刻晴", "new_name": "刻晴 2", "state": "普通"},
        {"name": "刻晴", "new_name": "刻晴 2", "state": "夜晚"},
    ]
    assert [(p["kind"], p["name"], p["detail"]) for p in d["packs"]] == [
        ("sprite", "刻晴 · 玉衡星", "2 张"),
        ("scene", "璃月", "2 张背景、1 首 BGM"),
        ("cg", "刻晴 · CG", "1 张 CG、1 张差分"),
    ]
    assert d["packs"][0]["thumbs"] and all(t.startswith(f"{API}/{plan['plan_id']}/file?path=") for t in d["packs"][0]["thumbs"])
    assert "认词记录 1 条" in d["follows"] and "配对表 2 张" in d["follows"]
    assert d["preset"] == {"name": "刻晴 DeepSeek"}
    # 预览图能从暂存目录取
    r = client.get(d["preview"])
    assert r.status_code == 200 and r.content == png("avatar")

    r = client.post(f"{API}/{plan['plan_id']}/apply", json={"options": {g["key"]: {"preset": True}}})
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["created"]["cards"]) == 2 and len(out["created"]["sprite_packs"]) == 1
    assert len(out["created"]["presets"]) == 1 and len(out["created"]["state_groups"]) == 1
    assert out["card_id"] == out["created"]["cards"][0]
    assert "已自动绑定配套的立绘、背景、BGM、CG" in out["notice"]["title"]
    assert any(line.startswith("新建角色卡「刻晴 2」") for line in out["report"])
    db.expire_all()
    assert canon.canonical(db, out["card_id"]) == canon_before
    assert _counts(db) != before

    preview = client.get(f"{API}/jobs/{out['job_id']}/undo-preview").json()
    assert any("预设「刻晴 DeepSeek 2」" in line for line in preview["lines"])
    r = client.post(f"{API}/jobs/{out['job_id']}/undo")
    assert r.status_code == 200, r.text
    assert _counts(db) == before
    cards = db.get(AppSetting, "preset.bindings").value["cards"]
    assert set(cards) == {ids["main"], ids["state"], ids["lonely"]}


def test_without_the_preset(lib):
    client, ids, db = lib
    plan = _plan(client, [("刻晴.animavn", _export(client, ids["main"]))])
    key = plan["groups"][0]["key"]
    out = client.post(f"{API}/{plan['plan_id']}/apply", json={"options": {key: {"preset": False}}}).json()
    assert "presets" not in out["created"]
    assert db.scalar(select(func.count()).select_from(PromptPreset)) == 2


def test_dropped_on_a_card_still_makes_new_ones_and_binds_nothing_to_it(lib):
    client, ids, db = lib
    data = _export(client, ids["main"])
    before = {b: len(client.get(f"/api/tavern/cards/{ids['lonely']}/roster").json()["roles"][0]["sprite_packs"]) for b in [0]}
    plan = _plan(client, [("刻晴.animavn", data)], target_card_id=ids["lonely"])
    out = client.post(f"{API}/{plan['plan_id']}/apply", json={}).json()
    assert out["card_id"] not in (ids["lonely"], ids["main"])
    roster = client.get(f"/api/tavern/cards/{ids['lonely']}/roster").json()
    assert len(roster["roles"][0]["sprite_packs"]) == before[0] and roster["scene_packs"] == [] and roster["cg_packs"] == []
    assert db.get(ImportJob, plan["plan_id"]).bound == []


def test_single_pack_file(lib):
    client, ids, db = lib
    r = client.get(f"/api/export/pack/sprite/{ids['sprite_pack']}")
    before = _counts(db)
    plan = _plan(client, [("刻晴 · 玉衡星.animapack", r.content)], target_card_id=ids["lonely"])
    assert [g["type"] for g in plan["groups"]] == ["pack_file"]
    g = plan["groups"][0]
    assert g["name"] == "刻晴 · 玉衡星" and g["count"] == 2
    assert g["detail"]["kind"] == "sprite" and g["detail"]["detail"] == "2 张" and g["detail"]["thumbs"]
    out = client.post(f"{API}/{plan['plan_id']}/apply", json={}).json()
    assert out["created"]["cards"] == [] and len(out["created"]["sprite_packs"]) == 1
    new = out["created"]["sprite_packs"][0]
    db.expire_all()
    assert db.get(SpritePack, new).name == "刻晴 · 玉衡星 2"
    assert canon.pack_canonical(db, "sprite", new) == canon.pack_canonical(db, "sprite", ids["sprite_pack"])
    # 拖到卡上也不挂上去
    assert client.get(f"/api/tavern/cards/{ids['lonely']}/roster").json()["roles"][0]["sprite_packs"] == []
    client.post(f"{API}/jobs/{out['job_id']}/undo")
    assert _counts(db) == before


def test_bundle_next_to_loose_files_still_classifies_the_rest(lib):
    client, ids, _ = lib
    plan = _plan(client, [("刻晴.animavn", _export(client, ids["main"])), ("芙宁娜.png", card_png("芙宁娜"))])
    assert sorted(g["type"] for g in plan["groups"]) == ["bundle", "card"]


def test_a_broken_bundle_is_reported_and_not_imported(lib, tmp_path):
    import io
    import zipfile

    client, ids, _ = lib
    src = zipfile.ZipFile(io.BytesIO(_export(client, ids["main"])))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name in src.namelist():
            if name.startswith("assets/"):
                continue  # 文件全丢了
            zf.writestr(name, src.read(name))
    plan = _plan(client, [("坏的.animavn", buf.getvalue())])
    assert plan["groups"] == [] and plan["unknown"] == []
    assert any("不是能导入的角色包" in s and "缺文件" in s for s in plan["skipped"])


def test_staged_files_only(lib):
    client, ids, _ = lib
    plan = _plan(client, [("刻晴.animavn", _export(client, ids["main"]))])
    pid = plan["plan_id"]
    assert client.get(f"{API}/{pid}/file", params={"path": "../plan.json"}).status_code == 404
    assert client.get(f"{API}/{pid}/file", params={"path": "刻晴/nope.png"}).status_code == 404
    assert client.get(f"{API}/{'0' * 32}/file", params={"path": "x.png"}).status_code == 404
    thumb = plan["groups"][0]["detail"]["packs"][0]["thumbs"][0]
    path = parse_qs(urlparse(thumb).query)["path"][0]
    assert client.get(f"{API}/{pid}/file", params={"path": path, "w": 32}).status_code == 200
    # 认得出的卡 JSON 也只是暂存文件,照样能取(只许暂存目录里的)
    assert client.get(f"{API}/{pid}/file", params={"path": "刻晴/animavn.json"}).status_code == 200


def test_bundle_groups_only_take_new(lib):
    client, ids, _ = lib
    plan = _plan(client, [("刻晴.animavn", _export(client, ids["main"]))])
    key = plan["groups"][0]["key"]
    r = client.post(f"{API}/{plan['plan_id']}/apply", json={"decisions": {key: "share"}})
    assert r.status_code == 400
    assert "只能选 new" in json.loads(r.text)["detail"]
