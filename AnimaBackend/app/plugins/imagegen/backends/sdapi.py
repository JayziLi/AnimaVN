"""本地 SD:A1111 接口(/sdapi/v1/...,A1111、Forge 开了 API 都是这个)。设计第 5 节。

- 提示词在 sdprompt.py 拼好放进 Job,LoRA 已经写在提示词里,这里不单独发。
- 模型、采样器、调度器、LoRA 列表、进度都是可选的:别人自己包的接口可能只有出图,拿不到就不给那一项,照样能画。
- 本地 SD 自己排队,这边不加锁;排队拿不开,算在 draw 里。
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import time
from collections.abc import Callable
from urllib.parse import urlsplit

import httpx

from app.assets.common import sniff_image_mime
from app.plugins.imagegen.backends.base import BackendError, Conn, Job, Result, Timing
from app.tts.http import make_tts_client

TIMEOUT = httpx.Timeout(300.0, connect=10.0)
QUERY_TIMEOUT = httpx.Timeout(15.0, connect=10.0)
POLL_EVERY = 0.5

_DRAW_TIMEOUT_TEXT = "等了 300 秒没画完"
_QUERY_TIMEOUT_TEXT = "等了 15 秒没有回应"


def _client(conn: Conn, timeout: httpx.Timeout) -> httpx.AsyncClient:
    # 本机、局域网、Tailscale 上的服务直连,别被系统代理带走(和语音同一个判断)
    return make_tts_client(conn.base_url or "", timeout)


def _base(conn: Conn) -> str:
    if not conn.base_url:
        raise BackendError(400, f"「{conn.name}」还没填地址")
    return conn.base_url.rstrip("/")


def _auth(conn: Conn) -> httpx.BasicAuth | None:
    """api_key 是可选的「用户:密码」(WebUI 的 --api-auth)"""
    if not conn.api_key:
        return None
    user, _, password = conn.api_key.partition(":")
    return httpx.BasicAuth(user, password)


def _to_text(value: object) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def _error_text(res: httpx.Response) -> str:
    """接口回的错误原文。A1111 的 HTTP 错误原因在 detail;代码里抛异常时 detail 是空的,error 是类型、errors 是原因"""
    try:
        body = res.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        if body.get("detail"):
            return _to_text(body["detail"])[:800]
        found = [_to_text(body[k]) for k in ("error", "errors") if body.get(k)]
        if found:
            return ": ".join(found)[:800]
    return f"HTTP {res.status_code}: {res.text[:200]}"


def _is_this_machine(conn: Conn) -> bool:
    host = (urlsplit(conn.base_url or "").hostname or "").strip("[]").lower()
    return host == "localhost" or host.startswith("127.") or host == "::1"


def _transport(conn: Conn, e: httpx.HTTPError, *, read_timeout: str = _DRAW_TIMEOUT_TEXT) -> BackendError:
    url = conn.base_url
    if isinstance(e, httpx.ConnectTimeout):
        return BackendError(503, f"连不上 {url}(机器没开机,或者不在同一个网络)")
    if isinstance(e, httpx.TimeoutException):
        return BackendError(504, read_timeout)
    if isinstance(e, httpx.ConnectError):
        if _is_this_machine(conn):
            return BackendError(503, f"连不上 {url}(服务没开,或者端口不对)")
        return BackendError(503, f"连不上 {url}(机器没开机、服务没开,或者网络不通)")
    return BackendError(503, f"{url} 没回应(连接断了,服务可能没开好或者崩了)")


def _payload(job: Job) -> dict:
    body = {
        "prompt": job.prompt,
        "negative_prompt": job.negative,
        "width": job.width,
        "height": job.height,
        "seed": job.seed,
        "steps": job.steps,
        "cfg_scale": job.scale,
        "batch_size": 1,
        "n_iter": 1,
        "send_images": True,
        "save_images": False,
        # 画完不换回原来的模型,下一张不用重新加载
        "override_settings_restore_afterwards": False,
    }
    if job.sampler:
        body["sampler_name"] = job.sampler
    if job.scheduler:
        body["scheduler"] = job.scheduler
    if job.model:
        body["override_settings"] = {"sd_model_checkpoint": job.model}
    return body


def _image_of(res: httpx.Response) -> tuple[bytes, str]:
    """回包里的第一张图:(字节, 类型)。不信任声明的类型,按文件头认"""
    try:
        body = res.json()
    except ValueError as e:
        raise BackendError(502, f"接口回的不是 JSON:{e}") from e
    images = body.get("images") if isinstance(body, dict) else None
    first = images[0] if isinstance(images, list) and images else None
    if not first or not isinstance(first, str):
        raise BackendError(502, "接口没有回图片")
    encoded = first.split(",", 1)[-1] if first.startswith("data:") else first
    try:
        data = base64.b64decode(encoded)
    except (binascii.Error, ValueError) as e:
        raise BackendError(502, f"回来的图解不开:{e}") from e
    mime = sniff_image_mime(data)
    if mime is None:
        raise BackendError(502, "回来的内容不是图片")
    return data, mime


async def _poll_previews(client: httpx.AsyncClient, conn: Conn, on_preview: Callable[[str, float], None]) -> None:
    """一直查进度,有新的预览图就回调,等 draw 取消。这里出什么错都吞掉,不能影响出图"""
    url = f"{_base(conn)}/sdapi/v1/progress"
    last = None
    while True:
        await asyncio.sleep(POLL_EVERY)
        try:
            res = await client.get(url, params={"skip_current_image": "false"}, auth=_auth(conn), timeout=QUERY_TIMEOUT)
            if res.status_code != 200:
                continue
            body = res.json()
            image = body.get("current_image")
            if image and image != last:
                last = image
                on_preview(image, float(body.get("progress") or 0))
        except Exception:
            continue


async def draw(conn: Conn, job: Job, on_preview: Callable[[str, float], None] | None = None) -> Result:
    """画一张。on_preview(预览图 base64, 进度 0–1):服务端开了预览才会有"""
    url = f"{_base(conn)}/sdapi/v1/txt2img"
    body = _payload(job)
    started = time.perf_counter()
    async with _client(conn, TIMEOUT) as client:
        poller = asyncio.create_task(_poll_previews(client, conn, on_preview)) if on_preview else None
        try:
            res = await client.post(url, json=body, auth=_auth(conn))
        except httpx.HTTPError as e:
            raise _transport(conn, e) from e
        finally:
            if poller:
                poller.cancel()
                await asyncio.gather(poller, return_exceptions=True)
    if res.status_code != 200:
        raise BackendError(502, _error_text(res))
    data, mime = _image_of(res)
    timing = Timing(draw_ms=round((time.perf_counter() - started) * 1000))
    sent = {k: v for k, v in body.items() if k not in ("prompt", "negative_prompt")}
    return Result(data=data, mime=mime, timing=timing, sent=sent)


async def check(conn: Conn) -> str:
    """查连接(不花钱):拉模型列表。404 说明端口有服务在答话,只是自己包的接口没做这一项"""
    url = f"{_base(conn)}/sdapi/v1/sd-models"
    try:
        async with _client(conn, QUERY_TIMEOUT) as client:
            res = await client.get(url, auth=_auth(conn))
    except httpx.HTTPError as e:
        raise _transport(conn, e, read_timeout=_QUERY_TIMEOUT_TEXT) from e
    if res.status_code == 404:
        return "通了(这个服务没有模型列表)"
    if res.status_code != 200:
        raise BackendError(502, _error_text(res))
    try:
        models = res.json()
    except ValueError:
        models = None
    if not isinstance(models, list):
        raise BackendError(502, "接口回的不是模型列表(地址对吗?)")
    return f"{len(models)} 个模型"


async def _names(client: httpx.AsyncClient, conn: Conn, path: str, field: str) -> list[str] | None:
    """拉一个列表,取每项的 field。拿不到是 None"""
    try:
        res = await client.get(f"{_base(conn)}/sdapi/v1/{path}", auth=_auth(conn))
        items = res.json() if res.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None
    if not isinstance(items, list):
        return None
    return [str(x[field]) for x in items if isinstance(x, dict) and x.get(field)]


async def options(conn: Conn) -> dict:
    """下拉列表。四项各取各的,哪项拿不到就不给那个键(界面据此隐藏),都拿不到回空"""
    if not conn.base_url:
        return {}
    wanted = {"models": ("sd-models", "title"), "samplers": ("samplers", "name"), "schedulers": ("schedulers", "name"), "loras": ("loras", "name")}
    async with _client(conn, QUERY_TIMEOUT) as client:
        found = await asyncio.gather(*(_names(client, conn, path, field) for path, field in wanted.values()))
    return {key: names for key, names in zip(wanted, found, strict=True) if names is not None}


async def refresh_loras(conn: Conn) -> None:
    """让服务重新扫一遍 LoRA 文件夹,新放进去的也能看到。服务没做这个接口就算了"""
    url = f"{_base(conn)}/sdapi/v1/refresh-loras"
    try:
        async with _client(conn, QUERY_TIMEOUT) as client:
            res = await client.post(url, auth=_auth(conn))
    except httpx.HTTPError as e:
        raise _transport(conn, e, read_timeout=_QUERY_TIMEOUT_TEXT) from e
    if res.status_code not in (200, 404):
        raise BackendError(502, _error_text(res))
