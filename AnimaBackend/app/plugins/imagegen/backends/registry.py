"""按连接种类找后端模块。NovelAI 的请求体由 api.py 照老规矩拼,不走这里的 draw;
别的种类导出 draw(conn, job) -> Result、check(conn) -> str、options(conn) -> dict。
用到才 import:nai.py 要 import base.py,放在包的顶层会绕成循环"""

from __future__ import annotations

from importlib import import_module
from types import ModuleType

_MODULES = {"novelai": "novelai", "openai": "openai", "sdapi": "sdapi"}


def drawable(kind: str) -> bool:
    """这种连接接好了没有(能查、能出图)"""
    return kind in _MODULES


def backend_of(kind: str) -> ModuleType:
    return import_module(f"app.plugins.imagegen.backends.{_MODULES[kind]}")
