"""中转站和其他 OpenAI 兼容服务(设计第 6 节)。三种出图接口:
- images:POST /v1/images/generations(有参考图走 /v1/images/edits),回 b64_json 或 url
- chat:POST /v1/chat/completions,带 modalities;图可能在 message.images、content 列表、data URL 或 markdown 链接里
- gemini:POST /v1beta/models/{model}:generateContent,图在 inlineData

连接选项(都可以不填):api = auto / images / chat / gemini;sizes = 「1536x1024, 1024x1024」,填了就换成最接近的一种,
填空串原样发;extra = 额外参数(JSON),并进请求体。auto 试成功的那种由 api.py 记进连接的 resolved,下次先用它。
「接口不存在 / 不支持」才换下一种,鉴权、余额、内容审核的错直接报,不多扣钱。
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import time
from urllib.parse import urlsplit

import httpx

from app.plugins.imagegen.backends.base import BackendError, Conn, Job, Result, Timing
from app.tts.http import make_tts_client

TIMEOUT = httpx.Timeout(180.0, connect=15.0)
CHECK_TIMEOUT = httpx.Timeout(20.0, connect=10.0)
DEFAULT_SIZES = "1536x1024, 1024x1536, 1024x1024"
APIS = ("images", "chat", "gemini")
MAX_BYTES = 40 * 1024 * 1024

_MISSING = (404, 405, 501)
_MAYBE = (400, 415, 422, 500, 503)
_UNSUPPORTED = re.compile(
    r"not\s*support|unsupported|invalid\s*url|no\s*such|not\s*implemented|unknown\s*(endpoint|url|path)|"
    r"does\s*not\s*have\s*access\s*to\s*(this\s*)?endpoint|不支持|未实现|不存在的接口",
    re.IGNORECASE,
)
_RATIOS = ((1, 1), (16, 9), (9, 16), (4, 3), (3, 4), (3, 2), (2, 3))
_IMAGE_MODEL = re.compile(r"image|dall|flux|imagen|kolors|seedream|banana|midjourney|sdxl|stable", re.IGNORECASE)
_DATA_URL = re.compile(r"data:(image/[\w.+-]+);base64,([A-Za-z0-9+/=_-]+)")
_LINK = re.compile(r"https?://[^\s)\"'<>]+")


def _client(conn: Conn, timeout: httpx.Timeout) -> httpx.AsyncClient:
    # 局域网、Tailscale 上的服务直连,别被系统代理带走(和语音同一个判断)
    return make_tts_client(conn.base_url or "", timeout)


def _base(conn: Conn) -> str:
    if not conn.base_url:
        raise BackendError(400, f"「{conn.name}」还没填地址")
    return conn.base_url.rstrip("/")


def _v1(conn: Conn) -> str:
    """地址带不带 /v1 都行"""
    base = _base(conn)
    return base if re.search(r"/v\d+[a-z]*$", base) else f"{base}/v1"


def _root(conn: Conn) -> str:
    return re.sub(r"/v\d+[a-z]*$", "", _base(conn))


def _headers(conn: Conn, *, gemini: bool = False) -> dict[str, str]:
    if not conn.api_key:
        return {}
    headers = {"Authorization": f"Bearer {conn.api_key}"}
    if gemini:
        headers["x-goog-api-key"] = conn.api_key
    return headers


def _text_of(res: httpx.Response) -> str:
    """接口回的错误原文"""
    try:
        body = res.json()
    except ValueError:
        return res.text[:800]
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:800]
        for key in ("error", "message", "detail"):
            if isinstance(body.get(key), str):
                return body[key][:800]
    return json.dumps(body, ensure_ascii=False)[:800]


def _transport(conn: Conn, e: httpx.HTTPError) -> BackendError:
    if isinstance(e, httpx.ConnectTimeout):
        return BackendError(503, f"连不上 {conn.base_url}(连接超时)")
    if isinstance(e, httpx.TimeoutException):
        return BackendError(504, f"{conn.base_url} 超时没画完")
    return BackendError(503, f"连不上 {conn.base_url}:{e}")


class _Unsupported(Exception):
    """这种接口这家不支持,换下一种"""

    def __init__(self, error: BackendError):
        self.error = error


def _failed(res: httpx.Response) -> Exception:
    text = _text_of(res)
    error = BackendError(502, f"HTTP {res.status_code}: {text}")
    if res.status_code in _MISSING or (res.status_code in _MAYBE and _UNSUPPORTED.search(text)):
        return _Unsupported(error)
    return error


def order(conn: Conn, model: str) -> list[str]:
    """这张按什么顺序试接口"""
    options = conn.options or {}
    chosen = options.get("api") or "auto"
    if chosen in APIS:
        return [chosen]
    first = ["gemini", "chat", "images"] if "gemini" in model.lower() else ["images", "chat", "gemini"]
    known = (options.get("resolved") or {}).get(model)
    return [known, *[a for a in first if a != known]] if known in APIS else first


def snap_size(width: int, height: int, sizes: str) -> tuple[int, int]:
    """可用尺寸里长宽比最接近的一种,一样接近时挑面积接近的;没填原样"""
    found = [(int(a), int(b)) for a, b in re.findall(r"(\d{2,5})\s*[x×*]\s*(\d{2,5})", sizes or "")]
    if not found:
        return width, height
    ratio = width / height
    return min(found, key=lambda s: (round(abs(s[0] / s[1] - ratio), 4), abs(s[0] * s[1] - width * height)))


def _ratio_text(width: int, height: int) -> str:
    a, b = min(_RATIOS, key=lambda r: abs(r[0] / r[1] - width / height))
    return f"{a}:{b}"


def _extra(conn: Conn) -> dict:
    raw = (conn.options or {}).get("extra")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as e:
        raise BackendError(400, f"额外参数不是合法的 JSON:{e}") from e
    if not isinstance(value, dict):
        raise BackendError(400, "额外参数要是一个 JSON 对象")
    return value


def _decode(data: str) -> bytes:
    try:
        return base64.b64decode(data.split(",", 1)[-1] if data.startswith("data:") else data, validate=False)
    except (binascii.Error, ValueError) as e:
        raise BackendError(502, f"回来的图解不开:{e}") from e


def _pick_from_text(text: str) -> tuple[bytes | None, str | None]:
    """文字里找图:data URL 优先,其次链接"""
    m = _DATA_URL.search(text)
    if m:
        return _decode(m.group(2)), None
    m = _LINK.search(text)
    return (None, m.group(0).rstrip(".,")) if m else (None, None)


def _from_images(body: dict) -> tuple[bytes | None, str | None]:
    items = body.get("data") or []
    first = items[0] if items and isinstance(items[0], dict) else {}
    if first.get("b64_json"):
        return _decode(first["b64_json"]), None
    return None, first.get("url")


def _from_message(message: dict) -> tuple[bytes | None, str | None]:
    candidates: list[str] = []
    for image in message.get("images") or []:
        if isinstance(image, str):
            candidates.append(image)
        elif isinstance(image, dict):
            inner = image.get("image_url")
            candidates.append(inner.get("url", "") if isinstance(inner, dict) else str(inner or image.get("url") or ""))
    content = message.get("content")
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            inner = part.get("image_url")
            if isinstance(inner, dict):
                candidates.append(inner.get("url", ""))
            elif isinstance(inner, str):
                candidates.append(inner)
            elif part.get("b64_json"):
                return _decode(part["b64_json"]), None
            elif isinstance(part.get("text"), str):
                candidates.append(part["text"])
    elif isinstance(content, str):
        candidates.append(content)
    for text in candidates:
        data, url = _pick_from_text(text)
        if data or url:
            return data, url
    return None, None


def _from_gemini(body: dict) -> tuple[bytes | None, str | None]:
    for candidate in body.get("candidates") or []:
        for part in (candidate.get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return _decode(inline["data"]), None
    return None, None


async def _call_images(client: httpx.AsyncClient, conn: Conn, job: Job, size: str) -> tuple[bytes | None, str | None]:
    base = {"model": job.model, "prompt": job.prompt, "size": size, "n": 1, **_extra(conn)}
    if job.reference:
        fields = {k: (json.dumps(v) if isinstance(v, (dict, list)) else str(v)) for k, v in base.items()}
        files = {"image": ("reference.png", job.reference, job.reference_mime or "image/png")}
        res = await client.post(f"{_v1(conn)}/images/edits", headers=_headers(conn), data=fields, files=files)
    else:
        res = await client.post(f"{_v1(conn)}/images/generations", headers=_headers(conn), json=base)
    if res.status_code >= 300:
        raise _failed(res)
    return _from_images(res.json())


async def _call_chat(client: httpx.AsyncClient, conn: Conn, job: Job, ratio: str) -> tuple[bytes | None, str | None]:
    parts: list[dict] = [{"type": "text", "text": f"{job.prompt}\n\nAspect ratio: {ratio}"}]
    if job.reference:
        b64 = base64.b64encode(job.reference).decode()
        parts.append({"type": "image_url", "image_url": {"url": f"data:{job.reference_mime or 'image/png'};base64,{b64}"}})
    body = {"model": job.model, "messages": [{"role": "user", "content": parts}], "modalities": ["image", "text"], "stream": False, **_extra(conn)}
    res = await client.post(f"{_v1(conn)}/chat/completions", headers=_headers(conn), json=body)
    if res.status_code >= 300:
        raise _failed(res)
    choices = res.json().get("choices") or []
    return _from_message((choices[0].get("message") or {}) if choices else {})


async def _call_gemini(client: httpx.AsyncClient, conn: Conn, job: Job, ratio: str) -> tuple[bytes | None, str | None]:
    parts: list[dict] = [{"text": job.prompt}]
    if job.reference:
        parts.append({"inlineData": {"mimeType": job.reference_mime or "image/png", "data": base64.b64encode(job.reference).decode()}})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"], "imageConfig": {"aspectRatio": ratio}},
        **_extra(conn),
    }
    model = job.model.removeprefix("models/")
    res = await client.post(f"{_root(conn)}/v1beta/models/{model}:generateContent", headers=_headers(conn, gemini=True), json=body)
    if res.status_code >= 300:
        raise _failed(res)
    return _from_gemini(res.json())


async def _download(client: httpx.AsyncClient, conn: Conn, url: str) -> bytes:
    if urlsplit(url).scheme not in ("http", "https"):
        raise BackendError(502, f"回来的图片地址不认识:{url[:200]}")
    res = await client.get(url, follow_redirects=True)
    if res.status_code >= 300:
        raise BackendError(502, f"下载回来的图失败:HTTP {res.status_code}")
    if len(res.content) > MAX_BYTES:
        raise BackendError(502, "回来的图太大了")
    return res.content


async def draw(conn: Conn, job: Job) -> Result:
    if not job.model:
        raise BackendError(400, f"「{conn.name}」还没选模型")
    options = conn.options or {}
    width, height = snap_size(job.width, job.height, options.get("sizes", DEFAULT_SIZES))
    size, ratio = f"{width}x{height}", _ratio_text(width, height)
    tries = order(conn, job.model)
    first_error: BackendError | None = None
    started = time.perf_counter()
    async with _client(conn, TIMEOUT) as client:
        for api in tries:
            try:
                if api == "images":
                    data, url = await _call_images(client, conn, job, size)
                elif api == "chat":
                    data, url = await _call_chat(client, conn, job, ratio)
                else:
                    data, url = await _call_gemini(client, conn, job, ratio)
            except _Unsupported as e:
                first_error = first_error or e.error
                continue
            except httpx.HTTPError as e:
                raise _transport(conn, e) from e
            except ValueError as e:
                raise BackendError(502, f"接口回的不是 JSON:{e}") from e
            drawn = time.perf_counter()
            if not data and not url:
                # 接口是通的,但回的是字:多半是模型不会画图,换接口也没用
                raise BackendError(502, f"接口没有回图片(用的 {api} 接口,模型 {job.model} 可能不能出图)")
            if data is None:
                try:
                    data = await _download(client, conn, url)
                except httpx.HTTPError as e:
                    raise _transport(conn, e) from e
            done = time.perf_counter()
            timing = Timing(draw_ms=round((drawn - started) * 1000), fetch_ms=round((done - drawn) * 1000))
            return Result(data=data, mime="image/png", timing=timing, sent={"api": api, "size": size, "model": job.model})
    assert first_error is not None
    raise first_error


async def _models(conn: Conn) -> list[str]:
    try:
        async with _client(conn, CHECK_TIMEOUT) as client:
            res = await client.get(f"{_v1(conn)}/models", headers=_headers(conn))
    except httpx.HTTPError as e:
        raise _transport(conn, e) from e
    if res.status_code >= 300:
        raise BackendError(502, f"HTTP {res.status_code}: {_text_of(res)}")
    try:
        items = res.json().get("data") or []
    except (ValueError, AttributeError) as e:
        raise BackendError(502, f"接口回的不是模型列表:{e}") from e
    return [str(x["id"]) for x in items if isinstance(x, dict) and x.get("id")]


async def check(conn: Conn) -> str:
    """查连接(不花钱):能拉到模型列表就算通"""
    return f"{len(await _models(conn))} 个模型"


async def options(conn: Conn) -> dict:
    """模型下拉:名字像能画图的排前面"""
    names = await _models(conn)
    return {"models": sorted(names, key=lambda n: (not _IMAGE_MODEL.search(n), n.lower()))}
