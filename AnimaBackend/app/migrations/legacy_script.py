"""scripts/migrate_*.py 留一期(设计 8.2):内容改成调用迁移器,只做那个脚本对应的一步(连同它依赖的步骤)。

和以前一样在 AnimaBackend 目录下跑,改的是 data/animabackend.db;做完记进账本,之后启动时迁移器就知道做过了。
以前有的脚本可以在后面跟一个库文件的路径(比如先拿测试库试一遍),照样认:跟了路径就只改那个库,
不会悄悄改到 data/animabackend.db 上。
"""

import sqlite3
import sys
from pathlib import Path

from app.migrations.base import Step
from app.migrations.registry import STEPS
from app.migrations.runner import apply_pending, plan

DB = Path("data") / "animabackend.db"


def _with_dependencies(step_id: str) -> list[Step]:
    by_id = {s.id: s for s in STEPS}
    need: set[str] = set()
    todo = [step_id]
    while todo:
        sid = todo.pop()
        if sid not in need:
            need.add(sid)
            todo.extend(by_id[sid].depends)
    return [s for s in STEPS if s.id in need]


def run_step(step_id: str) -> None:
    steps = _with_dependencies(step_id)
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else DB
    conn = sqlite3.connect(db, isolation_level=None)
    try:
        pending = {s.id for s in plan(conn, steps).of("pending")}
        report = apply_pending(conn, steps, app_version="script")
    finally:
        conn.close()
    if report.status != "ok":
        print(report.message)
        sys.exit(1)
    if step_id in pending:
        print(f"done: {step_id}")
    else:
        print(f"skipped: {step_id} (already done, or its tables do not exist yet)")
