"""新上传的原件只进文件仓库(素材架构第 3 段 B2):开关 storage_files 开着时库里的原件列留空。

瘦身以后库里的原件列全是空的;新上传要是还往里写,库又会一点点变大。开关关着时照旧库里也存一份。
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.main import app
from app.models import Blob
from app.storage.blobs import sha_of, store

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(range(64))


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    session.close()


def _cell(db: Session, sql: str, **params):
    db.expire_all()
    return db.execute(text(sql), params).one()


def _sprite(client: TestClient, make_sprite_pack) -> tuple[str, str]:
    pack = make_sprite_pack()
    base = f"/api/sprite-packs/{pack['id']}/sprites"
    sprite = client.post(base, json={"label": "平静"}).json()
    return base, sprite["id"]


def _upload_sprite(client: TestClient, base: str, sid: str, data: bytes) -> dict:
    r = client.put(f"{base}/{sid}/image", files={"file": ("a.png", data, "image/png")})
    assert r.status_code == 200
    return r.json()


def test_sprite_upload_with_files_on_leaves_the_column_empty(client: TestClient, make_sprite_pack, db: Session):
    base, sid = _sprite(client, make_sprite_pack)
    out = _upload_sprite(client, base, sid, PNG)
    assert out["image_sha"] == sha_of(PNG)
    image, sha = _cell(db, "SELECT image, image_sha FROM pack_sprites WHERE id = :id", id=sid)
    assert (image, sha) == (None, sha_of(PNG))
    assert store().read(sha_of(PNG), "image/png") == PNG
    assert db.get(Blob, sha_of(PNG)).size == len(PNG)
    got = client.get(f"{base}/{sid}/image")
    assert (got.status_code, got.content) == (200, PNG)


def test_sprite_upload_with_files_off_still_writes_the_database(
    client: TestClient, make_sprite_pack, db: Session, monkeypatch
):
    monkeypatch.setattr(settings, "storage_files", False)
    base, sid = _sprite(client, make_sprite_pack)
    _upload_sprite(client, base, sid, PNG)
    assert _cell(db, "SELECT image, image_sha FROM pack_sprites WHERE id = :id", id=sid) == (PNG, sha_of(PNG))
    assert client.get(f"{base}/{sid}/image").content == PNG


def test_replacing_an_image_clears_the_old_original_in_the_database(
    client: TestClient, make_sprite_pack, db: Session, monkeypatch
):
    """老的那一行库里还存着原件(瘦身前写的):换图以后不能留着旧图,不然指纹和原件对不上"""
    monkeypatch.setattr(settings, "storage_files", False)
    base, sid = _sprite(client, make_sprite_pack)
    _upload_sprite(client, base, sid, PNG)
    monkeypatch.setattr(settings, "storage_files", True)
    new = PNG + b"new"
    _upload_sprite(client, base, sid, new)
    assert _cell(db, "SELECT image, image_sha FROM pack_sprites WHERE id = :id", id=sid) == (None, sha_of(new))
    assert client.get(f"{base}/{sid}/image").content == new


def test_scene_asset_upload_with_files_on_leaves_the_column_empty(client: TestClient, db: Session):
    pack = client.post("/api/scene-packs", json={"name": "场景"}).json()
    base = f"/api/scene-packs/{pack['id']}/assets"
    bgm = client.post(base, json={"kind": "bgm", "label": "曲子"}).json()
    up = client.put(f"{base}/{bgm['id']}/file", files={"file": ("a.mp3", MP3, "audio/mpeg")}).json()
    assert up["data_sha"] == sha_of(MP3)
    assert _cell(db, "SELECT data, data_sha FROM scene_assets WHERE id = :id", id=bgm["id"]) == (None, sha_of(MP3))
    assert client.get(f"{base}/{bgm['id']}/file").content == MP3


def _split_cg(client: TestClient, make_card) -> tuple[str, str, str]:
    """场景包里加一张 CG → 拆出 CG 包;返回(场景素材地址前缀、CG 包素材地址前缀、构图 id)"""
    card = make_card()
    scene = client.post("/api/scene-packs", json={"name": "雪山草庵"}).json()
    client.put(f"/api/tavern/cards/{card['id']}/scene-pack", json={"pack_id": scene["id"]})
    sbase = f"/api/scene-packs/{scene['id']}/assets"
    comp = client.post(sbase, json={"kind": "cg", "label": "温泉"}).json()
    (pack,) = client.get("/api/cg-packs").json()
    return sbase, f"/api/cg-packs/{pack['id']}/assets", comp["id"]


def test_cg_upload_with_files_on_leaves_both_rows_empty(client: TestClient, make_card, db: Session):
    """拆出来的 CG 包:两边的行都只记指纹(以前场景包那一行还要存一份原件给旧代码读)"""
    sbase, cbase, cid = _split_cg(client, make_card)
    assert client.put(f"{cbase}/{cid}/file", files={"file": ("a.png", PNG, "image/png")}).status_code == 200
    assert _cell(db, "SELECT data, data_sha FROM cg_assets WHERE id = :id", id=cid) == (None, sha_of(PNG))
    assert _cell(db, "SELECT data, data_sha FROM scene_assets WHERE id = :id", id=cid) == (None, sha_of(PNG))
    assert client.get(f"{cbase}/{cid}/file").content == PNG
    assert client.get(f"{sbase}/{cid}/file").content == PNG

    # 从场景包那边换图也一样
    png2 = PNG + b"2"
    assert client.put(f"{sbase}/{cid}/file", files={"file": ("b.png", png2, "image/png")}).status_code == 200
    assert _cell(db, "SELECT data, data_sha FROM scene_assets WHERE id = :id", id=cid) == (None, sha_of(png2))
    assert _cell(db, "SELECT data, data_sha FROM cg_assets WHERE id = :id", id=cid) == (None, sha_of(png2))
    assert client.get(f"{cbase}/{cid}/file").content == png2


def test_cg_upload_with_files_off_keeps_the_original_in_the_scene_row(
    client: TestClient, make_card, db: Session, monkeypatch
):
    monkeypatch.setattr(settings, "storage_files", False)
    sbase, cbase, cid = _split_cg(client, make_card)
    client.put(f"{cbase}/{cid}/file", files={"file": ("a.png", PNG, "image/png")})
    assert _cell(db, "SELECT data, data_sha FROM cg_assets WHERE id = :id", id=cid) == (None, sha_of(PNG))
    assert _cell(db, "SELECT data, data_sha FROM scene_assets WHERE id = :id", id=cid) == (PNG, sha_of(PNG))
    assert client.get(f"{cbase}/{cid}/file").content == PNG
