"""文件仓库的读写:data/blobs/<sha 前两位>/<sha>.<扩展名>,放进去就不再改。

写法(设计 4.2):先写 <文件名>.tmp-<进程号>-<线程号>,刷到盘(fsync),读回来再算一遍指纹核对,
最后 os.replace 换成正式名字;同一个指纹的文件已经在了就跳过,永远不覆盖。Windows 上文件被占着
(PermissionError)就等一下再试。每放一个文件,`blobs` 表记一行(指纹、类型、大小)。
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Blob

SHA_RE = re.compile(r"^[0-9a-f]{64}$")

# 类型 → 扩展名;认不出的存 .bin
_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
}


def ext_of(mime: str) -> str:
    return _EXT.get(mime.lower().split(";")[0].strip(), "bin")


def sha_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def relpath(sha: str, mime: str) -> str:
    """仓库里的相对路径(整库导出 scripts/export_userdata.py 用的也是这个布局)"""
    return f"{sha[:2]}/{sha}.{ext_of(mime)}"


def default_root(database_url: str | None = None) -> Path:
    """不设 blob_dir 时:库文件旁边的 blobs/(内存库或别的库放 AnimaBackend/data/blobs/)"""
    if settings.blob_dir:
        return Path(settings.blob_dir)
    url = make_url(database_url or settings.database_url)
    if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
        return Path(url.database).parent / "blobs"
    return Path(__file__).resolve().parents[2] / "data" / "blobs"


@dataclass(frozen=True)
class BlobStore:
    root: Path

    def path(self, sha: str, mime: str) -> Path:
        if not SHA_RE.match(sha):
            raise ValueError(f"不是指纹:{sha!r}")
        return self.root / relpath(sha, mime)

    def has(self, sha: str, mime: str) -> bool:
        return self.path(sha, mime).is_file()

    def read(self, sha: str, mime: str) -> bytes | None:
        """文件在就读出来;不在(还没复制、被清理了)是 None,调用方退回读库"""
        try:
            return self.path(sha, mime).read_bytes()
        except (FileNotFoundError, ValueError):
            return None

    def verify(self, sha: str, mime: str) -> bool:
        """文件在、而且内容的指纹对得上"""
        data = self.read(sha, mime)
        return data is not None and sha_of(data) == sha

    def put(self, data: bytes, mime: str, db: Session | None = None) -> str:
        """放一个文件,返回指纹;已经在了就不再写。传了 db 就在 blobs 表记一行(不提交,随调用方的事务)"""
        sha = sha_of(data)
        target = self.path(sha, mime)
        if not target.is_file():
            self._write(target, data, sha)
        pending = db is not None and any(isinstance(o, Blob) and o.sha == sha for o in db.new)
        if db is not None and not pending and db.get(Blob, sha) is None:
            db.add(Blob(sha=sha, mime=mime, size=len(data)))
        return sha

    def _write(self, target: Path, data: bytes, sha: str) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f"{target.name}.tmp-{os.getpid()}-{threading.get_ident()}")
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        try:
            if sha_of(tmp.read_bytes()) != sha:
                raise OSError(f"写进仓库的文件读回来对不上:{target.name}")
            for attempt in range(6):
                try:
                    if target.is_file():  # 别的线程刚放好了同一个:不覆盖
                        break
                    os.replace(tmp, target)
                    break
                except PermissionError:
                    if attempt == 5:
                        raise
                    time.sleep(0.05 * 2**attempt)
        finally:
            tmp.unlink(missing_ok=True)

    def mime_of(self, db: Session, sha: str) -> str | None:
        """blobs 表里记的类型;没登记过是 None"""
        return db.scalar(select(Blob.mime).where(Blob.sha == sha))

    def clear_temp(self) -> int:
        """启动时清掉上次没写完留下的临时文件,返回清了几个"""
        n = 0
        if self.root.is_dir():
            for p in self.root.glob("*/*.tmp-*"):
                p.unlink(missing_ok=True)
                n += 1
        return n


def store() -> BlobStore:
    """后端用的那个仓库"""
    return BlobStore(default_root())
