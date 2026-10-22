"""全部迁移步骤,按执行顺序排。新步骤加在最后;一个步骤的 depends 必须排在它前面(测试会查)。

编号里的年月是那一步最早出现的时候(旧步骤按原来的 scripts/migrate_*.py 加进仓库的日子)。
编号一旦发出去就记在各个库的账本里,以后不能改名。
"""

from app.migrations.base import Step
from app.migrations.core import (
    binding_parts,
    bindings,
    blob_store,
    card_prefs,
    card_states,
    cg_packs,
    drop_card_sprites,
    emotion_records,
    legacy,
    sprite_packs,
    voice_files,
)

try:  # 公开版没有 private 文件夹
    from app.migrations.private import STEPS as PRIVATE_STEPS
except ImportError:  # pragma: no cover
    PRIVATE_STEPS = []

STEPS: list[Step] = [
    legacy.CONNECTION_CACHE,
    legacy.CHAT_PARENT,
    legacy.CONNECTION_STREAM,
    legacy.CARD_LAST_CHAT,
    legacy.VOICE_INDEXTTS,
    legacy.VOICE_PARAMS,
    legacy.ASSET_ENABLED,
    legacy.CONNECTION_THINKING,
    legacy.SCENE_TITLE_BGM,
    legacy.SPRITE_FACE,
    sprite_packs.STEP,
    legacy.CHAT_VARIABLES,
    legacy.TTS_CACHE_INDEX,
    legacy.SCENE_PARENT,
    legacy.SCENE_FORMS,
    legacy.SPRITE_EFFECT,
    legacy.VOICE_AUX_REFS,
    emotion_records.STEP,
    card_prefs.STEP,
    blob_store.STEP,
    bindings.STEP,
    cg_packs.STEP,
    card_states.STEP,
    drop_card_sprites.STEP,
    binding_parts.STEP,
    voice_files.STEP,
    *PRIVATE_STEPS,
]
