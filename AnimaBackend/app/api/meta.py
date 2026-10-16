"""给设置页「数据」一栏看的:迁移器这次启动的结果、上次整库备份;文件仓库的概况、手动备份、清理、体检。"""

from datetime import datetime
from pathlib import Path

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.migrations import startup, state
from app.storage import maintenance
from app.storage.blobs import store
from app.version import app_version

router = APIRouter(prefix="/api/meta", tags=["meta"])


def _last_backup(db: Path) -> dict | None:
    """升级前自动备份、设置页手动备份(都在 data/backups/)和手动拷的(animabackend.db.bak*)里最新的那份"""
    folder = startup.backups_dir(db)
    found = [
        *folder.glob(f"{startup.BACKUP_PREFIX}*"),
        *folder.glob(f"{startup.MANUAL_PREFIX}*"),
        *db.parent.glob(f"{db.name}.bak*"),
    ]
    files = [p for p in found if p.is_file()]
    if not files:
        return None
    newest = max(files, key=lambda p: p.stat().st_mtime)
    stat = newest.stat()
    at = datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(timespec="seconds")
    return {"name": newest.name, "at": at, "size": stat.st_size}


@router.get("/migrations")
def migrations():
    report = state.current.report
    steps = report.steps if report else []
    db = startup.db_path()
    return {
        "app_version": app_version(),
        "mode": report.mode if report else "off",
        "status": report.status if report else "skipped",
        "message": report.message if report else "",
        "applied": sum(1 for s in steps if s.state == "applied"),
        "detected": sum(1 for s in steps if s.state == "detected"),
        "pending": [{"id": s.id, "title": s.title} for s in steps if s.state == "pending"],
        "unknown": [{"id": s.id, "title": s.title, "compat": s.compat} for s in steps if s.state == "unknown"],
        "last_backup": _last_backup(db) if db else None,
    }


# ── 文件仓库(app/storage) ──


@router.get("/storage")
def storage(db: Session = Depends(get_db)):
    """仓库里几个文件、多大,还有多少没复制进去,复制任务的进度,回收区多大"""
    return maintenance.status(db, startup.db_path(), store())


def _file_db() -> Path:
    db = startup.db_path()
    if db is None or not db.exists():
        raise HTTPException(400, "后端用的不是 SQLite 文件库,做不了")
    return db


def _exclusive(job: Callable[[], Any]) -> Any:
    """备份、清理、体检同时只跑一个;慢(备份要把整个库拷一遍),FastAPI 放在线程池里跑"""
    if not maintenance.busy.acquire(blocking=False):
        raise HTTPException(409, "备份 / 清理 / 体检正在做,等它做完再点")
    try:
        return job()
    except RuntimeError as exc:  # 磁盘不够、备份读不出来一类:原因直接给用户看
        raise HTTPException(400, str(exc)) from exc
    finally:
        maintenance.busy.release()


@router.post("/backup")
def backup():
    return _exclusive(lambda: maintenance.backup_now(_file_db()))


@router.post("/storage/clean")
def clean_storage():
    return _exclusive(lambda: maintenance.as_dict(maintenance.clean(_file_db(), store())))


@router.post("/storage/check")
def check_storage(deep: bool = False):
    return _exclusive(lambda: maintenance.as_dict(maintenance.check(_file_db(), store(), deep=deep)))
