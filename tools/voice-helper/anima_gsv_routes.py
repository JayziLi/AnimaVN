"""AnimaVN 给 GPT-SoVITS 加的接口(/anima/*):收声音文件、按指纹查、同机探测、只读取文件。
不改 GSV 源码,由 api_v2_anima.py 挂到 api_v2 的 APP 上。只依赖 fastapi。
整合包的 runtime 是 Python 3.9:这个文件别用 3.10 的语法。
"""

import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import uuid
from pathlib import Path
from typing import List, Optional, Sequence

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

PLUGIN_VERSION = 1
PAIR_HEADER = "x-anima-pair"
ALLOWED = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".ckpt", ".pth"}
MAX_PROBE = 64 * 1024
_SHA = re.compile(r"^[0-9a-f]{64}$")
_CHUNK = 1024 * 1024
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_TAILSCALE = ipaddress.ip_network("100.64.0.0/10")


class SameMachineIn(BaseModel):
    path: str
    sha256: str


class HaveIn(BaseModel):
    shas: List[str]


def load_pair_code(path: Path) -> str:
    """配对码:第一次生成,之后一直用这个"""
    path = Path(path)
    if path.is_file():
        code = path.read_text(encoding="utf-8").strip()
        if code:
            return code
    code = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(code, encoding="utf-8")
    return code


def _client_ok(host: Optional[str]) -> bool:
    """只接受本机、私有网段、Tailscale"""
    try:
        ip = ipaddress.ip_address(host or "")
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback or ip.is_private or ip.is_link_local or (ip.version == 4 and ip in _TAILSCALE)


def _no(status: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail})


def register(app: FastAPI, root: Path, extra_roots: Sequence[Path] = ()) -> str:
    """把 /anima/* 挂到 app 上。root = GSV 目录(缓存和配对码放这里);extra_roots = /anima/ref 另外能读的目录。返回配对码"""
    root = Path(root).resolve()
    cache = root / "anima_cache"
    incoming = cache / ".incoming"
    incoming.mkdir(parents=True, exist_ok=True)
    code = load_pair_code(root / "anima_pair.txt")
    readable = [cache] + [Path(p).resolve() for p in extra_roots if Path(p).exists()]

    def code_ok(request: Request) -> bool:
        return hmac.compare_digest(request.headers.get(PAIR_HEADER, ""), code)

    def refuse(request: Request, need_code: bool) -> Optional[JSONResponse]:
        if not _client_ok(request.client.host if request.client else None):
            return _no(403, "只接受本机、局域网和 Tailscale 上的连接")
        if need_code and not code_ok(request):
            return _no(401, "配对码不对")
        return None

    def cached(sha: str) -> Optional[Path]:
        for p in (cache / sha[:2]).glob(sha + ".*"):
            if p.suffix.lower() in ALLOWED and p.is_file():
                return p
        return None

    @app.get("/anima/info")
    def anima_info(request: Request):
        bad = refuse(request, False)
        return bad or {"plugin": PLUGIN_VERSION, "pair_ok": code_ok(request)}

    @app.post("/anima/same-machine")
    def anima_same_machine(request: Request, req: SameMachineIn):
        bad = refuse(request, False)
        if bad:
            return bad
        try:
            p = Path(req.path)
            if not p.is_file() or p.stat().st_size > MAX_PROBE:
                return {"same": False}
            return {"same": hashlib.sha256(p.read_bytes()).hexdigest() == req.sha256}
        except (OSError, ValueError):
            return {"same": False}

    @app.post("/anima/have")
    def anima_have(request: Request, req: HaveIn):
        bad = refuse(request, True)
        if bad:
            return bad
        have = {}
        for sha in req.shas:
            p = cached(sha) if _SHA.match(sha) else None
            if p is not None:
                have[sha] = p.as_posix()
        return {"have": have}

    @app.put("/anima/blob/{sha}")
    async def anima_blob(sha: str, ext: str, request: Request):
        bad = refuse(request, True)
        if bad:
            return bad
        suffix = "." + ext.lower().lstrip(".")
        if not _SHA.match(sha) or suffix not in ALLOWED:
            return _no(400, "指纹或扩展名不对")
        old = cached(sha)
        if old is not None:
            return {"path": old.as_posix()}
        tmp = incoming / (uuid.uuid4().hex + ".part")
        digest = hashlib.sha256()
        try:
            with open(tmp, "wb") as f:
                async for chunk in request.stream():
                    digest.update(chunk)
                    f.write(chunk)
            if digest.hexdigest() != sha:
                return _no(400, "收到的文件和指纹对不上")
            target = cache / sha[:2] / (sha + suffix)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(tmp, target)
            return {"path": target.as_posix()}
        finally:
            if tmp.exists():
                tmp.unlink()

    @app.get("/anima/ref")
    def anima_ref(path: str, request: Request):
        bad = refuse(request, False)
        if bad:
            return bad
        try:
            p = Path(path).resolve()
        except (OSError, ValueError):
            return _no(400, "路径不对:" + path)
        if not any(r == p or r in p.parents for r in readable) or p.suffix.lower() not in ALLOWED:
            return _no(403, "只能读 " + "、".join(str(r) for r in readable) + " 下面的音频和模型文件")
        if not p.is_file():
            return _no(404, "文件不存在:" + path)
        return FileResponse(p, filename=p.name)

    return code
