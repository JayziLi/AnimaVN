"""迁移步骤常用的几样查询,和「给已有的表补列」「只建新表」这两种最常见的步骤。"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence

from app.migrations.base import Step


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    return row is not None


def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    """表里有哪些列;表不存在时是空集合"""
    return {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}


def index_exists(conn: sqlite3.Connection, table: str, index: str) -> bool:
    return any(row[1] == index for row in conn.execute(f'PRAGMA index_list("{table}")'))


def create_model_tables(conn: sqlite3.Connection, names: Sequence[str]) -> None:
    """照 models.py 建表和它的索引(和后端启动时的 create_all 一样);已经有的表不动"""
    from sqlalchemy.dialects import sqlite as sqlite_dialect
    from sqlalchemy.schema import CreateIndex, CreateTable

    import app.models  # noqa: F401  (把表登记到 Base 上)
    from app.db import Base

    dialect = sqlite_dialect.dialect()
    for name in names:
        if table_exists(conn, name):
            continue
        table = Base.metadata.tables[name]
        conn.execute(str(CreateTable(table).compile(dialect=dialect)))
        for index in table.indexes:
            conn.execute(str(CreateIndex(index).compile(dialect=dialect)))


def add_columns_step(
    step_id: str,
    title: str,
    adds: Sequence[tuple[str, str, str]],
    *,
    depends: Sequence[str] = (),
) -> Step:
    """给已有的表补列。adds 是 (表, 列, 列定义) 的列表。
    表还不存在的跳过:新库由 create_all 建出完整的表,用不着补。"""

    def missing(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
        out = []
        for table, column, ddl in adds:
            have = columns(conn, table)
            if have and column not in have:
                out.append((table, column, ddl))
        return out

    def apply(conn: sqlite3.Connection) -> None:
        for table, column, ddl in missing(conn):
            conn.execute(f'ALTER TABLE "{table}" ADD COLUMN {column} {ddl}')

    def done(conn: sqlite3.Connection) -> bool:
        return not missing(conn)

    return Step(id=step_id, title=title, detect=done, apply=apply, verify=done, depends=tuple(depends))


def empty_database(conn: sqlite3.Connection) -> bool:
    """一张表都没有的新库(迁移账本不算)"""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' LIMIT 1"
    ).fetchone()
    return row is None


def create_tables_step(
    step_id: str,
    title: str,
    tables: Sequence[str],
    *,
    depends: Sequence[str] = (),
) -> Step:
    """只建新表(照 models.py,和 create_all 建出来的一样)。
    一张表都没有的新库:和别的步骤一样只登记,表留给后端启动时的 create_all 建。"""

    def done(conn: sqlite3.Connection) -> bool:
        return empty_database(conn) or all(table_exists(conn, t) for t in tables)

    def apply(conn: sqlite3.Connection) -> None:
        create_model_tables(conn, tables)

    return Step(id=step_id, title=title, detect=done, apply=apply, verify=done, depends=tuple(depends))
