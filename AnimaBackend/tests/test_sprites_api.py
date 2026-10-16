from fastapi.testclient import TestClient

# 最小的合法 PNG 文件头就够了:后端只认文件头判断格式,不解码图片
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

PACKS = "/api/sprite-packs"


def _sprites(pack_id: str) -> str:
    return f"{PACKS}/{pack_id}/sprites"


def _bound(card_id: str) -> str:
    return f"/api/tavern/cards/{card_id}/sprite-packs"


def _card_sprites(card_id: str) -> str:
    return f"/api/tavern/cards/{card_id}/sprites"


# ── 立绘包 ──


def test_sprite_pack_crud_counts_sprites_and_cards(client: TestClient, make_card, make_sprite_pack):
    card = make_card()
    other = make_card(name="别的卡")
    pack = make_sprite_pack("夜莺", card["id"])
    make_sprite_pack("花的私语")
    client.put(_bound(other["id"]), json={"pack_ids": [pack["id"]]})
    client.post(_sprites(pack["id"]), json={"label": "平静"})

    listed = {p["name"]: p for p in client.get(PACKS).json()}
    assert (listed["夜莺"]["sprite_count"], listed["夜莺"]["card_count"]) == (1, 2)
    assert (listed["花的私语"]["sprite_count"], listed["花的私语"]["card_count"]) == (0, 0)

    renamed = client.put(f"{PACKS}/{pack['id']}", json={"name": " 舞台装 ", "description": "演唱会"})
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["description"]) == ("舞台装", "演唱会")


def test_sprite_pack_names_are_unique_and_not_blank(client: TestClient, make_sprite_pack):
    pack = make_sprite_pack("夜莺")
    make_sprite_pack("Stage")

    assert client.post(PACKS, json={"name": "  "}).status_code == 400
    assert client.post(PACKS, json={"name": "夜莺"}).status_code == 409
    assert client.post(PACKS, json={"name": "stage"}).status_code == 409
    assert client.put(f"{PACKS}/{pack['id']}", json={"name": "STAGE"}).status_code == 409
    # 改成自己原来的名字不算撞
    assert client.put(f"{PACKS}/{pack['id']}", json={"name": "夜莺"}).status_code == 200
    assert client.put(f"{PACKS}/nope", json={"name": "x"}).status_code == 404


# ── 包里的立绘 ──


def test_sprite_crud_keeps_mapping_ordered_and_list_light(client: TestClient, make_sprite_pack):
    base = _sprites(make_sprite_pack()["id"])

    a = client.post(base, json={"label": "平静", "description": "默认"}).json()
    b = client.post(base, json={"label": "微笑", "aliases": ["笑", "  ", "微笑"]}).json()

    assert (a["sort"], b["sort"]) == (0, 1)
    # 空白和与主名重复的别名被丢掉
    assert b["aliases"] == ["笑"]
    assert b["has_image"] is False

    updated = client.put(f"{base}/{b['id']}", json={"description": "开心时用"})
    assert updated.status_code == 200
    assert updated.json()["label"] == "微笑"
    assert updated.json()["aliases"] == ["笑"]

    listed = client.get(base).json()
    assert [s["label"] for s in listed] == ["平静", "微笑"]

    assert client.delete(f"{base}/{a['id']}").status_code == 204
    assert [s["label"] for s in client.get(base).json()] == ["微笑"]
    assert client.get(_sprites("nope")).status_code == 404


def test_sprite_names_are_unique_within_a_pack_only(client: TestClient, make_sprite_pack):
    base = _sprites(make_sprite_pack("夜莺")["id"])
    client.post(base, json={"label": "微笑", "aliases": ["笑"]})

    assert client.post(base, json={"label": "笑"}).status_code == 409
    # 大小写不敏感
    client.post(base, json={"label": "Happy"})
    assert client.post(base, json={"label": "平静", "aliases": ["happy"]}).status_code == 409

    # 别的包可以用同一套表情名 —— 换包时就是按名字对上的
    other = _sprites(make_sprite_pack("花的私语")["id"])
    assert client.post(other, json={"label": "微笑", "aliases": ["笑"]}).status_code == 200


def test_sprite_names_reject_template_breaking_characters(client: TestClient, make_sprite_pack):
    base = _sprites(make_sprite_pack()["id"])

    assert client.post(base, json={"label": "  "}).status_code == 400
    assert client.post(base, json={"label": "开<心"}).status_code == 400
    assert client.post(base, json={"label": "开心】"}).status_code == 400


def test_image_upload_sniffs_format_and_serves_cacheable_bytes(client: TestClient, make_sprite_pack):
    base = _sprites(make_sprite_pack()["id"])
    sprite = client.post(base, json={"label": "平静"}).json()

    # 声明成 png 的 HTML 会被拒:格式看文件头,不看客户端声明
    bad = client.put(
        f"{base}/{sprite['id']}/image",
        files={"file": ("x.png", b"<html><script>alert(1)</script>", "image/png")},
    )
    assert bad.status_code == 400

    ok = client.put(
        f"{base}/{sprite['id']}/image", files={"file": ("a.bin", PNG, "text/plain")}
    )
    assert ok.status_code == 200
    assert ok.json()["has_image"] is True

    img = client.get(f"{base}/{sprite['id']}/image")
    assert img.status_code == 200
    assert img.content == PNG
    assert img.headers["content-type"] == "image/png"
    assert img.headers["x-content-type-options"] == "nosniff"
    assert "immutable" in img.headers["cache-control"]

    # 列表里只有 has_image,不带图本身
    assert "AAAA" not in client.get(base).text


def test_image_endpoint_404s_without_image_or_for_other_packs(client: TestClient, make_sprite_pack):
    pack = make_sprite_pack("夜莺")
    other = make_sprite_pack("花的私语")
    sprite = client.post(_sprites(pack["id"]), json={"label": "平静"}).json()

    assert client.get(f"{_sprites(pack['id'])}/{sprite['id']}/image").status_code == 404
    client.put(
        f"{_sprites(pack['id'])}/{sprite['id']}/image", files={"file": ("a.png", PNG, "image/png")}
    )
    # 换一个包的路径去取同一个 id,不能取到
    assert client.get(f"{_sprites(other['id'])}/{sprite['id']}/image").status_code == 404
    assert client.put(f"{_sprites(other['id'])}/{sprite['id']}", json={}).status_code == 404


def test_reorder_requires_exact_id_set(client: TestClient, make_sprite_pack):
    base = _sprites(make_sprite_pack()["id"])
    a = client.post(base, json={"label": "a"}).json()
    b = client.post(base, json={"label": "b"}).json()

    assert client.post(f"{base}/reorder", json={"ids": [b["id"]]}).status_code == 400

    reordered = client.post(f"{base}/reorder", json={"ids": [b["id"], a["id"]]})
    assert reordered.status_code == 200
    assert [s["label"] for s in client.get(base).json()] == ["b", "a"]


def test_disabling_a_sprite_keeps_the_row_and_its_names(client: TestClient, make_sprite_pack):
    base = _sprites(make_sprite_pack()["id"])
    sprite = client.post(base, json={"label": "平静", "aliases": ["normal"]}).json()
    assert sprite["enabled"] is True

    off = client.put(f"{base}/{sprite['id']}", json={"enabled": False})
    assert off.status_code == 200
    assert (off.json()["enabled"], off.json()["label"]) == (False, "平静")

    # 禁用不是删除:还在列表里,名字照样占着,改别的字段也不会把它打开
    client.put(f"{base}/{sprite['id']}", json={"description": "默认"})
    assert [(s["label"], s["enabled"]) for s in client.get(base).json()] == [("平静", False)]
    assert client.post(base, json={"label": "Normal"}).status_code == 409

    assert client.put(f"{base}/{sprite['id']}", json={"enabled": True}).json()["enabled"] is True


def test_sprite_effect_round_trips_without_changing_the_image_version(
    client: TestClient, make_sprite_pack
):
    base = _sprites(make_sprite_pack()["id"])
    sprite = client.post(base, json={"label": "惊讶"}).json()
    assert sprite["effect"] is None
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    uploaded = client.put(f"{base}/{sprite['id']}/image", files={"file": ("a.png", png, "image/png")}).json()

    fx = {"motion": "hop", "bubble": "exclaim", "sound": "emo-exclaim"}
    put = client.put(f"{base}/{sprite['id']}", json={"effect": fx})
    assert put.status_code == 200
    assert put.json()["effect"] == fx
    # 只改特效:图没变,版本号不能变,不然浏览器要重新下载整张图
    assert put.json()["image_version"] == uploaded["image_version"]
    assert client.get(base).json()[0]["effect"] == fx

    # 改别的字段不会把特效冲掉
    assert client.put(f"{base}/{sprite['id']}", json={"description": "吃惊"}).json()["effect"] == fx

    # 只要气泡;三样都空 = 没设;显式 null 也是去掉
    half = client.put(f"{base}/{sprite['id']}", json={"effect": {"bubble": "heart"}}).json()["effect"]
    assert half == {"motion": None, "bubble": "heart", "sound": None}
    empty = {"motion": None, "bubble": None, "sound": None}
    assert client.put(f"{base}/{sprite['id']}", json={"effect": empty}).json()["effect"] is None
    client.put(f"{base}/{sprite['id']}", json={"effect": fx})
    assert client.put(f"{base}/{sprite['id']}", json={"effect": None}).json()["effect"] is None

    assert client.put(f"{base}/{sprite['id']}", json={"effect": {"motion": "x" * 41}}).status_code == 422


def test_settings_round_trip_and_key_validation(client: TestClient):
    # 没存过:200 + null,由前端用默认值
    empty = client.get("/api/settings/plugin.sprite")
    assert empty.status_code == 200
    assert empty.json() == {"key": "plugin.sprite", "value": None}

    value = {"tagTemplate": "<sprite:{表情}>", "nested": [1, 2]}
    put = client.put("/api/settings/plugin.sprite", json={"value": value})
    assert put.status_code == 200
    assert client.get("/api/settings/plugin.sprite").json() == {
        "key": "plugin.sprite",
        "value": value,
    }

    client.put("/api/settings/plugin.sprite", json={"value": {"tagTemplate": "【{表情}】"}})
    assert client.get("/api/settings/plugin.sprite").json()["value"] == {"tagTemplate": "【{表情}】"}

    assert client.get("/api/settings/Bad Key").status_code == 400


def test_upload_records_the_face_and_scan_fills_sprites_that_missed_it(
    client: TestClient, make_sprite_pack, monkeypatch
):
    from app.api import sprites as sprites_api
    from tests.test_sprite_faces import SYLVIE

    base = _sprites(make_sprite_pack()["id"])
    image = SYLVIE.read_bytes()

    first = client.post(base, json={"label": "平静"}).json()
    assert first["face_scan"] is None
    uploaded = client.put(f"{base}/{first['id']}/image", files={"file": ("a.png", image, "image/png")})
    scan = uploaded.json()["face_scan"]
    assert (scan["width"], scan["height"]) == (334, 700)
    assert scan["face"] is not None

    # 服务器上没装 OpenCV 时上传照样成功,只是先不记;装上之后由 scan-faces 补上。
    # 用 context 只还原 scan:undo() 会把 conftest 换掉的文件仓库目录也一起还原
    with monkeypatch.context() as m:
        m.setattr(sprites_api, "scan", lambda data: None)
        second = client.post(base, json={"label": "微笑"}).json()
        missed = client.put(f"{base}/{second['id']}/image", files={"file": ("b.png", image, "image/png")})
        assert missed.status_code == 200
        assert missed.json()["face_scan"] is None

    scanned = client.post(f"{base}/scan-faces")
    assert scanned.status_code == 200
    by_label = {s["label"]: s for s in scanned.json()}
    assert by_label["微笑"]["face_scan"] == scan
    # 补识别不算改图:图的版本号不变,浏览器不用重新下载
    assert by_label["微笑"]["image_version"] == missed.json()["image_version"]


def test_scan_faces_reports_when_opencv_is_missing(client: TestClient, make_sprite_pack, monkeypatch):
    from app.api import sprites as sprites_api

    monkeypatch.setattr(sprites_api, "scan", lambda data: None)
    base = _sprites(make_sprite_pack()["id"])
    sprite = client.post(base, json={"label": "平静"}).json()
    client.put(f"{base}/{sprite['id']}/image", files={"file": ("a.png", PNG, "image/png")})

    res = client.post(f"{base}/scan-faces")
    assert res.status_code == 503
    assert "OpenCV" in res.json()["detail"]


def test_sprite_layout_defaults_saves_and_follows_the_pack(
    client: TestClient, make_card, make_sprite_pack
):
    card = make_card()
    pack = make_sprite_pack("夜莺", card["id"])
    base = _sprites(pack["id"])
    default = {"auto": True, "zoom": 1.0, "dx": 0.0, "dy": 0.0}
    assert client.get(f"{base}/layout").json() == default

    saved = client.put(f"{base}/layout", json={"auto": False, "zoom": 1.25, "dx": -0.1})
    assert saved.status_code == 200
    assert saved.json() == {"auto": False, "zoom": 1.25, "dx": -0.1, "dy": 0.0}
    # 只传一项时其他的不动
    client.put(f"{base}/layout", json={"dy": 0.05})
    assert client.get(f"{base}/layout").json() == {"auto": False, "zoom": 1.25, "dx": -0.1, "dy": 0.05}

    assert client.put(f"{base}/layout", json={"zoom": 9}).status_code == 422
    assert client.put(f"{base}/layout", json={"dx": 5}).status_code == 422
    assert client.get(f"{_sprites('nope')}/layout").status_code == 404

    # 别的包有自己的摆法
    other = make_sprite_pack("花的私语", card["id"])
    assert client.get(f"{_sprites(other['id'])}/layout").json() == default


def test_image_endpoint_serves_a_shrunk_copy_on_request(client: TestClient, make_sprite_pack):
    from tests.test_sprite_faces import SYLVIE

    base = _sprites(make_sprite_pack()["id"])
    sprite = client.post(base, json={"label": "平静"}).json()
    client.put(f"{base}/{sprite['id']}/image", files={"file": ("a.png", SYLVIE.read_bytes(), "image/png")})

    # ?w= 给取色、缩略图用:缩到这个宽度的 WebP,地址不同,缓存也分开
    small = client.get(f"{base}/{sprite['id']}/image?w=96")
    assert small.status_code == 200
    assert small.headers["content-type"] == "image/webp"
    assert "immutable" in small.headers["cache-control"]
    assert len(small.content) < len(SYLVIE.read_bytes())
    # 原图没那么宽(手机上显示立绘请求 ?w=1024):不放大,只换成更小的 WebP
    same = client.get(f"{base}/{sprite['id']}/image?w=1000")
    assert same.headers["content-type"] == "image/webp"
    assert len(small.content) < len(same.content) < len(SYLVIE.read_bytes())
    assert client.get(f"{base}/{sprite['id']}/image?w=4").status_code == 422


# ── 卡挂哪些包 ──


def test_card_packs_keep_order_and_the_first_one_becomes_current(
    client: TestClient, make_card, make_sprite_pack
):
    card = make_card()
    assert client.get(_bound(card["id"])).json() == {"card_id": card["id"], "pack_ids": [], "current": None}
    assert client.get(_card_sprites(card["id"])).json() == []

    stage = make_sprite_pack("夜莺", card["id"])
    casual = make_sprite_pack("花的私语", card["id"])
    client.post(_sprites(stage["id"]), json={"label": "微笑"})
    client.post(_sprites(casual["id"]), json={"label": "害羞"})

    assert client.get(_bound(card["id"])).json() == {
        "card_id": card["id"],
        "pack_ids": [stage["id"], casual["id"]],
        "current": stage["id"],
    }
    # 按卡读立绘 = 读当前包的
    assert [s["label"] for s in client.get(_card_sprites(card["id"])).json()] == ["微笑"]

    switched = client.put(f"{_bound(card['id'])}/current", json={"pack_id": casual["id"]})
    assert switched.status_code == 200
    assert switched.json()["current"] == casual["id"]
    listed = client.get(_card_sprites(card["id"])).json()
    assert [(s["label"], s["pack_id"]) for s in listed] == [("害羞", casual["id"])]

    # 调个顺序,当前包不变
    reordered = client.put(_bound(card["id"]), json={"pack_ids": [casual["id"], stage["id"]]})
    assert reordered.json() == {
        "card_id": card["id"],
        "pack_ids": [casual["id"], stage["id"]],
        "current": casual["id"],
    }
    # 整组替换时也能直接指定当前包
    picked = client.put(
        _bound(card["id"]), json={"pack_ids": [casual["id"], stage["id"]], "current": stage["id"]}
    )
    assert picked.json()["current"] == stage["id"]


def test_card_pack_binding_rejects_unknown_cards_packs_and_unattached_current(
    client: TestClient, make_card, make_sprite_pack
):
    card = make_card()
    pack = make_sprite_pack("夜莺", card["id"])
    loose = make_sprite_pack("花的私语")

    assert client.get(_bound("nope")).status_code == 404
    assert client.get(_card_sprites("nope")).status_code == 404
    assert client.put(_bound(card["id"]), json={"pack_ids": ["nope"]}).status_code == 404
    assert (
        client.put(_bound(card["id"]), json={"pack_ids": [pack["id"]], "current": loose["id"]}).status_code
        == 400
    )
    assert client.put(f"{_bound(card['id'])}/current", json={"pack_id": loose["id"]}).status_code == 400
    # 重复的 id 只算一次
    assert client.put(_bound(card["id"]), json={"pack_ids": [pack["id"], pack["id"]]}).json()["pack_ids"] == [
        pack["id"]
    ]


def test_detaching_the_current_pack_moves_on_to_the_next_one(
    client: TestClient, make_card, make_sprite_pack
):
    card = make_card()
    a = make_sprite_pack("a", card["id"])
    b = make_sprite_pack("b", card["id"])
    c = make_sprite_pack("c", card["id"])
    client.put(f"{_bound(card['id'])}/current", json={"pack_id": b["id"]})

    after = client.put(_bound(card["id"]), json={"pack_ids": [a["id"], c["id"]]}).json()
    assert after["current"] == c["id"]
    # 最后一个被拿掉时绕回第一个
    after = client.put(_bound(card["id"]), json={"pack_ids": [a["id"]]}).json()
    assert after["current"] == a["id"]
    after = client.put(_bound(card["id"]), json={"pack_ids": []}).json()
    assert after == {"card_id": card["id"], "pack_ids": [], "current": None}
    # 包本身还在
    assert len(client.get(PACKS).json()) == 3


def test_deleting_a_pack_removes_its_sprites_and_moves_cards_to_their_next_pack(
    client: TestClient, make_card, make_sprite_pack
):
    kanami = make_card(name="香奈美")
    lonely = make_card(name="只有一个包")
    stage = make_sprite_pack("夜莺", kanami["id"])
    casual = make_sprite_pack("花的私语", kanami["id"])
    client.put(_bound(lonely["id"]), json={"pack_ids": [stage["id"]]})
    sprite = client.post(_sprites(stage["id"]), json={"label": "微笑"}).json()
    client.put(f"{_sprites(stage['id'])}/{sprite['id']}/image", files={"file": ("a.png", PNG, "image/png")})
    client.put(f"{_sprites(stage['id'])}/layout", json={"zoom": 1.5})

    assert client.delete(f"{PACKS}/{stage['id']}").status_code == 204

    assert client.get(_bound(kanami["id"])).json()["pack_ids"] == [casual["id"]]
    assert client.get(_bound(kanami["id"])).json()["current"] == casual["id"]
    assert client.get(_bound(lonely["id"])).json() == {
        "card_id": lonely["id"],
        "pack_ids": [],
        "current": None,
    }
    assert client.get(_card_sprites(lonely["id"])).json() == []
    assert client.get(_sprites(stage["id"])).status_code == 404
    assert client.get(f"{_sprites(stage['id'])}/{sprite['id']}/image").status_code == 404
    assert client.delete(f"{PACKS}/{stage['id']}").status_code == 404


def test_duplicating_a_card_shares_its_packs_and_deleting_a_card_keeps_them(
    client: TestClient, make_card, make_sprite_pack
):
    card = make_card()
    stage = make_sprite_pack("夜莺", card["id"])
    casual = make_sprite_pack("花的私语", card["id"])
    client.put(f"{_bound(card['id'])}/current", json={"pack_id": casual["id"]})
    client.post(_sprites(casual["id"]), json={"label": "害羞"})

    copy = client.post(f"/api/tavern/cards/{card['id']}/duplicate", json={}).json()
    assert client.get(_bound(copy["id"])).json() == {
        "card_id": copy["id"],
        "pack_ids": [stage["id"], casual["id"]],
        "current": casual["id"],
    }
    # 指向同一个包,不是复制了一份
    assert len(client.get(PACKS).json()) == 2
    assert client.get(_card_sprites(copy["id"])).json() == client.get(_card_sprites(card["id"])).json()

    assert client.delete(f"/api/tavern/cards/{card['id']}").status_code == 204
    counts = {p["name"]: p["card_count"] for p in client.get(PACKS).json()}
    assert counts == {"夜莺": 1, "花的私语": 1}
    assert [s["label"] for s in client.get(_card_sprites(copy["id"])).json()] == ["害羞"]


def test_card_face_crops_the_current_packs_default_sprite_and_revalidates(
    client: TestClient, make_card, make_sprite_pack, monkeypatch
):
    from app.api import sprites as sprites_api
    from tests.test_sprite_faces import SYLVIE

    card = make_card()
    face = f"{_card_sprites(card['id'])}/face"
    # 没挂包、包里还没有带图的立绘:404,前端退回卡面头像
    assert client.get(face).status_code == 404
    assert client.get(f"{_card_sprites('nope')}/face").status_code == 404

    stage = make_sprite_pack("夜莺", card["id"])
    casual = make_sprite_pack("花的私语", card["id"])
    assert client.get(face).status_code == 404

    base = _sprites(stage["id"])
    first = client.post(base, json={"label": "平静"}).json()
    second = client.post(base, json={"label": "微笑"}).json()
    other = client.post(_sprites(casual["id"]), json={"label": "平静"}).json()
    for pack_id, s in ((stage["id"], first), (stage["id"], second), (casual["id"], other)):
        client.put(
            f"{_sprites(pack_id)}/{s['id']}/image",
            files={"file": ("a.png", SYLVIE.read_bytes(), "image/png")},
        )

    res = client.get(f"{face}?size=64")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/webp"
    assert res.headers["cache-control"] == "private, no-cache"
    etag = res.headers["etag"]
    assert first["id"] in etag

    # 没变就回 304,不重新裁
    again = client.get(f"{face}?size=64", headers={"If-None-Match": etag})
    assert again.status_code == 304
    # 默认表情关掉了:换成下一张,ETag 跟着变
    client.put(f"{base}/{first['id']}", json={"enabled": False})
    switched = client.get(f"{face}?size=64", headers={"If-None-Match": etag})
    assert switched.status_code == 200
    assert second["id"] in switched.headers["etag"]
    # 换了当前包:头像跟着换
    client.put(f"{_bound(card['id'])}/current", json={"pack_id": casual["id"]})
    assert other["id"] in client.get(f"{face}?size=64").headers["etag"]

    assert client.get(f"{face}?size=8").status_code == 422
    assert client.get(f"{face}?size=4096").status_code == 422

    monkeypatch.setattr(sprites_api, "face_thumbnail", lambda data, face, size: None)
    missing = client.get(f"{face}?size=65")
    assert missing.status_code == 503
