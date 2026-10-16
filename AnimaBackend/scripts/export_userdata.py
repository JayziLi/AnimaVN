"""Export the dev DB as plain files, so characters, chats and assets can live in git.

    python scripts/export_userdata.py [db] [out]     (defaults: data/animabackend.db ../userdata)

Layout of the output:
  schema.sql                  CREATE statements, straight from sqlite_master
  tables/<table>.jsonl        one row per line, ordered by primary key
  tables/<table>/<key>.jsonl  big tables, split by a column (one file per chat)
  blobs/ab/abcd….png          every BLOB value, named by its sha256; rows point at
                              it with {"$blob": "ab/abcd….png"}

Same content → same file name, so an unchanged sprite never becomes a new git
object and a new message only touches its own chat's file. The TTS cache is left
out (it is rebuilt on demand) and API keys are blanked. Restore with
import_userdata.py.

Since the asset-architecture phase 3 the originals also live in the file store
(data/blobs/ab/<sha256>.<ext>, or BLOB_DIR) and rows keep the fingerprint in a
*_sha column; after the database is slimmed the BLOB column is empty. Every file
a *_sha column points at is copied into blobs/ with the store's own name (same
layout), so the snapshot stays complete either way.
"""

import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote

SKIP_ROWS = {"tts_cache"}  # 表结构照导，行不导
BLANK = {("api_connections", "api_key")}  # 密钥不进仓库，恢复后在「连接」里重填
# app_settings 里 key 以 secret. 开头的是密钥（Jev 的 API key 存成 secret.jev_key），整行不导，恢复后重填
SECRET_SETTING_PREFIX = "secret."
# 单个文件别过 GitHub 的 50 MB 警告线：对话按会话拆，提示词快照一条一个文件
SPLIT = {"debug_chat_messages": "chat_id", "debug_snapshots": "hash"}
EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
    "audio/mp4": ".m4a",
}


SHA = re.compile(r"^[0-9a-f]{64}$")


def store_root(db_path: Path) -> Path:
    """文件仓库:设了 BLOB_DIR 就是它,不设是库旁边的 blobs/(和后端 app/storage/blobs.py 一样)"""
    return Path(os.environ["BLOB_DIR"]) if os.environ.get("BLOB_DIR") else db_path.parent / "blobs"


def copy_store_file(store: Path, out: Path, sha: str) -> str | None:
    """仓库里这个指纹的文件拷进 blobs/(名字不变);仓库里没有返回 None"""
    for f in sorted((store / sha[:2]).glob(f"{sha}.*")):
        if ".tmp-" in f.name:
            continue
        target = out / "blobs" / sha[:2] / f.name
        if not target.exists():
            target.parent.mkdir(exist_ok=True)
            shutil.copyfile(f, target)
        return f"{sha[:2]}/{f.name}"
    return None


def export(db_path: Path, out: Path) -> None:
    db = sqlite3.connect(f"file:{quote(db_path.as_posix())}?mode=ro", uri=True)
    db.execute("BEGIN")  # 一个读事务里导完，后端在写也拿到同一个时间点
    (out / "blobs").mkdir(parents=True, exist_ok=True)
    tables_dir = out / "tables"
    shutil.rmtree(tables_dir, ignore_errors=True)  # 每次重写，删掉的会话不留旧文件
    tables_dir.mkdir()

    schema = db.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
        " ORDER BY type = 'table' DESC, name"
    ).fetchall()
    (out / "schema.sql").write_text("".join(f"{sql};\n\n" for (sql,) in schema), encoding="utf-8")

    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]
    blobs: set[str] = set()
    store = store_root(db_path)
    missing = 0
    for table in tables:
        if table in SKIP_ROWS:
            continue
        info = db.execute(f'PRAGMA table_info("{table}")').fetchall()
        cols = [c[1] for c in info]
        pk = [c[1] for c in sorted(info, key=lambda c: c[5]) if c[5]] or ["rowid"]
        order = ", ".join(f'"{c}"' for c in pk)
        files: dict[Path, list[str]] = {}
        for values in db.execute(f'SELECT * FROM "{table}" ORDER BY {order}'):
            row = dict(zip(cols, values))
            if table == "app_settings" and str(row.get("key", "")).startswith(SECRET_SETTING_PREFIX):
                continue
            for col in cols:
                if (table, col) in BLANK and row[col]:
                    row[col] = ""
                elif isinstance(row[col], bytes):
                    row[col] = {"$blob": save_blob(out, row[col], row.get("mime"))}
                    blobs.add(row[col]["$blob"])
                elif col.endswith("_sha") and isinstance(row[col], str) and SHA.match(row[col]):
                    rel = copy_store_file(store, out, row[col])
                    if rel is None:
                        missing += 1
                    else:
                        blobs.add(rel)
            path = tables_dir / f"{table}.jsonl"
            if table in SPLIT:
                key = re.sub(r"[^\w-]", "_", str(row[SPLIT[table]]))
                path = tables_dir / table / f"{key}.jsonl"
            files.setdefault(path, []).append(json.dumps(row, ensure_ascii=False) + "\n")
        for path, lines in files.items():
            path.parent.mkdir(exist_ok=True)
            path.write_text("".join(lines), encoding="utf-8", newline="\n")
        print(f"{table}: {sum(map(len, files.values()))} rows")

    # 删掉已经没人引用的旧素材（git 历史里还在）
    for f in (out / "blobs").glob("*/*"):
        if f"{f.parent.name}/{f.name}" not in blobs:
            f.unlink()
    for d in (out / "blobs").iterdir():
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    db.rollback()
    print(f"{len(blobs)} blobs -> {out}")
    if missing:
        print(f"warning: {missing} fingerprints have no file in {store}")


def save_blob(out: Path, data: bytes, mime: object) -> str:
    digest = hashlib.sha256(data).hexdigest()
    rel = f"{digest[:2]}/{digest}{EXT.get(mime, '.bin') if isinstance(mime, str) else '.bin'}"
    path = out / "blobs" / rel
    if not path.exists():
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(data)
    return rel


if __name__ == "__main__":
    args = sys.argv[1:]
    export(Path(args[0] if args else "data/animabackend.db"), Path(args[1] if len(args) > 1 else "../userdata"))
