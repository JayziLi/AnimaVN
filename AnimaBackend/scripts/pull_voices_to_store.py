"""把语音机上的老声音文件拉进文件仓库(只记指纹,路径不改,老声音继续用原路径)。
用法:cd AnimaBackend; python scripts/pull_voices_to_store.py         # 只看要拉什么
      python scripts/pull_voices_to_store.py --run                   # 真拉;语音机要开着,拉过的不重拉
看哪个库照 DATABASE_URL。
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import VoiceProfile  # noqa: E402
from app.tts.files import missing_count, prefetch_voice_files  # noqa: E402


def plan(db) -> list[tuple[str, str, int]]:
    """[(声音编号, 名字, 缺几个文件)],只列缺的"""
    out = []
    for p in db.scalars(select(VoiceProfile).order_by(VoiceProfile.created_at)):
        n = missing_count(db, p)
        if n:
            out.append((p.id, p.name, n))
    return out


async def run(db) -> int:
    """一个一个拉,返回最后还缺的文件总数"""
    left = 0
    todo = plan(db)
    for i, (vid, name, n) in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {name}:缺 {n} 个,拉取中…", flush=True)
        miss = (await prefetch_voice_files(db, [vid]))[vid]
        left += miss
        print(f"    还缺 {miss}", flush=True)
    return left


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 控制台默认编码打不出中文
    with SessionLocal() as db:
        todo = plan(db)
        print(f"{len(todo)} 个声音要拉,共 {sum(n for *_, n in todo)} 个文件")
        for _, name, n in todo:
            print(f"  {name}:{n}")
        if "--run" in sys.argv:
            print("还缺", asyncio.run(run(db)), "个文件")


if __name__ == "__main__":
    main()
