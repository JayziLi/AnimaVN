"""文件仓库的命令行。在 AnimaBackend 目录下:

    python -m app.storage copy [--db 库]
        把库里的原件复制进仓库(后端启动时也会在后台跑);可以和后端同时开
    python -m app.storage check [--db 库] [--deep]
        体检:每个被引用的文件都在;--deep 再逐个核对内容
    python -m app.storage verify [--db 库]
        逐行核对:从仓库读出来的和库里的原件一个字节都不差(库瘦身前、演练时用;要把整个库读一遍)
    python -m app.storage backup [--db 库]
        在线备份库到 backups/(手动的留最近 5 份)
    python -m app.storage clean [--db 库]
        没人用的文件挪进回收区(现在的库和留着的备份都不要的、放进来超过 24 小时的)
    python -m app.storage slim [--db 库] [--yes]
        库瘦身(第 3 期后半,见 slim.py):核对过的原件从库里置空、语音缓存搬进 tts-cache.db、开 WAL、整理。
        不带 --yes 只演练;后端开着时不做

不给 --db 就用后端配置里的库;仓库在库旁边的 blobs/(设了 BLOB_DIR 就用它)。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.migrations import startup
from app.plugins import load_cartridges
from app.storage import maintenance, slim
from app.storage.blobs import BlobStore, default_root, sha_of
from app.storage.copy import copy_all
from app.storage.refs import all_refs


def verify(factory, blobs: BlobStore) -> tuple[int, list[str]]:
    """有指纹、库里也有原件的每一行:仓库里的文件和库里的原件逐字节比"""
    checked, bad = 0, []
    for ref in all_refs():
        mime_col = getattr(ref.model, ref.mime) if ref.mime else None
        cols = [ref.model.id, ref.sha_col] + ([mime_col] if mime_col is not None else [])
        with factory() as db:
            rows = db.execute(select(*cols).where(ref.sha_col.is_not(None), ref.data_col.is_not(None))).all()
            for row in rows:
                rid, sha = row[0], row[1]
                mime = row[2] if mime_col is not None else ref.fixed_mime
                original = db.scalar(select(ref.data_col).where(ref.model.id == rid))
                checked += 1
                if blobs.read(sha, mime) != original or sha_of(original) != sha:
                    bad.append(f"{ref.name} {rid}")
    return checked, bad


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.storage")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("copy", "check", "verify", "backup", "clean", "slim"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--db", type=Path)
        if name == "check":
            cmd.add_argument("--deep", action="store_true")
        if name == "slim":
            cmd.add_argument("--yes", action="store_true")
    args = parser.parse_args(argv)

    db = args.db or startup.db_path()
    if db is None or not db.exists():
        print(f"找不到库:{db}")
        return 2
    url = f"sqlite:///{db.resolve().as_posix()}"
    blobs = BlobStore(default_root(url))
    load_cartridges()  # 卡带登记它们自己存素材的表

    if args.cmd == "slim":
        r = slim.slim(db, blobs, apply=args.yes)
        print(r.message)
        for line in r.bad[:20]:
            print("  " + line)
        return 0 if r.ok else 1
    if args.cmd == "backup":
        print(f"备份好了:{maintenance.backup_now(db)['name']}")
        return 0
    if args.cmd == "clean":
        r = maintenance.clean(db, blobs)
        print(
            f"留着 {r.kept} 个;挪进回收区 {r.moved} 个({r.moved_bytes / 1e6:.1f} MB);"
            f"没人用但放进来不到 24 小时的 {r.young} 个;回收区删掉 {r.purged} 个"
        )
        return 0
    if args.cmd == "check":
        r = maintenance.check(db, blobs, deep=args.deep)
        print(f"查了 {r.checked} 行:缺文件 {len(r.missing)}(库里还有原件的 {r.restorable}),内容不对 {len(r.damaged)}")
        for line in [*r.missing, *r.damaged][:20]:
            print("  " + line)
        return 0 if r.ok else 1

    engine = create_engine(url, connect_args={"timeout": 30})
    factory = sessionmaker(bind=engine, autoflush=False)
    try:
        if args.cmd == "copy":
            r = copy_all(factory, blobs, on_batch=lambda r: print(f"\r{r.seen}/{r.total}", end="", flush=True))
            print(f"\n{r.summary()};仓库在 {blobs.root}")
            return 0
        checked, bad = verify(factory, blobs)
        print(f"逐字节核对了 {checked} 行:{'全部一致' if not bad else f'{len(bad)} 行不一致'}")
        for line in bad[:20]:
            print("  " + line)
        return 0 if not bad else 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
