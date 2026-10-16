"""图片接口的 ?w= :按宽度出一份 WebP。两种用法:

- 取色:标题画面要从立绘、背景里取色,前端得在 canvas 里读像素 —— 跨域的图要带 CORS 头才读得到,
  而游戏里早就用普通 <img> 把原图载进了缓存(那次请求不带 Origin,响应里也就没有 CORS 头,
  还设了一年的缓存),同一个地址再以 CORS 方式请求会直接吃到这份缓存、被浏览器拦下。
  换个地址(加 ?w=)就绕开了,顺带只下几 KB,不用为了取个色把整张原图再拉一遍。
- 手机上显示立绘(2026-09-27):原图 PNG 一张动辄近 1 MB,手机上等太久。前端在触屏设备上
  请求 ?w=1024,这里转成 WebP(芳乃一张 934 KB → 146 KB)。立绘原图大多就 1000 宽上下,
  比这窄的不放大,只换格式。

转一张要 0.1–0.5 秒,结果按「原图内容 + 宽度」缓存在内存里,每台新设备来要时不用再转。

2026-10-04:电脑也改成要 WebP 了(立绘 ?w=1280、背景 / CG ?w=1920),一个角色十几张原图 PNG
加起来十几 MB,进游戏太慢。转好的也存一份到硬盘(data/image-cache/),后端重启不用重转;
启动后后台把所有立绘和背景按前端会要的几个宽度先转一遍(prewarm),第一次进游戏也不用等。
"""

import hashlib
import logging
import threading
from collections import OrderedDict
from pathlib import Path
from threading import Lock

import numpy as np

# 前端会要的宽度(lib/api.ts):立绘 电脑 1280 / 触屏 1024;背景、CG 电脑 1920 / 触屏 1280。前后端共用,值在 app/contracts.py
from app.contracts import SCENE_WIDTHS, SPRITE_WIDTHS

try:
    import cv2
except ImportError:  # 没装 OpenCV:一律发原图
    cv2 = None

# ?w= 的范围:再小取色不准;背景要铺满电脑屏幕,给到 2048
MIN_WIDTH = 16
MAX_WIDTH = 2048
WEBP_QUALITY = 85

# 转好的图存在硬盘上,文件名 = 原图内容的哈希 + 宽度;转不小的记一个空的 .none
DISK_DIR = Path(__file__).resolve().parent.parent / "data" / "image-cache"

log = logging.getLogger(__name__)

# 转好的图留在内存里,按字节数封顶(一张立绘转完 100–200 KB,几百张也就几十 MB)
CACHE_BYTES = 64 * 1024 * 1024
_cache: OrderedDict[tuple[bytes, int], bytes | None] = OrderedDict()
_cache_bytes = 0
_lock = Lock()


def clear_cache() -> None:
    global _cache_bytes
    with _lock:
        _cache.clear()
        _cache_bytes = 0


def is_animated(data: bytes) -> bool:
    """GIF(一律当动图,静态 GIF 也不差这点)、带动画标记的 WebP、APNG"""
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return True
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP" and data[12:16] == b"VP8X":
        return len(data) > 20 and bool(data[20] & 0x02)
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        idat = data.find(b"IDAT")
        actl = data.find(b"acTL", 0, idat if idat != -1 else len(data))
        return actl != -1
    return False


def shrink_image(data: bytes, width: int) -> bytes | None:
    """最宽 width 的 WebP(比这宽的等比缩小,窄的保持原尺寸),透明通道保留。

    返回 None:转出来不比原图小、图解不开(GIF 之类 OpenCV 读不了的),或者没装 OpenCV ——
    调用方都照发原图。
    """
    # 动图不转:OpenCV 只解第一帧,转出来的 WebP 是张静图(还比原图小,就会被发出去)。
    # 放在查缓存之前 —— 以前已经转好存在硬盘上的静图也别再发
    if is_animated(data):
        return None
    key = (hashlib.blake2b(data, digest_size=16).digest(), width)
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    stem = DISK_DIR / f"{key[0].hex()}_{width}"
    webp, none = stem.with_suffix(".webp"), stem.with_suffix(".none")
    try:
        if webp.exists():
            out = webp.read_bytes()
            _remember(key, out)
            return out
        if none.exists():
            _remember(key, None)
            return None
    except OSError:
        pass
    out = _convert(data, width)
    _remember(key, out)
    try:
        DISK_DIR.mkdir(parents=True, exist_ok=True)
        if out is None:
            none.touch()
        else:
            # 临时文件名带上线程号:后台预转和请求可能同时在转同一张,共用一个 .tmp 会互相踩
            tmp = stem.with_name(f"{stem.name}.{threading.get_ident()}.tmp")
            tmp.write_bytes(out)
            tmp.replace(webp)
    except OSError:
        # 硬盘写不了就只留在内存里
        pass
    return out


def prewarm(session_factory) -> None:
    """后台线程:把所有立绘、背景、CG 按前端会要的宽度先转好(已经在硬盘上的直接跳过)"""

    def run() -> None:
        from sqlalchemy import select

        from app.models import PackSprite, SceneAsset
        from app.storage import refs

        done = 0
        try:
            with session_factory() as db:
                ids = db.scalars(select(PackSprite.id).where(PackSprite.mime.is_not(None))).all()
                for sid in ids:
                    row = db.get(PackSprite, sid)
                    data = refs.read_bytes(refs.SPRITE, row) if row is not None else None
                    if data:
                        for w in SPRITE_WIDTHS.values():
                            shrink_image(data, w)
                        done += 1
                    db.expunge_all()
                ids = db.scalars(
                    select(SceneAsset.id).where(SceneAsset.kind.in_(("bg", "cg")), SceneAsset.mime.is_not(None))
                ).all()
                for aid in ids:
                    row = db.get(SceneAsset, aid)
                    data = refs.read_bytes(refs.SCENE_ASSET, row) if row is not None else None
                    if data:
                        for w in SCENE_WIDTHS.values():
                            shrink_image(data, w)
                        done += 1
                    db.expunge_all()
            log.info("图片预转完成:%d 张", done)
        except Exception:  # noqa: BLE001 —— 预热失败不影响正常请求(请求时照样现转)
            log.exception("图片预转中断(已转 %d 张)", done)

    threading.Thread(target=run, name="image-prewarm", daemon=True).start()


def _convert(data: bytes, width: int) -> bytes | None:
    if cv2 is None:
        return None
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    if img.dtype != np.uint8:
        img = (img / 257).astype(np.uint8)
    h, w = img.shape[:2]
    if w > width:
        img = cv2.resize(img, (width, max(1, round(h * width / w))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".webp", img, [cv2.IMWRITE_WEBP_QUALITY, WEBP_QUALITY])
    if not ok or len(buf) >= len(data):
        return None
    return buf.tobytes()


def _remember(key: tuple[bytes, int], out: bytes | None) -> None:
    global _cache_bytes
    with _lock:
        if key in _cache:
            return
        _cache[key] = out
        _cache_bytes += len(out or b"")
        while _cache_bytes > CACHE_BYTES and _cache:
            _, old = _cache.popitem(last=False)
            _cache_bytes -= len(old or b"")
