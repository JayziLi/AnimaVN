import sqlite3
from dataclasses import replace

from app.migrations.base import Step
from app.migrations.runner import LEDGER, apply_pending, plan
from app.migrations.sqlite_util import add_columns_step, columns, table_exists


def memory_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", isolation_level=None)
    conn.execute("CREATE TABLE pets (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
    conn.execute("INSERT INTO pets VALUES ('p1', '小白')")
    return conn


ADD_AGE = add_columns_step(
    "core.2026_10_pet_age", "宠物加上年龄", [("pets", "age", "INTEGER NOT NULL DEFAULT 0")]
)


def test_plan_lists_pending_steps_without_writing():
    conn = memory_db()
    report = plan(conn, [ADD_AGE])
    assert report.status == "pending"
    assert [(s.id, s.state) for s in report.steps] == [("core.2026_10_pet_age", "pending")]
    assert not table_exists(conn, LEDGER)
    assert "age" not in columns(conn, "pets")


def test_apply_runs_pending_steps_and_records_them_once():
    conn = memory_db()
    first = apply_pending(conn, [ADD_AGE], app_version="1.0")
    assert first.status == "ok"
    assert conn.execute("SELECT id, age FROM pets").fetchall() == [("p1", 0)]
    assert conn.execute(f"SELECT id, how, app_version FROM {LEDGER}").fetchall() == [
        ("core.2026_10_pet_age", "applied", "1.0")
    ]
    second = apply_pending(conn, [ADD_AGE], app_version="1.1")
    assert second.status == "ok"
    assert [s.state for s in second.steps] == ["applied"]
    assert conn.execute(f"SELECT count(*) FROM {LEDGER}").fetchone() == (1,)


def test_a_step_already_done_by_an_old_script_is_registered_without_running():
    conn = memory_db()
    conn.execute("ALTER TABLE pets ADD COLUMN age INTEGER NOT NULL DEFAULT 0")

    def explode(_conn):
        raise AssertionError("不该再做一遍")

    report = apply_pending(conn, [replace(ADD_AGE, apply=explode)], app_version="1.0")
    assert report.status == "ok"
    assert conn.execute(f"SELECT how FROM {LEDGER}").fetchall() == [("detected",)]


def test_a_step_that_fails_its_check_is_rolled_back_and_stops_the_run():
    conn = memory_db()
    bad = Step(
        id="core.2026_10_pet_color",
        title="宠物加上颜色",
        detect=lambda c: "color" in columns(c, "pets"),
        apply=lambda c: c.execute("ALTER TABLE pets ADD COLUMN color TEXT"),
        verify=lambda c: False,
    )
    after = add_columns_step("core.2026_10_pet_size", "宠物加上大小", [("pets", "size", "INTEGER")])
    report = apply_pending(
        conn, [ADD_AGE, bad, after], app_version="1.0", backup=lambda: "data/backups/x"
    )
    assert report.status == "failed"
    assert "宠物加上颜色" in report.message and "data/backups/x" in report.message
    cols = columns(conn, "pets")
    assert "age" in cols  # 前面做完的留着
    assert "color" not in cols  # 这一步撤回了
    assert "size" not in cols  # 后面的没做
    assert [s.state for s in report.steps] == ["applied", "pending", "pending"]


def test_backup_runs_once_and_only_when_something_is_pending():
    calls = []
    conn = memory_db()
    apply_pending(conn, [ADD_AGE], app_version="1.0", backup=lambda: calls.append(1) or "b1")
    apply_pending(conn, [ADD_AGE], app_version="1.0", backup=lambda: calls.append(1) or "b2")
    assert calls == [1]


def test_a_failed_backup_changes_nothing():
    conn = memory_db()

    def no_space():
        raise RuntimeError("磁盘空间不够")

    report = apply_pending(conn, [ADD_AGE], app_version="1.0", backup=no_space)
    assert report.status == "failed"
    assert "磁盘空间不够" in report.message
    assert "age" not in columns(conn, "pets")
    assert not table_exists(conn, LEDGER)  # 备份在任何写入之前,连账本表都还没建


def test_a_step_done_by_someone_else_meanwhile_is_not_redone():
    """另一个后端进程在我们算完计划、拿到写锁之前刚好做完了这一步:只登记,不再做"""
    conn = memory_db()
    looks = {"n": 0}

    def detect(_conn):
        looks["n"] += 1
        return looks["n"] > 1  # 算计划时还没做;拿到写锁以后再看,已经做好了

    def explode(_conn):
        raise AssertionError("不该再做一遍")

    step = Step(
        id="core.2026_10_pet_tag", title="宠物加上名牌", detect=detect, apply=explode, verify=lambda c: True
    )
    report = apply_pending(conn, [step], app_version="1.0")
    assert report.status == "ok"
    assert conn.execute(f"SELECT how FROM {LEDGER}").fetchall() == [("detected",)]


def test_an_unknown_breaking_step_from_a_newer_version_blocks_everything():
    conn = memory_db()
    apply_pending(conn, [ADD_AGE], app_version="2.0")
    conn.execute(
        f"INSERT INTO {LEDGER} (id, title, compat, how, app_version, at) VALUES "
        "('core.2027_01_rewrite', '大改', 'breaking', 'applied', '3.0', '2027-01-01T00:00:00+00:00')"
    )
    report = plan(conn, [ADD_AGE])
    assert report.status == "blocked"
    assert "更新版本" in report.message
    assert apply_pending(conn, [ADD_AGE], app_version="2.0").status == "blocked"


def test_an_unknown_additive_step_is_harmless():
    conn = memory_db()
    apply_pending(conn, [ADD_AGE], app_version="2.0")
    conn.execute(
        f"INSERT INTO {LEDGER} (id, title, compat, how, app_version, at) VALUES "
        "('play.2026_09_chat_owner', '对话记主人', 'additive', 'applied', 'play', '2026-09-30T00:00:00+00:00')"
    )
    report = plan(conn, [ADD_AGE])
    assert report.status == "ok"
    assert (report.steps[-1].id, report.steps[-1].state) == ("play.2026_09_chat_owner", "unknown")


def test_draft_steps_only_run_when_asked():
    conn = memory_db()
    draft = replace(
        add_columns_step("core.2026_11_pet_mood", "宠物加上心情", [("pets", "mood", "TEXT")]),
        draft=True,
    )
    assert plan(conn, [draft]).steps == []
    apply_pending(conn, [draft], app_version="1.0")
    assert "mood" not in columns(conn, "pets")
    apply_pending(conn, [draft], app_version="1.0", include_drafts=True)
    assert "mood" in columns(conn, "pets")


def test_a_step_whose_dependency_did_not_run_is_not_attempted():
    conn = memory_db()
    late = replace(ADD_AGE, id="core.2026_10_late", depends=("core.2026_10_missing",))
    report = apply_pending(conn, [late], app_version="1.0")
    assert report.status == "failed"
    assert "core.2026_10_missing" in report.message
    assert "age" not in columns(conn, "pets")


def test_add_columns_step_skips_tables_that_do_not_exist_yet():
    conn = sqlite3.connect(":memory:", isolation_level=None)
    report = apply_pending(conn, [ADD_AGE], app_version="1.0")
    assert report.status == "ok"
    assert [s.how for s in report.steps] == ["detected"]
    assert not table_exists(conn, "pets")


def test_a_database_locked_by_another_process_gives_a_failed_report(tmp_path):
    path = tmp_path / "a.db"
    setup = sqlite3.connect(path)
    setup.execute("CREATE TABLE pets (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
    setup.commit()
    setup.close()
    holder = sqlite3.connect(path, isolation_level=None)
    holder.execute("BEGIN IMMEDIATE")  # 另一个后端进程正写着库
    try:
        conn = sqlite3.connect(path, isolation_level=None, timeout=0.1)
        report = apply_pending(conn, [ADD_AGE], app_version="1.0")
        assert report.status == "failed"
        assert "没能开始升级" in report.message and "locked" in report.message
        assert not conn.in_transaction
        conn.close()
    finally:
        holder.execute("ROLLBACK")
        holder.close()
    check = sqlite3.connect(path)
    assert "age" not in columns(check, "pets")
    assert not table_exists(check, LEDGER)
    check.close()


def test_a_step_behind_a_pending_dependency_is_checked_after_it_runs():
    """第 4 期踩到的:后一步看「要查的表还不在」就当做完了,其实那张表是前一步这次才建的"""
    conn = memory_db()
    make_toys = Step(
        id="core.2026_10_toys",
        title="建玩具表、放一个玩具",
        detect=lambda c: table_exists(c, "toys"),
        apply=lambda c: (c.execute("CREATE TABLE toys (id TEXT)"), c.execute("INSERT INTO toys VALUES ('ball')")),
        verify=lambda c: table_exists(c, "toys"),
    )
    drop_ball = Step(
        id="private.2026_10_no_ball",
        title="拿掉球",
        # 表不在 = 没东西可拿
        detect=lambda c: not table_exists(c, "toys") or c.execute("SELECT 1 FROM toys WHERE id = 'ball'").fetchone() is None,
        apply=lambda c: c.execute("DELETE FROM toys WHERE id = 'ball'"),
        verify=lambda c: c.execute("SELECT 1 FROM toys WHERE id = 'ball'").fetchone() is None,
        depends=("core.2026_10_toys",),
    )
    assert [s.state for s in plan(conn, [make_toys, drop_ball]).steps] == ["pending", "pending"]
    report = apply_pending(conn, [make_toys, drop_ball], app_version="1.0")
    assert report.status == "ok"
    assert conn.execute("SELECT count(*) FROM toys").fetchone()[0] == 0
    assert dict(conn.execute(f"SELECT id, how FROM {LEDGER}").fetchall()) == {
        "core.2026_10_toys": "applied",
        "private.2026_10_no_ball": "applied",
    }
