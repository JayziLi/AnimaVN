"""背景、BGM 分开绑,CG 包分来源(素材架构第 1 步):asset_bindings 补 parts 列,cg_packs 补 generated 列。

只补列:原有的绑定行 parts 是空串(这个场景包背景和 BGM 都出,和以前一样),原有的 CG 包 generated 是 0(导入的现成 CG)。
两张表是前面两步建的,要等它们做完才看得出缺不缺列。
"""

from app.migrations.sqlite_util import add_columns_step

STEP = add_columns_step(
    "core.2026_10_binding_parts",
    "场景包分背景、BGM 两栏绑;CG 包分导入的和 AI 生成的",
    [
        ("asset_bindings", "parts", "TEXT NOT NULL DEFAULT ''"),
        ("cg_packs", "generated", "BOOLEAN NOT NULL DEFAULT 0"),
    ],
    depends=("core.2026_10_bindings", "core.2026_10_cg_packs"),
)
