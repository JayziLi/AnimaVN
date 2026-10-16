"""状态组的两张新表(素材架构设计 3.5.1,第 4 期)。只建表:哪些卡拆成状态是私有迁移和以后卡编辑器的事。"""

from app.migrations.sqlite_util import create_tables_step

TABLES = ("card_state_groups", "card_states")

STEP = create_tables_step("core.2026_10_card_states", "状态组", TABLES)
