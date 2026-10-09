import cv2
import numpy as np

import app.images as images
from app.images import shrink_image


def _encode(img: np.ndarray, ext: str = ".png") -> bytes:
    ok, buf = cv2.imencode(ext, img)
    assert ok
    return buf.tobytes()


def _noise(h: int, w: int, channels: int = 4) -> np.ndarray:
    """随机噪点:PNG 几乎压不动,WebP 一定小得多"""
    img = np.random.default_rng(0).integers(0, 256, (h, w, channels), dtype=np.uint8)
    if channels == 4:
        img[:, :, 3] = 255
    return img


def _decode(data: bytes) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)


def test_shrinks_to_the_width_keeping_aspect_and_alpha():
    img = np.zeros((300, 200, 4), np.uint8)
    img[:, :, 1] = 200
    img[:, :, 3] = 255
    img[:150, :, 3] = 0  # 上半截透明

    small = _decode(shrink_image(_encode(img), 50))

    assert small.shape == (75, 50, 4)
    assert small[5, 25, 3] == 0
    assert small[70, 25, 3] == 255


def test_narrower_images_are_converted_to_webp_without_upscaling():
    # 手机上请求 1024 宽的立绘,原图只有 200 宽:不放大,只换成更小的 WebP,透明的地方还是透明
    img = _noise(300, 200)
    img[:100, :, 3] = 0
    png = _encode(img)

    out = shrink_image(png, 1024)

    assert out is not None and out[:4] == b"RIFF" and out[8:12] == b"WEBP"
    assert len(out) < len(png)
    back = _decode(out)
    assert back.shape == (300, 200, 4)
    assert back[50, 100, 3] == 0 and back[250, 100, 3] == 255


def test_keeps_the_original_when_webp_would_not_be_smaller(monkeypatch):
    png = _encode(_noise(40, 30))
    monkeypatch.setattr(images.cv2, "imencode", lambda *_a, **_k: (True, np.zeros(len(png) + 1, np.uint8)))
    images.clear_cache()

    assert shrink_image(png, 1024) is None


def test_undecodable_images_are_left_alone():
    assert shrink_image(b"GIF89a not really", 64) is None


def test_results_are_cached_so_each_image_is_converted_once(monkeypatch):
    images.clear_cache()
    png = _encode(_noise(120, 80))
    calls = []
    real = images.cv2.imdecode
    monkeypatch.setattr(images.cv2, "imdecode", lambda *a: calls.append(1) or real(*a))

    first = shrink_image(png, 64)
    again = shrink_image(bytes(png), 64)  # 每次请求从库里读出来的都是新的 bytes 对象
    other_width = shrink_image(png, 32)

    assert first == again and first is not None
    assert other_width is not None and other_width != first
    assert len(calls) == 2


def test_animated_images_are_not_flattened():
    # OpenCV 只解第一帧:动图转出来是张静图,得照发原图
    gif = b"GIF89a" + bytes(200)
    webp_anim = b"RIFF" + bytes(4) + b"WEBP" + b"VP8X" + bytes(4) + bytes([0x02]) + bytes(100)
    apng = b"\x89PNG\r\n\x1a\n" + b"....IHDR" + bytes(20) + b"....acTL" + bytes(10) + b"....IDAT" + bytes(10)
    for data in (gif, webp_anim, apng):
        assert images.is_animated(data)
        assert shrink_image(data, 64) is None
    assert not images.is_animated(_encode(_noise(10, 10)))
