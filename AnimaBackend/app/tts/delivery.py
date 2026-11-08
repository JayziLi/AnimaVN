"""把声音文件送到语音机(设计 docs/superpowers/specs/2026-11-08-voice-files-store-design.md)。

路径空、只有指纹的声音,合成配置里写 blob:<指纹>(缓存键按它算,和机器无关)。真要发给语音服务前 localize 换成实际路径:
同一台电脑给仓库路径;另一台电脑问插件有没有,缺的上传。路径非空的老声音不经过这里。
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

import httpx
from sqlalchemy.orm import Session

from app.models import TtsConnection
from app.storage.blobs import store
from app.tts.base import TTSError, VoiceSpec
from app.tts.http import is_local, make_tts_client, transport_error

T = TypeVar("T")

BLOB = "blob:"
SERVICES = {"gpt_sovits": "GPT-SoVITS", "indextts": "IndexTTS", "fish": "Fish Audio", "openai": "中转站"}
# 文件由 AnimaVN 自己带过去的云端服务,不探测
CLOUD = ("fish", "openai")
PROBE_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
UPLOAD_TIMEOUT = httpx.Timeout(600.0, connect=5.0)
ROUTE_TTL = 300.0
_CHUNK = 1024 * 1024


def service_of(conn) -> str:
    """连接类型对应的服务名,错误信息里用(没有类型的当 GPT-SoVITS)"""
    return SERVICES.get(getattr(conn, "api_type", "gpt_sovits"), SERVICES["gpt_sovits"])


def no_route(service: str) -> str:
    return (
        f"声音文件还没放到语音机上,这台 {service} 也没装 AnimaVN 小插件。"
        "装上插件并填配对码,或者在声音编辑器里导出文件手动放过去"
    )


NO_ROUTE = no_route(SERVICES["gpt_sovits"])


@dataclass(frozen=True)
class Route:
    kind: str  # same 同一台 / plugin 另一台,有插件 / none 送不过去
    plugin: bool = False
    pair_ok: bool = False


_routes: dict[str, tuple[tuple, Route, float]] = {}
_known: dict[str, dict[str, str]] = {}
_locks: dict[str, asyncio.Lock] = {}


def blob_ref(sha: str | None) -> str:
    return BLOB + sha if sha else ""


def path_or_blob(path: str, sha: str | None) -> str:
    return path or blob_ref(sha)


def pair_code_of(conn: TtsConnection) -> str:
    return str((conn.options or {}).get("pair_code") or "")


def forget(conn_id: str) -> None:
    """地址或配对码改了、语音机丢了文件:下次重新问"""
    _routes.pop(conn_id, None)
    _known.pop(conn_id, None)


def reset() -> None:
    """测试用"""
    _routes.clear()
    _known.clear()
    _locks.clear()


def _headers(conn: TtsConnection) -> dict[str, str]:
    code = pair_code_of(conn)
    return {"X-Anima-Pair": code} if code else {}


def _is_blob(path: str) -> bool:
    return path.startswith(BLOB)


def _sha(path: str) -> str:
    return path[len(BLOB) :]


def _lock(conn_id: str) -> asyncio.Lock:
    # 测试里每个 asyncio.run 是新的事件循环,reset() 会清掉旧锁
    return _locks.setdefault(conn_id, asyncio.Lock())


async def _sees_our_file(client: httpx.AsyncClient, base: str) -> bool:
    """AnimaVN 写一个小文件,问插件读不读得到、内容对不对。读得到就是同一台电脑"""
    blobs = store()
    blobs.root.mkdir(parents=True, exist_ok=True)
    data = uuid.uuid4().hex.encode()
    probe = blobs.root / f".probe-{uuid.uuid4().hex}.txt"
    probe.write_bytes(data)
    try:
        res = await client.post(
            f"{base}/anima/same-machine", json={"path": str(probe.resolve()), "sha256": hashlib.sha256(data).hexdigest()}
        )
        return res.status_code == 200 and res.json().get("same") is True
    finally:
        probe.unlink(missing_ok=True)


async def route_of(conn: TtsConnection, *, fresh: bool = False) -> Route:
    """这条连接的文件怎么送。结果记 5 分钟;连不上抛 TTSError,不记"""
    if getattr(conn, "api_type", "") in CLOUD:
        return Route("same")
    sig = (conn.base_url, pair_code_of(conn))
    hit = _routes.get(conn.id)
    if not fresh and hit is not None and hit[0] == sig and time.monotonic() - hit[2] < ROUTE_TTL:
        return hit[1]
    base = conn.base_url.rstrip("/")
    try:
        async with make_tts_client(base, PROBE_TIMEOUT) as client:
            res = await client.get(f"{base}/anima/info", headers=_headers(conn))
            if res.status_code == 200 and isinstance(res.json(), dict) and res.json().get("plugin"):
                pair_ok = bool(res.json().get("pair_ok"))
                route = Route("same" if await _sees_our_file(client, base) else "plugin", True, pair_ok)
            else:
                route = Route("same" if is_local(base) else "none")
    except httpx.HTTPError as e:
        raise TTSError(*transport_error(base, service_of(conn), e)) from e
    _routes[conn.id] = (sig, route, time.monotonic())
    return route


async def _upload(client: httpx.AsyncClient, conn: TtsConnection, base: str, sha: str, disk: Path) -> str:
    async def chunks():
        with open(disk, "rb") as f:
            while data := f.read(_CHUNK):
                yield data

    headers = {**_headers(conn), "Content-Length": str(disk.stat().st_size)}
    res = await client.put(f"{base}/anima/blob/{sha}", params={"ext": disk.suffix.lstrip(".")}, headers=headers, content=chunks())
    if res.status_code != 200:
        raise TTSError(*_plugin_error(res, service_of(conn)))
    return str(res.json()["path"])


def _plugin_error(res: httpx.Response, service: str) -> tuple[int, str]:
    try:
        detail = res.json().get("detail")
    except (ValueError, AttributeError):
        detail = None
    if res.status_code == 401:
        return 400, "语音服务的配对码不对:在语音服务页填 GSV 启动窗口里显示的配对码"
    return 502, str(detail or f"{service} 插件返回 HTTP {res.status_code}")


async def _ensure_remote(conn: TtsConnection, files: dict[str, Path]) -> dict[str, str]:
    """保证语音机上有这些文件,返回 {指纹: 那边的路径}"""
    base = conn.base_url.rstrip("/")
    async with _lock(conn.id):
        known = _known.setdefault(conn.id, {})
        need = [s for s in files if s not in known]
        if need:
            try:
                async with make_tts_client(base, UPLOAD_TIMEOUT) as client:
                    res = await client.post(f"{base}/anima/have", headers=_headers(conn), json={"shas": need})
                    if res.status_code != 200:
                        raise TTSError(*_plugin_error(res, service_of(conn)))
                    known.update({k: str(v) for k, v in res.json().get("have", {}).items()})
                    for sha in need:
                        if sha not in known:
                            known[sha] = await _upload(client, conn, base, sha, files[sha])
            except httpx.HTTPError as e:
                raise TTSError(*transport_error(base, service_of(conn), e)) from e
        return {s: known[s] for s in files}


async def localize(db: Session, conn: TtsConnection, spec: VoiceSpec) -> VoiceSpec:
    """把配置里的 blob:<指纹> 换成语音机上的实际路径;没有 blob 引用就原样返回,不碰网络"""
    fields = [spec.gpt_weights, spec.sovits_weights, spec.ref_path, spec.spk_ref_path, *spec.aux_ref_paths]
    shas = {_sha(p) for p in fields if _is_blob(p)}
    if not shas:
        return spec
    route = await route_of(conn)
    if route.kind == "none":
        raise TTSError(400, no_route(service_of(conn)))
    blobs = store()
    files: dict[str, Path] = {}
    for sha in shas:
        mime = blobs.mime_of(db, sha)
        disk = blobs.path(sha, mime) if mime else None
        if disk is None or not disk.is_file():
            raise TTSError(400, f"声音文件不在文件仓库里了(指纹 {sha[:12]}…),重新导入这个声音")
        files[sha] = disk
    if route.kind == "same":
        where = {s: str(p.resolve()) for s, p in files.items()}
    else:
        where = await _ensure_remote(conn, files)

    def real(path: str) -> str:
        return where[_sha(path)] if _is_blob(path) else path

    return dataclasses.replace(
        spec,
        gpt_weights=real(spec.gpt_weights),
        sovits_weights=real(spec.sovits_weights),
        ref_path=real(spec.ref_path),
        spk_ref_path=real(spec.spk_ref_path),
        aux_ref_paths=tuple(real(p) for p in spec.aux_ref_paths),
    )


def _looks_missing(message: str) -> bool:
    """api_v2 说参考不存在(「… not exists」)或切权重失败:可能是语音机上的缓存被清了,值得重送一次"""
    return "not exists" in message or "文件不存在" in message or message.startswith("切换 ")


async def with_files(db: Session, conn: TtsConnection, spec: VoiceSpec, run: Callable[[VoiceSpec], Awaitable[T]]) -> T:
    real = await localize(db, conn, spec)
    if real is spec:
        return await run(spec)
    try:
        return await run(real)
    except TTSError as e:
        if not _looks_missing(e.message):
            raise
        forget(conn.id)
        return await run(await localize(db, conn, spec))
