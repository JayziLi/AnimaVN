"""导入时的小字典(设计稿 1.7):酒馆表情包的英文名 → 自动加的中文别名。

    chinese_aliases("joy")  → ["开心", "高兴"]
    vocabulary()            → 认「这批图是不是表情」用的词表(导入计划规则 4)

- 数据在 expression_aliases.json(设计稿 1.7 那张表);expression_aliases.private.json 存在就并进来
  (表里私有的那一行,属于数据、不进公开版:publish/make_public.py 的 DROP 删掉它,公开版照常跑)。
- 只在导入时用,游戏里不起作用;只加别名、不改名字。同一个包里别的图已经用了的词不加(classify.py 管)。
- 英文名按 casefold 查;合并时同一个英文名的别名接在后面、去重。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.contracts import BUILTIN_EMOTIONS

DICT_PATH = Path(__file__).with_name("expression_aliases.json")
PRIVATE_PATH = Path(__file__).with_name("expression_aliases.private.json")


def _read(path: Path) -> dict[str, list[str]]:
    raw = json.loads(path.read_text("utf-8"))
    return {str(k): [str(a) for a in v] for k, v in raw.items() if isinstance(v, list)}


def load(public: Path = DICT_PATH, private: Path = PRIVATE_PATH) -> dict[str, list[str]]:
    """{英文名(casefold): [中文别名…]};私有文件不在就只用公开的那份"""
    out: dict[str, list[str]] = {}
    for path in (public, private):
        if not path.is_file():
            continue
        for name, words in _read(path).items():
            have = out.setdefault(name.casefold(), [])
            have.extend(w for w in words if w not in have)
    return out


@lru_cache(maxsize=1)
def table() -> dict[str, list[str]]:
    return load()


def chinese_aliases(name: str) -> list[str]:
    """这个英文名要加的中文别名;不在字典里是 []"""
    return list(table().get(name.casefold(), []))


@lru_cache(maxsize=1)
def vocabulary() -> frozenset[str]:
    """表情词表(casefold):小字典的英文名和中文别名、内置 16 种表情和它们的别名"""
    words: set[str] = set()
    for name, chinese in table().items():
        words.add(name)
        words.update(w.casefold() for w in chinese)
    for label, extra in BUILTIN_EMOTIONS:
        words.add(label.casefold())
        words.update(w.casefold() for w in extra)
    return frozenset(words)
