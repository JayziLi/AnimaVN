"""CG 包(app/api/cg_packs.py)和它与场景包两边都写的转接层(app/cg_sync.py)。"""

from fastapi.testclient import TestClient

from app.storage.blobs import sha_of

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
CG = "/api/cg-packs"


def _assets(client: TestClient, pack_id: str) -> list[dict]:
    return client.get(f"{CG}/{pack_id}/assets").json()


def test_cg_pack_crud_and_card_binding(client: TestClient, make_card):
    pack = client.post(CG, json={"name": " 星庇所 · CG "}).json()
    assert (pack["name"], pack["cg_count"], pack["card_count"], pack["source_scene_pack_id"]) == ("星庇所 · CG", 0, 0, None)
    assert client.post(CG, json={"name": "星庇所 · cg"}).status_code == 409

    base = f"{CG}/{pack['id']}/assets"
    a = client.post(base, json={"label": "膝枕", "aliases": ["枕"]}).json()
    b = client.post(base, json={"label": "拥抱"}).json()
    assert (a["kind"], a["source"], a["sort"], b["sort"]) == ("cg", "cg", 0, 1)
    assert client.post(base, json={"label": "枕"}).status_code == 409
    v = client.post(base, json={"label": "微笑", "parent_id": a["id"]}).json()
    assert client.post(base, json={"label": "微笑", "parent_id": b["id"]}).status_code == 200  # 每张构图都能有一张「微笑」
    assert client.post(base, json={"label": "x", "parent_id": v["id"]}).status_code == 400  # 差分下面不能再挂

    up = client.put(f"{base}/{a['id']}/file", files={"file": ("a.png", PNG, "image/png")}).json()
    assert (up["has_file"], up["data_sha"]) == (True, sha_of(PNG))
    assert client.get(f"{base}/{a['id']}/file").content == PNG
    assert client.get(f"/api/blobs/{sha_of(PNG)}").content == PNG

    order = client.post(f"{base}/reorder", json={"ids": [b["id"], a["id"]]}).json()
    assert [r["id"] for r in order] == [b["id"], a["id"]]
    assert client.put(f"{base}/{a['id']}", json={"forms": ["夜晚"], "focus_x": 30}).json()["forms"] == ["夜晚"]

    card = make_card()
    other = client.post(CG, json={"name": "通用"}).json()
    got = client.put(f"/api/tavern/cards/{card['id']}/cg-packs", json={"pack_ids": [other["id"], pack["id"]]}).json()
    assert got == {"card_id": card["id"], "pack_ids": [other["id"], pack["id"]]}
    assert client.get(f"/api/tavern/cards/{card['id']}/roster").json()["cg_packs"] == [other["id"], pack["id"]]
    assert next(p for p in client.get(CG).json() if p["id"] == pack["id"])["card_count"] == 1

    assert client.delete(f"{base}/{a['id']}").status_code == 204  # 构图连差分一起删
    assert [r["label"] for r in _assets(client, pack["id"])] == ["拥抱", "微笑"]
    assert client.delete(f"{CG}/{pack['id']}").status_code == 204
    assert client.get(f"/api/tavern/cards/{card['id']}/cg-packs").json()["pack_ids"] == [other["id"]]


def test_cg_added_through_the_scene_api_splits_the_scene_pack(client: TestClient, make_card):
    """旧接口(还有仓库外的导入脚本)往场景包里加 CG:先照迁移的做法拆出 CG 包、绑给用这个场景包的卡,两边一直一样"""
    card = make_card()
    scene = client.post("/api/scene-packs", json={"name": "雪山草庵"}).json()
    client.put(f"/api/tavern/cards/{card['id']}/scene-pack", json={"pack_id": scene["id"]})
    sbase = f"/api/scene-packs/{scene['id']}/assets"
    bg = client.post(sbase, json={"kind": "bg", "label": "庵"}).json()
    assert client.get(CG).json() == []  # 只加背景不拆

    comp = client.post(sbase, json={"kind": "cg", "label": "温泉"}).json()
    (pack,) = client.get(CG).json()
    assert (pack["name"], pack["source_scene_pack_id"], pack["card_count"]) == ("雪山草庵 · CG", scene["id"], 1)
    assert client.get("/api/scene-packs").json()[0]["cg_pack_id"] == pack["id"]
    assert client.get(f"/api/tavern/cards/{card['id']}/cg-packs").json()["pack_ids"] == [pack["id"]]
    assert [r["id"] for r in _assets(client, pack["id"])] == [comp["id"]]

    # 场景包这边改 → CG 包跟着变
    client.put(f"{sbase}/{comp['id']}", json={"aliases": ["泡澡"]})
    client.put(f"{sbase}/{comp['id']}/file", files={"file": ("a.png", PNG, "image/png")})
    (row,) = _assets(client, pack["id"])
    assert (row["aliases"], row["data_sha"]) == (["泡澡"], sha_of(PNG))
    assert client.get(f"{CG}/{pack['id']}/assets/{comp['id']}/file").content == PNG

    # CG 包这边改 → 场景包跟着变(原件存进场景包那一行,换回旧代码也读得到)
    var = client.post(f"{CG}/{pack['id']}/assets", json={"label": "微笑", "parent_id": comp["id"]}).json()
    png2 = PNG + b"2"
    client.put(f"{CG}/{pack['id']}/assets/{var['id']}/file", files={"file": ("b.png", png2, "image/png")})
    scene_rows = {r["id"]: r for r in client.get(sbase).json()}
    assert scene_rows[var["id"]]["parent_id"] == comp["id"] and scene_rows[var["id"]]["data_sha"] == sha_of(png2)
    assert client.get(f"{sbase}/{var['id']}/file").content == png2

    # 场景包这边删构图 → 差分、CG 包里的同一批都删
    assert client.delete(f"{sbase}/{comp['id']}").status_code == 204
    assert _assets(client, pack["id"]) == []
    assert [r["id"] for r in client.get(sbase).json()] == [bg["id"]]

    # 删场景包:CG 包留着(它单独绑在卡上),只是不再同步
    assert client.delete(f"/api/scene-packs/{scene['id']}").status_code == 204
    assert client.get(CG).json()[0]["source_scene_pack_id"] is None
