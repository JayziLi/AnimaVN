"""启动时对一遍库表和 models.py:有没有缺列。

create_all 只建缺的表,不给已有的表加列 —— 加列是迁移器的事(app/migrations)。迁移器只报告不升级时
(第 0 期默认)、或者有人加了列却忘了写迁移步骤时,用到那一列的接口一律 500,报错里只有一句
no such column,不好查。这里只检查、只打日志,不动库。
"""

import logging

from sqlalchemy import inspect
from sqlalchemy.engine import Engine

log = logging.getLogger(__name__)

FIX_HINT = "关掉后端,在 AnimaBackend 目录下跑 python -m app.migrations apply(会先备份),再启动"


def missing_columns(engine: Engine, metadata) -> list[tuple[str, str]]:
    """[(表名, 列名)]:表已经在库里,但少了 models.py 里有的列。整张表都没有的不算(create_all 会建)"""
    insp = inspect(engine)
    existing = set(insp.get_table_names())
    missing = []
    for table in metadata.sorted_tables:
        if table.name not in existing:
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        missing += [(table.name, c.name) for c in table.columns if c.name not in have]
    return missing


def warn_missing_columns(engine: Engine, metadata) -> list[tuple[str, str]]:
    try:
        missing = missing_columns(engine, metadata)
    except Exception:  # noqa: BLE001 —— 检查本身出错不能挡住启动
        log.exception("检查库表缺列时出错(已跳过)")
        return []
    for table, column in missing:
        log.warning("数据库缺列 %s.%s,用到它的接口会 500 —— %s", table, column, FIX_HINT)
    return missing
