"""一步迁移的定义。"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

Kind = Literal["schema", "data", "job"]
Compat = Literal["additive", "breaking"]


@dataclass(frozen=True)
class Step:
    """迁移的一步。

    id:「命名空间.年_月_说明」,比如 core.2026_09_asset_enabled、private.2026_10_split_states。
    detect:库已经是做完以后的样子吗。老库手跑过 scripts/migrate_*.py 的、新库由 create_all 建出完整表的,
    都算做完 —— 这样的步骤只登记、不再做。
    apply:做这一步,不要自己提交(事务由 runner 管)。verify:做完检查一遍,不过就整步回滚。
    compat:additive = 只加不改,旧版本的代码在升级后的库上照常能跑;breaking = 旧代码会出错。
    draft:还在开发的步骤,真库上不跑,只在 rehearse --drafts 里跑。
    """

    id: str
    title: str
    detect: Callable[[sqlite3.Connection], bool]
    apply: Callable[[sqlite3.Connection], None]
    verify: Callable[[sqlite3.Connection], bool]
    kind: Kind = "schema"
    compat: Compat = "additive"
    depends: tuple[str, ...] = ()
    draft: bool = False

    @property
    def namespace(self) -> str:
        return self.id.split(".", 1)[0]
