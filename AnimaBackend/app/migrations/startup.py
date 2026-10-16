"""后端启动时跑迁移器(main.py 的 lifespan 调用)。

- off:什么都不做
- report:只读打开库,算出每一步的状态,写进日志和 /api/meta/migrations;一个字节都不写
- apply(第 3 期起默认):有待做的步骤时先查磁盘空间、在线备份到 data/backups/(只留最近 3 份),再一步一个事务地升级

uvicorn 在 lifespan 跑完以前不接请求,所以升级期间后端连不上,写入天然挡住;升级期间库旁边放一个
.migrating 文件,start.bat 看到它就接着等,不按 90 秒超时。升级失败、或者库被更新的版本升级过时,
结果记进 state,guard 中间件按它挡住接口。
"""

from __future__ import annotations

import logging
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from sqlalchemy.engine import make_url

from app.config import settings
from app.migrations import state
from app.migrations.registry import STEPS
from app.migrations.runner import MigrationReport, apply_pending, plan

log = logging.getLogger(__name__)

KEEP_BACKUPS = 3
BACKUP_PREFIX = "animabackend.db.pre-migrate-"
# 设置 → 数据里手动点的备份(app/storage/backup.py)
MANUAL_PREFIX = "animabackend.db.manual-"
SPARE_BYTES = 512 * 1024 * 1024  # 备份以外再留 0.5 GB,别把盘写满


def db_path(url: str | None = None) -> Path | None:
    """SQLite 文件库的路径;内存库、别的数据库是 None"""
    u = make_url(url or settings.database_url)
    if u.get_backend_name() != "sqlite" or not u.database or u.database == ":memory:":
        return None
    return Path(u.database)


def flag_path(db: Path) -> Path:
    return db.with_name(db.name + ".migrating")


def backups_dir(db: Path) -> Path:
    return db.parent / "backups"


def open_ro(db: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{quote(db.as_posix())}?mode=ro", uri=True)


def open_rw(db: Path) -> sqlite3.Connection:
    """事务由 runner 自己发 BEGIN / COMMIT;别的进程正写着时最多等 30 秒"""
    return sqlite3.connect(db, isolation_level=None, timeout=30)


def backup(db: Path, now: datetime | None = None, prefix: str = BACKUP_PREFIX, keep: int = KEEP_BACKUPS) -> str:
    """在线备份(后端开着也安全)到 data/backups/,同一种(prefix)只留最近 keep 份。返回备份文件路径"""
    folder = backups_dir(db)
    folder.mkdir(parents=True, exist_ok=True)
    size = db.stat().st_size
    free = shutil.disk_usage(folder).free
    if free < size + SPARE_BYTES:
        raise RuntimeError(
            f"磁盘空间不够:备份要 {size / 1e9:.2f} GB,另外留出 0.5 GB,现在只剩 {free / 1e9:.2f} GB"
        )
    stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    target = folder / f"{prefix}{stamp}"
    src = open_ro(db)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst, pages=4096)
    finally:
        dst.close()
        src.close()
    for old in sorted(folder.glob(f"{prefix}*"))[:-keep]:
        old.unlink()
    return str(target)


def run(app_version: str, mode: str | None = None, url: str | None = None) -> MigrationReport:
    """按模式跑一次迁移器,结果记进 state 并返回。出了意外也不抛,写进报告"""
    mode = mode or settings.migrations_mode
    if mode == "off":
        report = MigrationReport("off", "skipped", message="迁移器关着(migrations_mode=off)")
        state.set_report(report)
        return report
    db = db_path(url)
    if db is None:
        report = MigrationReport(mode, "skipped", message="不是 SQLite 文件库,迁移器跳过")
    elif not db.exists():
        # 全新安装:库文件还没有,create_all 会建出完整的表,没有要升级的
        report = MigrationReport(mode, "ok", message="新库,不用升级")
    elif mode == "report":
        report = _report(db)
    else:
        report = _apply(db, app_version)
    state.set_report(report)
    _log(report)
    return report


def _report(db: Path) -> MigrationReport:
    try:
        conn = open_ro(db)
        try:
            return plan(conn, STEPS, mode="report")
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 —— 只报告的模式,检查出错不能挡住启动
        log.exception("迁移器检查数据库时出错(已跳过)")
        return MigrationReport("report", "skipped", message=f"检查数据库时出错,已跳过:{exc}")


def _apply(db: Path, app_version: str) -> MigrationReport:
    flag = flag_path(db)
    try:
        # 写在 try 里:data 文件夹写不进去时也是「失败」报告,不让启动直接报错
        flag.write_text(datetime.now().isoformat(timespec="seconds"), encoding="utf-8")
        conn = open_rw(db)
        try:
            return apply_pending(conn, STEPS, app_version=app_version, backup=lambda: backup(db))
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 —— 比如打不开库:当作失败,接口全挡
        log.exception("迁移器升级数据库时出错")
        return MigrationReport(
            "apply", "failed", message=f"升级数据库时出错({exc}),为了不弄坏数据,先不让改东西。"
        )
    finally:
        flag.unlink(missing_ok=True)


def _log(report: MigrationReport) -> None:
    pending = report.of("pending")
    if report.status in ("failed", "blocked"):
        log.error("数据库迁移:%s", report.message)
    elif report.mode == "report" and pending:
        log.warning(
            "数据库有 %d 步待升级(现在只检查,不会自动改;设 MIGRATIONS_MODE=apply 才升级):%s",
            len(pending),
            "、".join(s.title for s in pending),
        )
    else:
        log.info("数据库迁移:%s(%s)", report.status, report.message or "没有要做的")
