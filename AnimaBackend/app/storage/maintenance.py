"""文件仓库的维护:手动备份、清理没人用的文件、体检、给设置页看的概况。命令行见 __main__.py。

清理先「标记」再「挪走」:现在的库、data/backups/ 里留着的每一份备份(还有库旁边手动拷的 .bak*)里
所有指纹列提到的文件都算有人用 —— 退回哪一份备份,它要的文件都还在。没人用、而且放进仓库超过 24 小时的
(刚上传、还没提交的不误伤)挪进仓库旁边的 blobs-trash/<日期>/,回收区里放了超过 30 天的才真删。
有一份备份读不出来就整个不清:不知道它要哪些文件,宁可不动。
"""

from __future__ import annotations

import shutil
import sqlite3
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.migrations import startup
from app.migrations.sqlite_util import columns
from app.models import Blob, MaintenanceJob
from app.storage.blobs import SHA_RE, BlobStore
from app.storage.copy import JOB_ID
from app.storage.refs import all_refs

KEEP_MANUAL = 5
GRACE = timedelta(hours=24)
TRASH_DAYS = 30

# 备份、清理、体检同时只跑一个(设置页连点、命令行和后端一起跑)
busy = threading.Lock()


def trash_root(blobs: BlobStore) -> Path:
    return blobs.root.with_name(blobs.root.name + "-trash")


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds")


# ── 备份 ──


def backup_now(db_path: Path) -> dict:
    """在线备份账本(库文件)到 data/backups/,手动的只留最近 KEEP_MANUAL 份。
    文件仓库不用跟着拷:清理时会照着留着的备份把它们要的文件都留下"""
    path = Path(startup.backup(db_path, prefix=startup.MANUAL_PREFIX, keep=KEEP_MANUAL))
    stat = path.stat()
    return {"name": path.name, "at": _iso(stat.st_mtime), "size": stat.st_size}


def backup_files(db_path: Path) -> list[Path]:
    folder = startup.backups_dir(db_path)
    found = [*folder.glob(f"{startup.BACKUP_PREFIX}*"), *folder.glob(f"{startup.MANUAL_PREFIX}*")]
    found += db_path.parent.glob(f"{db_path.name}.bak*")
    return sorted(p for p in found if p.is_file())


# ── 清理 ──


def shas_in(conn: sqlite3.Connection) -> set[str]:
    """这个库里所有指纹列提到的指纹(没有这些列的老库、老备份:原件都在库里,一个也不要)"""
    out: set[str] = set()
    for ref in all_refs():
        table = ref.model.__tablename__
        if ref.sha in columns(conn, table):
            out.update(r[0] for r in conn.execute(f'SELECT DISTINCT "{ref.sha}" FROM "{table}" WHERE "{ref.sha}" IS NOT NULL'))
    return out


def referenced(db_path: Path) -> set[str]:
    keep: set[str] = set()
    for path in [db_path, *backup_files(db_path)]:
        try:
            conn = startup.open_ro(path)
            try:
                keep |= shas_in(conn)
            finally:
                conn.close()
        except sqlite3.Error as exc:
            raise RuntimeError(f"读不出 {path.name}({exc}),不知道它要哪些文件,这次先不清理") from exc
    return keep


@dataclass
class CleanResult:
    kept: int = 0
    moved: int = 0
    moved_bytes: int = 0
    young: int = 0
    purged: int = 0


def clean(db_path: Path, blobs: BlobStore, now: datetime | None = None) -> CleanResult:
    now = now or datetime.now()
    keep = referenced(db_path)
    result = CleanResult()
    gone: list[str] = []
    day = trash_root(blobs) / now.strftime("%Y%m%d")
    for f in sorted(blobs.root.glob("*/*")) if blobs.root.is_dir() else []:
        sha = f.name.split(".")[0]
        if ".tmp-" in f.name or not SHA_RE.match(sha):
            continue
        if sha in keep:
            result.kept += 1
            continue
        stat = f.stat()
        if now - datetime.fromtimestamp(stat.st_mtime) < GRACE:
            result.young += 1
            continue
        day.mkdir(parents=True, exist_ok=True)
        shutil.move(str(f), day / f.name)
        result.moved += 1
        result.moved_bytes += stat.st_size
        gone.append(sha)
    if gone:
        conn = startup.open_rw(db_path)
        try:
            conn.executemany("DELETE FROM blobs WHERE sha = ?", [(s,) for s in gone])
        finally:
            conn.close()
    result.purged = purge_trash(blobs, now)
    return result


def purge_trash(blobs: BlobStore, now: datetime) -> int:
    """回收区里放了超过 TRASH_DAYS 天的那几天整个删掉,返回删了几个文件"""
    root = trash_root(blobs)
    n = 0
    for d in sorted(root.iterdir()) if root.is_dir() else []:
        try:
            when = datetime.strptime(d.name, "%Y%m%d")
        except ValueError:
            continue
        if d.is_dir() and now - when > timedelta(days=TRASH_DAYS):
            n += sum(1 for _ in d.iterdir())
            shutil.rmtree(d)
    return n


# ── 体检 ──


@dataclass
class CheckResult:
    checked: int = 0
    # 文件不在的(「表名 id」);其中库里还有原件、下次复制会补回的个数
    missing: list[str] = field(default_factory=list)
    restorable: int = 0
    # 文件在、内容和指纹对不上的(只有 deep 才查)
    damaged: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing and not self.damaged


def check(db_path: Path, blobs: BlobStore, deep: bool = False) -> CheckResult:
    """每个被引用的文件都在;deep 再把内容的指纹逐个算一遍"""
    result = CheckResult()
    verified: dict[str, bool] = {}
    conn = startup.open_ro(db_path)
    try:
        for ref in all_refs():
            table = ref.model.__tablename__
            have = columns(conn, table)
            if ref.sha not in have:
                continue
            mime = f'"{ref.mime}"' if ref.mime else "NULL"
            rows = conn.execute(
                f'SELECT id, "{ref.sha}", {mime}, "{ref.data}" IS NOT NULL FROM "{table}" WHERE "{ref.sha}" IS NOT NULL'
            )
            for rid, sha, row_mime, has_data in rows:
                kind = row_mime or ref.fixed_mime
                if not kind:
                    continue
                result.checked += 1
                if sha not in verified:
                    verified[sha] = blobs.verify(sha, kind) if deep else blobs.has(sha, kind)
                if verified[sha]:
                    continue
                if blobs.has(sha, kind):
                    result.damaged.append(f"{ref.name} {rid}")
                else:
                    result.missing.append(f"{ref.name} {rid}")
                    result.restorable += bool(has_data)
    finally:
        conn.close()
    return result


# ── 概况 ──


def _dir_bytes(root: Path) -> int:
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file()) if root.is_dir() else 0


def status(db: Session, db_path: Path | None, blobs: BlobStore) -> dict:
    count, size = db.execute(select(func.count(), func.coalesce(func.sum(Blob.size), 0)).select_from(Blob)).one()
    pending = sum(
        db.scalar(select(func.count()).select_from(r.model).where(r.data_col.is_not(None), r.sha_col.is_(None))) or 0
        for r in all_refs()
    )
    job = db.get(MaintenanceJob, JOB_ID)
    return {
        "enabled": settings.storage_files,
        "files": count,
        "bytes": size,
        "pending": pending,
        "trash_bytes": _dir_bytes(trash_root(blobs)),
        "db_bytes": db_path.stat().st_size if db_path and db_path.exists() else None,
        "copy": None
        if job is None
        else {"state": job.state, "done": job.done, "total": job.total, "message": job.message},
    }


def as_dict(result: CleanResult | CheckResult) -> dict:
    out = asdict(result)
    if isinstance(result, CheckResult):
        out["ok"] = result.ok
    return out
