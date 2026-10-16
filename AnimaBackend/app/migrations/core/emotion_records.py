"""认词记录、配对表的三张新表(素材架构设计 1.4、1.6.4,第 1b 期)。只建表、不填数:
今天的结果要用 node 跑前端切句代码才算得出来,启动时跑不了,由 python -m app.replay seed 填(app/replay/seed.py)。"""

from app.migrations.sqlite_util import create_tables_step

TABLES = ("word_records", "pairings", "pairing_rows")

STEP = create_tables_step("core.2026_10_emotion_records", "认词记录和配对表", TABLES)
