"""把一个库(或一套 models)的表结构导成 SQL,给迁移器的升级测试当夹具。只导结构,不导数据。

    python dump_schema.py --db <库文件> <输出.sql>
        只读打开一个库
    python dump_schema.py --models <模块,模块> <输出.sql>
        在「当前目录」的代码上 create_all 到临时库再导(公网分支 AnimaVN-play 用这个)
"""

import importlib
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote


def dump(db_path: Path) -> str:
    db = sqlite3.connect(f"file:{quote(db_path.as_posix())}?mode=ro", uri=True)
    rows = db.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
        " ORDER BY type = 'table' DESC, name"
    ).fetchall()
    db.close()
    return "".join(f"{sql};\n\n" for (sql,) in rows)


def from_models(modules: list[str]) -> str:
    sys.path.insert(0, os.getcwd())  # 用当前目录的 app,不是 venv 里装的那份
    for name in modules:
        importlib.import_module(name)
    from sqlalchemy import create_engine

    from app.db import Base

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "schema.db"
        engine = create_engine(f"sqlite:///{path.as_posix()}")
        Base.metadata.create_all(engine)
        engine.dispose()
        return dump(path)


def main(argv: list[str]) -> None:
    mode, source, out = argv
    sql = dump(Path(source)) if mode == "--db" else from_models(source.split(","))
    Path(out).write_text(sql, encoding="utf-8")
    print(f"wrote {out}: {sql.count('CREATE TABLE')} tables")


if __name__ == "__main__":
    main(sys.argv[1:])
