"""库瘦身(素材架构设计 4.5 第二步,第 3 期后半):python -m app.storage slim [--db 库] [--yes]。

不带 --yes 只演练:查空间、核对、报告会做什么,一个字节都不写。带 --yes 依次:
1. 后端开着(库旁边有 .migrating、或者 8000 能连上)就不做;
2. 查空间:要放下一份备份,再加整理(VACUUM)时的临时文件,另留 0.5 GB;
3. 在线备份到 backups/animabackend.db.pre-slim-<时间>(留最近 2 份)—— 瘦身以后原件只能从这里找回;
4. 逐行核对:库里还存着原件的每一行,都要有指纹、仓库里的文件在、文件内容和原件一字不差;有一行不对就整个不做;
5. 置空库里的原件(只动原件那一列,updated_at 不变);
6. 语音缓存原样搬进库旁边的 tts-cache.db(app/tts/cache_file.py;键不变),主库里的清空;
7. 开 WAL(以后备份一律用在线备份:设置 → 数据 → 现在备份,或 python -m app.storage backup);
8. VACUUM,最后体检一遍。
"""

from __future__ import annotations

import shutil
import socket
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app.migrations import startup
from app.migrations.sqlite_util import columns, table_exists
from app.storage import maintenance
from app.storage.blobs import BlobStore, sha_of
from app.storage.refs import all_refs
from app.tts import cache_file

PREFIX = "animabackend.db.pre-slim-"
KEEP = 2
SPARE = 512 * 1024 * 1024


@dataclass
class SlimReport:
    ok: bool = False
    message: str = ""
    before: int = 0
    after: int = 0
    rows: int = 0
    nulled: int = 0
    cache_rows: int = 0
    backup: str | None = None
    bad: list[str] = field(default_factory=list)


def backend_running(port: int = 8000) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def _refs(conn: sqlite3.Connection):
    """(名字, 表, 原件列, 指纹列, 类型列或固定类型);库里没有的表跳过"""
    for ref in all_refs():
        table = ref.model.__tablename__
        cols = columns(conn, table)
        if ref.data in cols and ref.sha in cols:
            yield ref.name, table, ref.data, ref.sha, (ref.mime, None) if ref.mime else (None, ref.fixed_mime)


def _check_rows(conn: sqlite3.Connection, blobs: BlobStore, report: SlimReport) -> None:
    """库里还存着原件的每一行:指纹在、文件在、内容一字不差"""
    for name, table, data, sha, (mime_col, fixed) in _refs(conn):
        mime_sql = f'"{mime_col}"' if mime_col else "NULL"
        ids = conn.execute(f'SELECT id, "{sha}", {mime_sql} FROM "{table}" WHERE "{data}" IS NOT NULL').fetchall()
        for rid, digest, mime in ids:
            report.rows += 1
            kind = mime or fixed
            original = conn.execute(f'SELECT "{data}" FROM "{table}" WHERE id = ?', (rid,)).fetchone()[0]
            if not digest or not kind:
                report.bad.append(f"{name} {rid}:还没有指纹(先跑 python -m app.storage copy)")
            elif sha_of(original) != digest:
                report.bad.append(f"{name} {rid}:指纹和原件对不上")
            elif blobs.read(digest, kind) != original:
                report.bad.append(f"{name} {rid}:仓库里的文件不在或内容不对")


def _null(conn: sqlite3.Connection) -> int:
    n = 0
    for _, table, data, sha, _ in _refs(conn):
        cur = conn.execute(f'UPDATE "{table}" SET "{data}" = NULL WHERE "{data}" IS NOT NULL AND "{sha}" IS NOT NULL')
        n += cur.rowcount
    return n


def _move_cache(conn: sqlite3.Connection, db: Path) -> int:
    """主库里的语音缓存原样搬进 tts-cache.db;返回搬了几条"""
    if not table_exists(conn, "tts_cache"):
        return 0
    target = cache_file.cache_path(f"sqlite:///{db.as_posix()}")
    if target is None:
        return 0
    cache_file.make_engine(target).dispose()  # 建表和索引,和模型一样
    cols = ", ".join(f'"{c}"' for c in columns(conn, "tts_cache"))
    conn.execute("ATTACH DATABASE ? AS tc", (str(target),))
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(f"INSERT OR REPLACE INTO tc.tts_cache ({cols}) SELECT {cols} FROM main.tts_cache")
        moved = conn.execute("SELECT count(*) FROM main.tts_cache").fetchone()[0]
        there = conn.execute(
            "SELECT count(*) FROM tc.tts_cache WHERE key IN (SELECT key FROM main.tts_cache)"
        ).fetchone()[0]
        if there != moved:
            raise RuntimeError(f"语音缓存没搬全:主库 {moved} 条,新文件里对上 {there} 条")
        conn.execute("DELETE FROM main.tts_cache")
        conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.execute("DETACH DATABASE tc")
    return moved


def slim(db: Path, blobs: BlobStore, *, apply: bool, log: Callable[[str], None] = print) -> SlimReport:
    report = SlimReport(before=db.stat().st_size)
    if startup.flag_path(db).exists() or (apply and backend_running()):
        report.message = "后端开着(或者正在升级):先关掉 8000 再瘦身"
        return report
    need = 2 * report.before + SPARE
    free = shutil.disk_usage(db.parent).free
    if free < need:
        report.message = f"磁盘空间不够:要 {need / 1e9:.1f} GB(备份 + 整理时的临时文件 + 0.5 GB),只剩 {free / 1e9:.1f} GB"
        return report

    conn = sqlite3.connect(db, isolation_level=None, timeout=30)
    try:
        log("逐行核对库里的原件和仓库里的文件……")
        _check_rows(conn, blobs, report)
        if report.bad:
            report.message = f"有 {len(report.bad)} 行对不上,一行都没动"
            return report
        cache_rows = conn.execute("SELECT count(*) FROM tts_cache").fetchone()[0] if table_exists(conn, "tts_cache") else 0
        if not apply:
            report.ok = True
            report.cache_rows = cache_rows
            report.message = f"演练:{report.rows} 行原件可以置空,{cache_rows} 条语音缓存要搬;加 --yes 才真做"
            return report
        report.backup = startup.backup(db, prefix=PREFIX, keep=KEEP)
        log(f"备份好了:{report.backup}")
        conn.execute("BEGIN IMMEDIATE")
        report.nulled = _null(conn)
        conn.execute("COMMIT")
        log(f"置空了 {report.nulled} 行原件")
        report.cache_rows = _move_cache(conn, db)
        log(f"语音缓存搬了 {report.cache_rows} 条")
        conn.execute("PRAGMA journal_mode=WAL")
        log("整理(VACUUM)……")
        conn.execute("VACUUM")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()
    check = maintenance.check(db, blobs, deep=True)
    report.after = db.stat().st_size
    report.ok = check.ok
    report.message = (
        f"库从 {report.before / 1e9:.2f} GB 缩到 {report.after / 1e9:.2f} GB;体检 {'通过' if check.ok else '没过'}"
        f"(查了 {check.checked} 行,缺 {len(check.missing)},坏 {len(check.damaged)})"
    )
    return report
