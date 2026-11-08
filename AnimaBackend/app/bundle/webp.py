"""导出时把立绘、背景、CG 的 PNG / JPEG 转成 WebP(质量 90,保留透明),包小很多。

    new = compress(src)   # src 是 collect.FileSrc;返回新的 FileSrc(类型 image/webp,指纹是新文件的),不该转的返回 None

不转的:不是 PNG / JPEG(GIF、音频)、动图、太大 WebP 装不下、转完反而更大。
结果按原图指纹缓存在 <blobs>/.webp-cache/<sha>.webp;转完更大的记一个空的 <sha>.skip,下次直接用原图。
一张一张转,转完的字节只在写缓存时短暂在内存里,写 zip 时从缓存文件按块拷(FileSrc.disk)。
"""

from __future__ import annotations

import logging
import os
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image

from app.storage.blobs import sha_of_file, store

log = logging.getLogger(__name__)

QUALITY = 90
WEBP_MIME = "image/webp"
CONVERTIBLE = ("image/png", "image/jpeg")
MAX_SIDE = 16383  # WebP 的边长上限


def cache_dir() -> Path:
    return store().root / ".webp-cache"


def convert(data: bytes) -> bytes | None:
    """一张 PNG / JPEG 的原件 → WebP 字节;动图、太大、读不出来返回 None"""
    try:
        with Image.open(BytesIO(data)) as im:
            if getattr(im, "n_frames", 1) > 1 or max(im.size) > MAX_SIDE:
                return None
            has_alpha = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
            out = im.convert("RGBA" if has_alpha else "RGB")
        buf = BytesIO()
        out.save(buf, "WEBP", quality=QUALITY, method=4)
        return buf.getvalue()
    except Exception:  # noqa: BLE001  坏图、不认识的模式:用原图
        log.warning("图片转 WebP 失败,用原图", exc_info=True)
        return None


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def compress(src):
    """FileSrc → 转好的 FileSrc;不转返回 None"""
    if src.mime.lower().split(";")[0].strip() not in CONVERTIBLE or not src.sha:
        return None
    folder = cache_dir()
    hit, skip = folder / f"{src.sha}.webp", folder / f"{src.sha}.skip"
    if skip.is_file():
        return None
    if not hit.is_file():
        data = src.load()
        if data is None:
            return None
        out = convert(data)
        original = len(data)
        del data
        if out is None or len(out) >= original:
            _write_atomic(skip, b"")
            return None
        _write_atomic(hit, out)
        del out
    size = hit.stat().st_size
    return type(src)(sha_of_file(hit), WEBP_MIME, size, lambda p=hit: p.read_bytes(), hit)
