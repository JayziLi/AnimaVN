"""迁移的核心:哪些步要做(plan)、按顺序做并记账(apply_pending)。

只用标准库 sqlite3。连接要用 isolation_level=None 打开,事务由这里自己发 BEGIN / COMMIT / ROLLBACK:
SQLAlchemy 默认的 pysqlite 用法会让 ALTER TABLE 这类语句自动提交,出错时回滚不掉。
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.migrations.base import Step
from app.migrations.sqlite_util import table_exists

LEDGER = "schema_migrations"

BLOCKED_MESSAGE = (
    "这个数据库被更新版本的 AnimaVN 升级过,这一版程序看不懂它。为了不弄坏数据,先不让改东西。"
    "请换回新版本,或者用升级前的备份恢复。"
)


@dataclass
class StepState:
    id: str
    title: str
    # applied:账本里有;detected:账本里没有,但库已经是做完的样子;pending:要做;
    # unknown:账本里有、这一版代码不认识(别的分支或更新的版本做的)
    state: str
    compat: str = "additive"
    how: str = ""  # 登记方式:detected / applied
    at: str = ""


@dataclass
class MigrationReport:
    mode: str  # report / apply / off
    status: str  # ok / pending / blocked / failed / skipped
    steps: list[StepState] = field(default_factory=list)
    message: str = ""
    backup: str | None = None

    def of(self, state: str) -> list[StepState]:
        return [s for s in self.steps if s.state == state]

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "status": self.status,
            "message": self.message,
            "backup": self.backup,
            "steps": [dict(vars(s)) for s in self.steps],
        }


class StepFailed(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ensure_ledger(conn: sqlite3.Connection) -> None:
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS {LEDGER} ("
        " id TEXT PRIMARY KEY,"
        " title TEXT NOT NULL DEFAULT '',"
        " compat TEXT NOT NULL DEFAULT 'additive',"
        " how TEXT NOT NULL,"
        " app_version TEXT NOT NULL DEFAULT '',"
        " at TEXT NOT NULL)"
    )


def read_ledger(conn: sqlite3.Connection) -> dict[str, dict[str, str]]:
    if not table_exists(conn, LEDGER):
        return {}
    rows = conn.execute(f"SELECT id, title, compat, how, at FROM {LEDGER} ORDER BY at, id").fetchall()
    return {r[0]: {"title": r[1], "compat": r[2], "how": r[3], "at": r[4]} for r in rows}


def plan(
    conn: sqlite3.Connection,
    steps: Sequence[Step],
    *,
    mode: str = "report",
    include_drafts: bool = False,
) -> MigrationReport:
    """只读:按账本和 detect 算出每一步的状态。不写库,可以用只读连接。"""
    done = read_ledger(conn)
    known = {s.id for s in steps}
    states: list[StepState] = []
    pending: set[str] = set()
    for step in steps:
        if step.draft and not include_drafts:
            continue
        rec = done.get(step.id)
        if rec is not None:
            states.append(StepState(step.id, step.title, "applied", step.compat, rec["how"], rec["at"]))
        elif not any(d in pending for d in step.depends) and step.detect(conn):
            states.append(StepState(step.id, step.title, "detected", step.compat))
        else:
            # 它要先做的步骤这次还没做:现在看不出它做没做过(比如要查的表还没建),先算待做,
            # 等前面那步做完、轮到它时再看一眼(apply_pending 里动手前会再 detect 一次)
            states.append(StepState(step.id, step.title, "pending", step.compat))
            pending.add(step.id)
    unknown = [
        StepState(sid, rec["title"], "unknown", rec["compat"], rec["how"], rec["at"])
        for sid, rec in done.items()
        if sid not in known
    ]
    states += unknown
    if any(s.compat == "breaking" for s in unknown):
        return MigrationReport(mode, "blocked", states, BLOCKED_MESSAGE)
    status = "pending" if any(s.state == "pending" for s in states) else "ok"
    return MigrationReport(mode, status, states)


def _record(conn: sqlite3.Connection, step: Step, how: str, app_version: str) -> None:
    conn.execute(
        f"INSERT OR REPLACE INTO {LEDGER} (id, title, compat, how, app_version, at) VALUES (?, ?, ?, ?, ?, ?)",
        (step.id, step.title, step.compat, how, app_version, _now()),
    )


def _failure(step: Step, why: str, backup: str | None) -> str:
    where = f"升级前的整库备份在 {backup}。" if backup else ""
    return (
        f"升级「{step.title}」这一步没成功({why}),这一步已经撤回,前面做完的步骤保留。{where}"
        "为了不弄坏数据,先不让改东西,请把这段话发给开发者。"
    )


def apply_pending(
    conn: sqlite3.Connection,
    steps: Sequence[Step],
    *,
    app_version: str,
    backup: Callable[[], str] | None = None,
    include_drafts: bool = False,
) -> MigrationReport:
    """登记 detect 出来的步骤,再按顺序做待做的。conn 必须用 isolation_level=None 打开。

    backup:有待做的步骤时、动手之前调用一次,返回备份文件路径;它抛错就一步都不做。
    一步一个事务:apply 出错或 verify 不过,这一步回滚,后面的不再做。
    """
    report = plan(conn, steps, mode="apply", include_drafts=include_drafts)
    if report.status == "blocked":
        return report
    pending = report.of("pending")
    # 备份在任何写入之前(连账本表都还没建)
    if pending and backup is not None:
        try:
            report.backup = backup()
        except Exception as exc:  # noqa: BLE001 —— 备份不成功就一步都不做
            report.status = "failed"
            report.message = f"升级前备份没成功({exc}),数据库没动,这次没有升级。"
            return report

    by_id = {s.id: s for s in steps}
    detected = report.of("detected")
    try:
        ensure_ledger(conn)
        finished = set(read_ledger(conn))
        if detected:
            conn.execute("BEGIN IMMEDIATE")
            for st in detected:
                _record(conn, by_id[st.id], "detected", app_version)
            conn.execute("COMMIT")
    except Exception as exc:  # noqa: BLE001 —— 比如别的进程正写着库、库是只读的:一步都没做
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        where = f"升级前的整库备份在 {report.backup}。" if report.backup else ""
        report.status = "failed"
        report.message = f"没能开始升级({exc}),数据库没动。{where}过一会儿重启后端再试。"
        return report
    for st in detected:
        st.state, st.how = "applied", "detected"
        finished.add(st.id)

    for st in pending:
        step = by_id[st.id]
        missing = [d for d in step.depends if d not in finished]
        if missing:
            report.status = "failed"
            report.message = _failure(step, f"它要先做的步骤还没做:{'、'.join(missing)}", report.backup)
            return report
        try:
            conn.execute("BEGIN IMMEDIATE")
            # 拿到写锁以后再看一眼:同一个库上另一个后端进程可能刚做完这一步
            if step.id in read_ledger(conn):
                how = "applied"
            elif step.detect(conn):
                _record(conn, step, "detected", app_version)
                how = "detected"
            else:
                step.apply(conn)
                if not step.verify(conn):
                    raise StepFailed("做完以后检查没通过")
                _record(conn, step, "applied", app_version)
                how = "applied"
            conn.execute("COMMIT")
        except Exception as exc:  # noqa: BLE001 —— 任何错误都整步回滚
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            report.status = "failed"
            report.message = _failure(step, str(exc) or type(exc).__name__, report.backup)
            return report
        st.state, st.how, st.at = "applied", how, _now()
        finished.add(step.id)

    report.status = "ok"
    return report
