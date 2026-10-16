"""文件仓库(素材架构设计第 4 节,第 3 期):建 blobs、maintenance_jobs 两张表;立绘、场景素材两张表
各补一个指纹列(可空)和它的索引。只加不改:库里的原件一个字节不动,复制由后台任务做(app/storage/copy.py)。"""

import sqlite3

from app.migrations.base import Step
from app.migrations.sqlite_util import columns, create_model_tables, empty_database, index_exists, table_exists

TABLES = ("blobs", "maintenance_jobs")
# (表, 指纹列);索引名和 models.py 里 index=True 建出来的一样
COLUMNS = (("pack_sprites", "image_sha"), ("scene_assets", "data_sha"))


def missing_columns(conn: sqlite3.Connection, specs=COLUMNS) -> list[tuple[str, str]]:
    out = []
    for table, column in specs:
        have = columns(conn, table)
        if have and column not in have:
            out.append((table, column))
    return out


def missing_indexes(conn: sqlite3.Connection, specs=COLUMNS) -> list[tuple[str, str]]:
    return [
        (table, column)
        for table, column in specs
        if column in columns(conn, table) and not index_exists(conn, table, f"ix_{table}_{column}")
    ]


def add_sha_columns(conn: sqlite3.Connection, specs=COLUMNS) -> None:
    for table, column in missing_columns(conn, specs):
        conn.execute(f'ALTER TABLE "{table}" ADD COLUMN {column} VARCHAR(64)')
    for table, column in missing_indexes(conn, specs):
        conn.execute(f"CREATE INDEX ix_{table}_{column} ON {table} ({column})")


def _done(conn: sqlite3.Connection) -> bool:
    if empty_database(conn):
        return True
    return (
        all(table_exists(conn, t) for t in TABLES)
        and not missing_columns(conn)
        and not missing_indexes(conn)
    )


def _apply(conn: sqlite3.Connection) -> None:
    create_model_tables(conn, TABLES)
    add_sha_columns(conn)


STEP = Step(
    id="core.2026_10_blob_store",
    title="文件仓库:两张新表、立绘和场景素材的指纹列",
    detect=_done,
    apply=_apply,
    verify=_done,
)
