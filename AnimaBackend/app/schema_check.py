"""启动时对一遍库表和 models.py:有没有缺列。

create_all 只建缺的表,不给已有的表加列 —— 新加的列要手动跑 scripts/migrate_*.py。
漏跑了的话,用到那一列的接口一律 500,报错里只有一句 no such column,不好查。
这里只检查、只打日志,不动库;缺了哪一列、该跑哪个脚本都写在日志里。
"""

import logging
import re
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.engine import Engine

log = logging.getLogger(__name__)

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"


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


def _script_for(table: str, column: str) -> str | None:
    """找给这一列加列的迁移脚本(脚本里同时出现表名和 ADD COLUMN 列名)"""
    if not SCRIPTS_DIR.is_dir():
        return None
    pattern = re.compile(rf"ADD COLUMN\s+{re.escape(column)}\b")
    for path in sorted(SCRIPTS_DIR.glob("migrate_*.py")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if table in text and pattern.search(text):
            return path.name
    return None


def warn_missing_columns(engine: Engine, metadata) -> list[tuple[str, str]]:
    try:
        missing = missing_columns(engine, metadata)
    except Exception:  # noqa: BLE001 —— 检查本身出错不能挡住启动
        log.exception("检查库表缺列时出错(已跳过)")
        return []
    for table, column in missing:
        script = _script_for(table, column)
        hint = f"在 AnimaBackend 目录下跑 python scripts/{script}" if script else "没找到对应的迁移脚本"
        log.warning("数据库缺列 %s.%s,用到它的接口会 500 —— %s", table, column, hint)
    return missing
