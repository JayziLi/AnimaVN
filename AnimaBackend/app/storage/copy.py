"""把库里的原件复制进文件仓库(第 3 期前半)。

启动时在后台跑一遍(storage_files 开着时),也能用命令行跑:python -m app.storage copy [--db 库]。
按表、按 id 分批,每批一个短事务:
- 还没指纹的:放进仓库、记上指纹
- 有指纹但文件不在(被误删、换电脑只拷了库)的:从库里那份重写
- 指纹和库里的原件对不上的(原件被别的办法改过):按原件重新记
库里的原件一个字节不动,写的只有指纹列、blobs 表和进度。指纹列用 Core update 写,不碰 updated_at ——
图片地址里的版本号跟着它,变了浏览器就要把整套图重新下载一遍。
中途新上传的素材:上传接口自己会放文件、记指纹;漏掉的(比如直接写库的脚本)下次启动补上。
进度写进 maintenance_jobs(id = blob-copy),设置 → 数据里看得到。
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import Blob, MaintenanceJob
from app.storage.blobs import BlobStore, store
from app.storage.refs import BlobRef, all_refs, has_content

log = logging.getLogger(__name__)

JOB_ID = "blob-copy"
BATCH = 32


@dataclass
class CopyResult:
    total: int = 0
    seen: int = 0
    # 这次新记上指纹的
    copied: int = 0
    # 文件不在、从库里重写的
    rewritten: int = 0
    # 指纹和原件对不上、按原件重新记的
    fixed: int = 0
    # 有指纹、文件不在、库里也没有原件:只能从备份找回(库瘦身以后才可能)
    lost: int = 0

    def summary(self) -> str:
        parts = [f"共 {self.total} 个"]
        for n, word in ((self.copied, "新复制"), (self.rewritten, "补回文件"), (self.fixed, "重记指纹"), (self.lost, "找不到原件")):
            if n:
                parts.append(f"{word} {n}")
        return ",".join(parts)


def count_rows(db: Session) -> int:
    """要管的行数:有原件或者有指纹的"""
    return sum(db.scalar(select(func.count()).select_from(ref.model).where(has_content(ref))) or 0 for ref in all_refs())


def _keep_version(ref: BlobRef) -> dict:
    """update 时把 updated_at 原样写回(onupdate 不生效):图没变,地址里的版本号不能变"""
    return {"updated_at": ref.model.updated_at} if hasattr(ref.model, "updated_at") else {}


def _progress(db: Session, result: CopyResult, state: str, message: str = "") -> None:
    job = db.get(MaintenanceJob, JOB_ID)
    if job is None:
        job = MaintenanceJob(id=JOB_ID)
        db.add(job)
    job.state, job.done, job.total, job.message = state, result.seen, result.total, message


def _copy_batch(ref: BlobRef, db: Session, blobs: BlobStore, after: str, batch: int, result: CopyResult) -> str | None:
    """id 大于 after 的下一批;返回这批最后一个 id,没有了是 None"""
    model = ref.model
    mime_col = getattr(model, ref.mime) if ref.mime else None
    cols = [model.id, ref.sha_col] + ([mime_col] if mime_col is not None else [])
    rows = db.execute(
        select(*cols).where(model.id > after, has_content(ref)).order_by(model.id).limit(batch)
    ).all()
    if not rows:
        return None
    known = set(db.scalars(select(Blob.sha).where(Blob.sha.in_([r[1] for r in rows if r[1]]))).all())
    for row in rows:
        rid, sha = row[0], row[1]
        mime = row[2] if mime_col is not None else ref.fixed_mime
        result.seen += 1
        if not mime:
            continue
        if sha and blobs.has(sha, mime):
            if sha not in known:  # 文件在、表里没记(复制到一半停了):补一行
                db.add(Blob(sha=sha, mime=mime, size=blobs.path(sha, mime).stat().st_size))
                known.add(sha)
            continue
        data = db.scalar(select(ref.data_col).where(model.id == rid))
        if data is None:
            result.lost += 1
            log.warning("文件仓库:%s %s 的文件不在,库里也没有原件(指纹 %s)", ref.name, rid, sha)
            continue
        new = blobs.put(data, mime, db)
        known.add(new)
        if new == sha:
            result.rewritten += 1
            continue
        # 只在指纹还是读到的那个值时写:这期间上传接口换了图、记了新指纹,就不覆盖它
        same = ref.sha_col.is_(None) if sha is None else ref.sha_col == sha
        db.execute(
            update(model)
            .where(model.id == rid, same)
            .values({ref.sha: new, **_keep_version(ref)})
            .execution_options(synchronize_session=False)
        )
        if sha is None:
            result.copied += 1
        else:
            result.fixed += 1
            log.warning("文件仓库:%s %s 的指纹和原件对不上,已按原件重记", ref.name, rid)
    return rows[-1][0]


def copy_all(
    session_factory: Callable[[], Session],
    blobs: BlobStore | None = None,
    batch: int = BATCH,
    on_batch: Callable[[CopyResult], None] | None = None,
) -> CopyResult:
    blobs = blobs or store()
    blobs.clear_temp()
    result = CopyResult()
    with session_factory() as db:
        result.total = count_rows(db)
        _progress(db, result, "running")
        db.commit()
    try:
        for ref in all_refs():
            after = ""
            while after is not None:
                with session_factory() as db:
                    after = _copy_batch(ref, db, blobs, after, batch, result)
                    _progress(db, result, "running")
                    db.commit()
                if on_batch is not None:
                    on_batch(result)
    except Exception as exc:
        with session_factory() as db:
            _progress(db, result, "failed", f"复制到一半出错:{exc}")
            db.commit()
        raise
    with session_factory() as db:
        _progress(db, result, "done", result.summary())
        db.commit()
    return result


def start_background(session_factory: Callable[[], Session]) -> threading.Thread:
    """启动时在后台跑一遍;出错只记日志(下次启动接着补),不影响正常请求 —— 读的时候文件不在就读库"""

    def run() -> None:
        try:
            result = copy_all(session_factory)
            if result.copied or result.rewritten or result.fixed or result.lost:
                log.info("文件仓库复制完成:%s", result.summary())
        except Exception:  # noqa: BLE001
            log.exception("文件仓库复制中断(下次启动接着补)")

    thread = threading.Thread(target=run, name="blob-copy", daemon=True)
    thread.start()
    return thread
