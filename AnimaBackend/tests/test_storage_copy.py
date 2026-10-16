"""库里的原件复制进文件仓库(app/storage/copy.py),以及出图 / 出文件接口先读文件、读不到退回读库。"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.db import Base
from app.models import Blob, MaintenanceJob, PackSprite, SceneAsset, ScenePack, SpritePack
from app.storage import refs
from app.storage.blobs import BlobStore, sha_of, store
from app.storage.copy import JOB_ID, copy_all

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 64


@pytest.fixture
def old_rows(tmp_path: Path):
    """一个文件库:两张立绘(其中一张和背景同一张图)、一首曲子、一张没图的立绘,都还没指纹"""
    engine = create_engine(f"sqlite:///{(tmp_path / 'db.sqlite').as_posix()}")
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    other = PNG + b"\x01"
    with factory() as db:
        db.add(SpritePack(id="p", name="包"))
        db.add(ScenePack(id="s", name="场景"))
        db.add_all(
            [
                PackSprite(id="a", pack_id="p", label="平静", image=PNG, mime="image/png"),
                PackSprite(id="b", pack_id="p", label="开心", image=other, mime="image/png"),
                PackSprite(id="c", pack_id="p", label="没图"),
                SceneAsset(id="bg", pack_id="s", kind="bg", label="教室", data=PNG, mime="image/png"),
                SceneAsset(id="m", pack_id="s", kind="bgm", label="曲子", data=MP3, mime="audio/mpeg"),
            ]
        )
        db.commit()
    stamps = {r.id: r.updated_at for r in factory().scalars(select(PackSprite)).all()}
    yield factory, BlobStore(tmp_path / "blobs"), stamps
    engine.dispose()


def _shas(factory):
    with factory() as db:
        sprites = dict(db.execute(select(PackSprite.id, PackSprite.image_sha)).all())
        assets = dict(db.execute(select(SceneAsset.id, SceneAsset.data_sha)).all())
    return {**sprites, **assets}


def test_copy_puts_every_original_in_the_store_once(old_rows):
    factory, blobs, stamps = old_rows
    result = copy_all(factory, blobs, batch=2)
    assert (result.total, result.seen, result.copied, result.rewritten, result.lost) == (4, 4, 4, 0, 0)
    shas = _shas(factory)
    assert shas["a"] == shas["bg"] == sha_of(PNG)
    assert shas["c"] is None
    assert blobs.read(shas["m"], "audio/mpeg") == MP3
    assert blobs.read(shas["b"], "image/png") == PNG + b"\x01"
    with factory() as db:
        assert sorted(db.scalars(select(Blob.mime)).all()) == ["audio/mpeg", "image/png", "image/png"]
        # 图没变:图片地址里的版本号(updated_at)不能变
        assert {r.id: r.updated_at for r in db.scalars(select(PackSprite)).all()} == stamps
        job = db.get(MaintenanceJob, JOB_ID)
        assert (job.state, job.done, job.total) == ("done", 4, 4)
        # 库里的原件一个字节不动
        assert db.scalar(select(SceneAsset.data).where(SceneAsset.id == "m")) == MP3


def test_running_again_does_nothing_and_missing_files_come_back(old_rows):
    factory, blobs, _ = old_rows
    copy_all(factory, blobs)
    again = copy_all(factory, blobs)
    assert (again.copied, again.rewritten, again.fixed) == (0, 0, 0)

    shas = _shas(factory)
    blobs.path(shas["m"], "audio/mpeg").unlink()
    back = copy_all(factory, blobs)
    assert (back.copied, back.rewritten) == (0, 1)
    assert blobs.read(shas["m"], "audio/mpeg") == MP3


def test_a_sha_that_does_not_match_the_original_is_redone(old_rows):
    factory, blobs, _ = old_rows
    copy_all(factory, blobs)
    with factory() as db:
        db.get(PackSprite, "b").image_sha = "0" * 64
        db.commit()
    result = copy_all(factory, blobs)
    assert result.fixed == 1
    assert _shas(factory)["b"] == sha_of(PNG + b"\x01")


def test_a_missing_blob_row_is_filled_in(old_rows):
    factory, blobs, _ = old_rows
    copy_all(factory, blobs)
    with factory() as db:
        db.query(Blob).delete()
        db.commit()
    copy_all(factory, blobs)
    with factory() as db:
        assert db.scalar(select(Blob.mime).where(Blob.sha == sha_of(MP3))) == "audio/mpeg"


# ── 接口:先读文件,读不到退回读库 ──


def _upload_sprite(client: TestClient, make_sprite_pack):
    """开关关着上传:库里和仓库里各一份(开着时库里不存,见 test_storage_save.py),才看得出读的是哪份"""
    pack = make_sprite_pack()
    base = f"/api/sprite-packs/{pack['id']}/sprites"
    sprite = client.post(base, json={"label": "平静"}).json()
    assert client.put(f"{base}/{sprite['id']}/image", files={"file": ("a.png", PNG, "image/png")}).status_code == 200
    return f"{base}/{sprite['id']}/image"


def test_sprite_upload_writes_the_file_and_reads_prefer_it(client: TestClient, make_sprite_pack, monkeypatch):
    monkeypatch.setattr(settings, "storage_files", False)
    url = _upload_sprite(client, make_sprite_pack)
    monkeypatch.setattr(settings, "storage_files", True)
    path = store().path(sha_of(PNG), "image/png")
    assert path.read_bytes() == PNG
    assert client.get(url).content == PNG

    path.write_bytes(PNG + b"file")  # 文件和库里的不一样时,看得出读的是哪份
    assert client.get(url).content == PNG + b"file"
    monkeypatch.setattr(settings, "storage_files", False)
    assert client.get(url).content == PNG


def test_a_missing_file_falls_back_to_the_database(client: TestClient, make_sprite_pack, monkeypatch):
    monkeypatch.setattr(settings, "storage_files", False)
    url = _upload_sprite(client, make_sprite_pack)
    monkeypatch.setattr(settings, "storage_files", True)
    store().path(sha_of(PNG), "image/png").unlink()
    got = client.get(url)
    assert (got.status_code, got.content) == (200, PNG)


def test_scene_files_go_through_the_store_too(client: TestClient, monkeypatch):
    pack = client.post("/api/scene-packs", json={"name": "场景"}).json()
    base = f"/api/scene-packs/{pack['id']}/assets"
    bgm = client.post(base, json={"kind": "bgm", "label": "曲子"}).json()
    monkeypatch.setattr(settings, "storage_files", False)  # 库里也存一份,文件删了才有得退
    assert client.put(f"{base}/{bgm['id']}/file", files={"file": ("a.mp3", MP3, "audio/mpeg")}).status_code == 200
    monkeypatch.setattr(settings, "storage_files", True)
    path = store().path(sha_of(MP3), "audio/mpeg")
    assert path.read_bytes() == MP3
    path.unlink()
    assert client.get(f"{base}/{bgm['id']}/file").content == MP3


def test_the_ref_list_has_the_core_tables():
    names = [r.name for r in refs.all_refs()]
    assert names[:2] == ["立绘", "场景素材"]
