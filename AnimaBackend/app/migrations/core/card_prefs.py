"""按卡设置的新表 card_prefs(素材架构设计 2.9,第 2 期)。只建表:
今天没有任何一张卡另设过,表是空的,不用填数。"""

from app.migrations.sqlite_util import create_tables_step

TABLES = ("card_prefs",)

STEP = create_tables_step("core.2026_10_card_prefs", "按卡设置", TABLES)
