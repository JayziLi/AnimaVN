"""迁移器的命令行。在 AnimaBackend 目录下:

    python -m app.migrations report [--db 库]
        只读:列出每一步的状态
    python -m app.migrations apply [--db 库]
        先备份到库旁边的 backups/,再升级。后端开着时别用:先关掉 8000
    python -m app.migrations rehearse --db 副本 [--drafts]
        在库副本上演练升级(不备份);不许指向正在用的库。--drafts 连还在开发的草稿步骤一起跑

不给 --db 就用后端配置里的库(settings.database_url)。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.migrations import startup
from app.migrations.registry import STEPS
from app.migrations.runner import MigrationReport, apply_pending, plan
from app.version import app_version

STATE_NAMES = {
    "applied": "已做",
    "detected": "已经是做完的样子",
    "pending": "待做",
    "unknown": "这一版不认识",
}


def show(report: MigrationReport) -> str:
    lines = [f"模式 {report.mode} · 结果 {report.status}"]
    if report.message:
        lines.append(report.message)
    if report.backup:
        lines.append(f"升级前的备份:{report.backup}")
    for s in report.steps:
        lines.append(f"  [{STATE_NAMES.get(s.state, s.state)}] {s.id}  {s.title}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.migrations")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("report").add_argument("--db", type=Path)
    sub.add_parser("apply").add_argument("--db", type=Path)
    rehearse = sub.add_parser("rehearse")
    rehearse.add_argument("--db", type=Path, required=True)
    rehearse.add_argument("--drafts", action="store_true")
    args = parser.parse_args(argv)

    live = startup.db_path()
    db = args.db or live
    if db is None or not db.exists():
        print(f"找不到库:{db}")
        return 2
    if args.cmd == "rehearse" and live is not None and db.resolve() == live.resolve():
        print("rehearse 只在库副本上跑,不能指向正在用的库。先复制一份再演练")
        return 2

    if args.cmd == "report":
        conn = startup.open_ro(db)
        try:
            report = plan(conn, STEPS)
        finally:
            conn.close()
        print(show(report))
        return 1 if report.status == "blocked" else 0

    conn = startup.open_rw(db)
    try:
        report = apply_pending(
            conn,
            STEPS,
            app_version=app_version(),
            backup=(lambda: startup.backup(db)) if args.cmd == "apply" else None,
            include_drafts=getattr(args, "drafts", False),
        )
    finally:
        conn.close()
    print(show(report))
    return 0 if report.status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
