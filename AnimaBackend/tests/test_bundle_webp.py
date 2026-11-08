"""导出时压缩图片(app/bundle/webp.py + collect 的 compress_images)"""

from __future__ import annotations

import json
import zipfile
from collections.abc import Iterator
from io import BytesIO

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.bundle import collect, webp, write
from app.db import Base, get_db
from app.main import app
from app.models import PackSprite
from app.storage import refs
from app.storage.blobs import store
from tests.bundle_seed import png, seed


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


def big_png(alpha: bool = False, w: int = 640, h: int = 480) -> bytes:
    """渐变 + 噪点的大图:PNG 很大,WebP 小得多"""
    rng = np.random.default_rng(1)
    y, x = np.mgrid[0:h, 0:w]
    arr = np.stack([x * 255 // w, y * 255 // h, (x + y) % 256, np.full((h, w), 255)], axis=-1).astype(np.uint8)
    arr[..., :3] = np.clip(arr[..., :3].astype(int) + rng.integers(-6, 7, (h, w, 3)), 0, 255).astype(np.uint8)
    if alpha:
        arr[: h // 2, : w // 2, 3] = 0
    buf = BytesIO()
    Image.fromarray(arr, "RGBA" if alpha else "RGBA").convert("RGBA" if alpha else "RGB").save(buf, "PNG")
    return buf.getvalue()


def _put_sprite(db, ids, data: bytes, mime: str = "image/png") -> PackSprite:
    row = db.get(PackSprite, ids["s1"])
    refs.save(refs.SPRITE, row, data, mime, db)
    row.mime = mime
    db.commit()
    return row


_n = iter(range(1000))


def _zip(bundle, tmp_path) -> zipfile.ZipFile:
    path = tmp_path / f"out{next(_n)}.zip"
    write.write_zip(bundle, path)
    return zipfile.ZipFile(path)


def _sprite_item(zf, ids, key="s1"):
    m = json.loads(zf.read("animavn.json"))
    pack = next(p for p in m["packs"] if p["kind"] == "sprite")
    data = json.loads(zf.read(pack["file"]))
    return m, next(i for i in data["items"] if i["key"] == ids[key])


def test_transparent_png_becomes_webp_and_keeps_alpha(db, tmp_path):
    ids = seed(db)
    src = big_png(alpha=True)
    _put_sprite(db, ids, src)
    zf = _zip(collect.collect_card(db, ids["main"], compress_images=True), tmp_path)
    m, item = _sprite_item(zf, ids)
    assert item["file"].endswith(".webp") and item["mime"] == "image/webp"
    data = zf.read(item["file"])
    assert len(data) < len(src) and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    im = Image.open(BytesIO(data))
    assert im.mode == "RGBA" and im.getpixel((10, 10))[3] == 0 and im.getpixel((600, 400))[3] == 255
    # 指纹写新文件的
    import hashlib

    assert item["file"] == f"assets/{hashlib.sha256(data).hexdigest()}.webp"
    # 原图的 PNG 不再放进包里
    assert not any(n.endswith(".png") and n != m["preview"] and zf.read(n) == src for n in zf.namelist())


def test_refs_follow_the_new_file(db, tmp_path):
    ids = seed(db)
    _put_sprite(db, ids, big_png())
    zf = _zip(collect.collect_card(db, ids["main"], compress_images=True, preview={"kind": "sprite", "id": ids["s1"]}), tmp_path)
    m, item = _sprite_item(zf, ids)
    assert m["preview"] == item["file"] and item["file"].endswith(".webp")
    assert set(zf.namelist()) >= {item["file"]}


def test_avatar_gif_and_images_that_get_bigger_are_left_alone(db, tmp_path, monkeypatch):
    ids = seed(db)
    # 转完反而变大:用原图
    with monkeypatch.context() as mp:
        mp.setattr(webp, "convert", lambda data: data + bytes(100))
        zf = _zip(collect.collect_card(db, ids["main"], compress_images=True), tmp_path)
    m, item = _sprite_item(zf, ids, "s2")
    assert item["file"].endswith(".png") and zf.read(item["file"]) == png("avatar")
    # 卡头像不动
    avatar = next(e["avatar"] for e in m["cards"] if e["key"] == ids["main"])
    assert avatar.endswith(".png") and zf.read(avatar) == png("avatar")
    # GIF 不动
    buf = BytesIO()
    Image.new("RGB", (400, 300), (10, 200, 30)).save(buf, "GIF")
    gif = buf.getvalue()
    _put_sprite(db, ids, gif, "image/gif")
    zf = _zip(collect.collect_card(db, ids["main"], compress_images=True), tmp_path)
    _, item = _sprite_item(zf, ids)
    assert item["file"].endswith(".gif") and zf.read(item["file"]) == gif


def test_off_is_identical_to_before(db, tmp_path):
    ids = seed(db)
    _put_sprite(db, ids, big_png())
    a = collect.collect_card(db, ids["main"])
    b = collect.collect_card(db, ids["main"], compress_images=False)
    assert list(a.files) == list(b.files)
    assert {k: v for k, v in a.manifest.items() if k not in ("bundle", "exported_at")} == {
        k: v for k, v in b.manifest.items() if k not in ("bundle", "exported_at")
    }
    assert not (store().root / ".webp-cache").exists()


def test_second_export_uses_the_cache(db, tmp_path, monkeypatch):
    ids = seed(db)
    _put_sprite(db, ids, big_png())
    calls = []
    real = webp.convert
    monkeypatch.setattr(webp, "convert", lambda data: calls.append(1) or real(data))
    collect.collect_card(db, ids["main"], compress_images=True)
    first = len(calls)
    assert first >= 1
    assert any((store().root / ".webp-cache").glob("*.webp"))
    collect.collect_card(db, ids["main"], compress_images=True)
    assert len(calls) == first


def test_round_trip_import_gets_the_sprite_back(db, tmp_path, monkeypatch):
    from app.bundle import read, restore

    monkeypatch.setattr(restore._Restorer, "same_voice", lambda self, engine, pack: None)
    ids = seed(db)
    src = big_png(alpha=True)
    _put_sprite(db, ids, src)
    path = tmp_path / "c.animavn"
    write.write_zip(collect.collect_card(db, ids["main"], compress_images=True), path)
    folder = tmp_path / "unz"
    with zipfile.ZipFile(path) as zf:
        zf.extractall(folder)
    restore.restore_bundle(db, folder, read.read_manifest(folder), with_preset=True)
    db.commit()
    webps = [s for s in db.query(PackSprite).all() if s.mime == "image/webp"]
    assert webps
    pixels = []
    for sprite in webps:
        got = refs.read_bytes(refs.SPRITE, sprite, db)
        assert got is not None and got[8:12] == b"WEBP"
        im = Image.open(BytesIO(got))
        if im.size == (640, 480):
            pixels.append(im.convert("RGBA").getpixel((10, 10))[3])
    assert pixels == [0]


def test_api_flag_and_pack_query(client):
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    ids = seed(session)
    _put_sprite(session, ids, big_png())
    try:
        raw = client.post(f"/api/export/bundle/{ids['main']}", json={"compress_images": False})
        on = client.post(f"/api/export/bundle/{ids['main']}", json={})
        assert raw.status_code == 200 and on.status_code == 200
        assert len(on.content) < len(raw.content)
        p0 = client.get(f"/api/export/pack/sprite/{ids['sprite_pack']}")
        p1 = client.get(f"/api/export/pack/sprite/{ids['sprite_pack']}?compress=1")
        assert len(p1.content) < len(p0.content)
        names = zipfile.ZipFile(BytesIO(p1.content)).namelist()
        assert any(n.endswith(".webp") for n in names)
    finally:
        gen.close()
