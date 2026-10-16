"""缺格补配(设计 1.6.2):名单里配对表还没有的项,先比名字;对不上的,语音让本地认词模型(固定算法)挑一段,
CG 用构图本身那张。两种都标「待重配」,等联网了在配对页让模型重配。

比名字(新规则):左边一项的名字或别名,和右边一行的名字或别名,任一相同就算对上;只去首尾空白、英文不分大小写;
对上几行取排在前面的那行。
语音只在基础的语气里挑(1.6.3、1.6.4):声线版本不单独配。现在语气行上还没有「是哪一行的版本」这一栏(设计 1.6.9),
先按命名认:「X·后缀」、X 也是这个声音的一行,而且同一个后缀至少挂在两行上。只挂一行的(比如只有「生气·嘴硬」
一行带「嘴硬」)是一段单独的语气。
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol, TypeVar

from app.api.tts import nearest_with
from app.emotion.lists import Item
from app.emotion.matcher import EmotionMatcher
from app.emotion.service import EmotionUnavailable

SEP = "·"


class Named(Protocol):
    """右边的一行:声音的一段语气 / CG 的一张差分"""

    id: str
    label: str
    aliases: list


N = TypeVar("N", bound=Named)


@dataclass(frozen=True)
class NewCell:
    item: str
    # 语气行 / 差分的编号;CG 是 None = 用构图本身那张
    value: str | None
    # name 名字对上 / local 本地模型(CG 对不上时也记 local:构图本身是兜底,不是谁挑的)
    source: str
    guessed: bool
    pending: bool


@dataclass(frozen=True)
class Skipped:
    item: str
    reason: str


def _keys(label: str, aliases: Sequence[str]) -> set[str]:
    return {k for k in (n.strip().lower() for n in (label, *aliases)) if k}


def name_match(item: Item, options: Sequence[N]) -> N | None:
    """名字或别名任一相同的第一行"""
    mine = _keys(item.label, item.aliases)
    return next((o for o in options if mine & _keys(o.label, o.aliases or ())), None)


def base_rows(rows: Sequence[N]) -> list[N]:
    """去掉声线版本,剩下基础的语气(顺序不变)"""
    labels = {r.label.strip() for r in rows}
    by_suffix: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        head, sep, suffix = r.label.strip().rpartition(SEP)
        if sep and suffix and head in labels:
            by_suffix[suffix].append(r.id)
    versions = {i for ids in by_suffix.values() if len(ids) >= 2 for i in ids}
    return [r for r in rows if r.id not in versions]


def fill_voice(
    items: Sequence[Item], rows: Sequence[Named], matcher: Callable[[], EmotionMatcher]
) -> tuple[list[NewCell], list[Skipped]]:
    """语音:名字对上 → 本地认词模型挑最像的一段(和游戏里按名字挑语气时同一个函数)。
    matcher 只在真要问模型时才调;模型用不了时这些项不补,原因写进 Skipped。结果按名单的顺序"""
    base = base_rows(rows)
    hits = {i.key: name_match(i, base) for i in items}
    out: dict[str, NewCell | Skipped] = {
        key: NewCell(key, hit.id, "name", False, False) for key, hit in hits.items() if hit is not None
    }
    ask = [i for i in items if i.key not in out]
    if ask:
        try:
            m = matcher()
        except EmotionUnavailable as e:
            m = None
            for i in ask:
                out[i.key] = Skipped(i.key, f"本地认词模型用不了:{e}")
        if m is not None:
            for i in ask:
                pick = nearest_with(m.match_singles, i.label.strip(), base)
                out[i.key] = (
                    NewCell(i.key, pick.row.id, "local", True, True)
                    if pick is not None
                    else Skipped(i.key, "名字是空的或超过 40 字,本地认词模型没法比")
                )
    done = [out[i.key] for i in items]
    return [c for c in done if isinstance(c, NewCell)], [s for s in done if isinstance(s, Skipped)]


def fill_cg(items: Sequence[Item], variants: Sequence[Named]) -> list[NewCell]:
    """CG:只按名字配;对不上用构图本身。不让本地模型在几张差分里硬挑(1.6.2 第 3 条)"""
    out = []
    for i in items:
        hit = name_match(i, variants)
        out.append(NewCell(i.key, hit.id, "name", False, False) if hit else NewCell(i.key, None, "local", False, True))
    return out
