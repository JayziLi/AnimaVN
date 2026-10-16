"""卡带登记处(素材架构设计 2.1、2.8;实施计划 P2b):能整个拔掉的插件,各是 app/plugins 下的一个模块或包。

每个卡带模块导出 CARTRIDGE(下面的 Cartridge):id、要挂的接口路由、加载后跑一次的 on_load(登记 Jev 题目一类)。
卡带自己的模型放在卡带里,卡带被 import 时就定义好,启动时的 create_all 才看得见。

规矩(tests/test_cartridge_boundary.py 守着):卡带外面谁都不 import 卡带,卡带之间也不,只通过这里;
卡带自己的测试放 tests/plugins/<模块名>/,生成公开版时和卡带一起删。卡带不在时照常启动,只是少了那样功能。
"""

from __future__ import annotations

import importlib
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from fastapi import APIRouter

# 认得的卡带(模块名;id 是把下划线换成连字符,和前端的文件夹名一样)。公开版删掉的找不到就跳过
CARTRIDGE_MODULES: tuple[str, ...] = ("voice_sfx", "voice_tone", "sprite_forms_legacy", "private_defaults", "imagegen")


@dataclass(frozen=True)
class Cartridge:
    id: str
    # main.py 按顺序 include
    routers: list[APIRouter] = field(default_factory=list)
    # 加载以后跑一次;测试里会多次加载,要能重复跑
    on_load: Callable[[], None] | None = None


def load_cartridges(names: Iterable[str] = CARTRIDGE_MODULES) -> list[Cartridge]:
    """按 names 的顺序 import 在的卡带,跑它们的 on_load,返回它们的 CARTRIDGE"""
    loaded: list[Cartridge] = []
    for name in names:
        module_name = f"{__name__}.{name}"
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError as e:
            # 只有卡带本身不在才跳过;卡带在、它 import 的东西缺了,照样报错
            if e.name != module_name:
                raise
            continue
        cartridge = getattr(module, "CARTRIDGE", None)
        if not isinstance(cartridge, Cartridge):
            raise TypeError(f"卡带 {module_name} 要导出 CARTRIDGE = Cartridge(...)")
        if cartridge.id != name.replace("_", "-"):
            raise ValueError(f"卡带 {module_name} 的 id 要是 {name.replace('_', '-')!r},现在是 {cartridge.id!r}")
        if cartridge.on_load is not None:
            cartridge.on_load()
        loaded.append(cartridge)
    return loaded
