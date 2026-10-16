"""/api/blobs/<sha>:文件仓库里的文件按指纹出。"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import images
from app.config import settings
from app.storage.blobs import sha_of, store

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(range(64))


def _sprite(client: TestClient, make_sprite_pack, data: bytes = PNG) -> dict:
    pack = make_sprite_pack()
    base = f"/api/sprite-packs/{pack['id']}/sprites"
    sprite = client.post(base, json={"label": "平静"}).json()
    return client.put(f"{base}/{sprite['id']}/image", files={"file": ("a.png", data, "image/png")}).json()


def _bgm(client: TestClient) -> dict:
    pack = client.post("/api/scene-packs", json={"name": "场景"}).json()
    base = f"/api/scene-packs/{pack['id']}/assets"
    bgm = client.post(base, json={"kind": "bgm", "label": "曲子"}).json()
    return client.put(f"{base}/{bgm['id']}/file", files={"file": ("a.mp3", MP3, "audio/mpeg")}).json()


def test_outputs_carry_the_sha_and_the_blob_url_serves_it(client: TestClient, make_sprite_pack):
    sprite = _sprite(client, make_sprite_pack)
    assert sprite["image_sha"] == sha_of(PNG)
    listed = client.get(f"/api/sprite-packs/{sprite['pack_id']}/sprites").json()
    assert listed[0]["image_sha"] == sha_of(PNG)

    got = client.get(f"/api/blobs/{sprite['image_sha']}")
    assert (got.status_code, got.content, got.headers["content-type"]) == (200, PNG, "image/png")
    assert got.headers["etag"] == f'"{sha_of(PNG)}"'
    assert "immutable" in got.headers["cache-control"]
    again = client.get(f"/api/blobs/{sprite['image_sha']}", headers={"If-None-Match": got.headers["etag"]})
    assert again.status_code == 304


def test_unknown_or_malformed_shas_are_404(client: TestClient):
    assert client.get(f"/api/blobs/{'0' * 64}").status_code == 404
    assert client.get("/api/blobs/..%2F..%2Fapp.db").status_code == 404
    assert client.get("/api/blobs/ABC").status_code == 404


def test_audio_supports_range_requests(client: TestClient):
    bgm = _bgm(client)
    assert bgm["data_sha"] == sha_of(MP3)
    part = client.get(f"/api/blobs/{bgm['data_sha']}", headers={"Range": "bytes=10-19"})
    assert part.status_code == 206
    assert part.content == MP3[10:20]
    assert part.headers["content-type"] == "audio/mpeg"
    # 曲子带 ?w= 不缩:照原样发
    assert client.get(f"/api/blobs/{bgm['data_sha']}?w=64").content == MP3


def test_a_missing_file_or_the_switch_off_reads_the_database(client: TestClient, make_sprite_pack, monkeypatch):
    # 开关关着时上传的(或者瘦身前的老行)库里才有原件;开着时上传的只在仓库里
    monkeypatch.setattr(settings, "storage_files", False)
    sha = _sprite(client, make_sprite_pack)["image_sha"]
    monkeypatch.setattr(settings, "storage_files", True)
    path = store().path(sha, "image/png")
    path.write_bytes(b"tampered")
    monkeypatch.setattr(settings, "storage_files", False)
    assert client.get(f"/api/blobs/{sha}").content == PNG
    monkeypatch.setattr(settings, "storage_files", True)
    path.unlink()
    assert client.get(f"/api/blobs/{sha}").content == PNG


@pytest.mark.skipif(images.cv2 is None, reason="没装 OpenCV")
def test_images_shrink_with_w(client: TestClient, make_sprite_pack):
    import cv2

    ok, buf = cv2.imencode(".png", np.full((60, 200, 3), 128, np.uint8) + np.arange(200, dtype=np.uint8)[None, :, None])
    assert ok
    sha = _sprite(client, make_sprite_pack, buf.tobytes())["image_sha"]
    small = client.get(f"/api/blobs/{sha}?w=50")
    assert small.headers["content-type"] == "image/webp"
    assert small.headers["etag"] == f'"{sha}.w50"'
    decoded = cv2.imdecode(np.frombuffer(small.content, np.uint8), cv2.IMREAD_UNCHANGED)
    assert decoded.shape[1] == 50
