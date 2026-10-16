"""(留一期)这一步现在由迁移器做:core.2026_09_tts_cache_index —— 语音缓存:淘汰旧句子用的覆盖索引。

后端启动时会自动检查(设置 MIGRATIONS_MODE=apply 时自动升级),一般不用手动跑。手动跑:在 AnimaBackend 目录下
python scripts/migrate_tts_cache_evict_index.py,改的是 data/animabackend.db,只做这一步(连同它依赖的步骤),可以重复跑。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.migrations.legacy_script import run_step  # noqa: E402

run_step("core.2026_09_tts_cache_index")
