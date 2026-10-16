"""让聊天模型重配(设计 1.6.3、1.6.8):拼发给模型的一次请求,解析它回的 JSON。

左边是名单(立绘:名字:说明;也叫:别名),按 1、2、3 编号;右边是这张表能配的(语音:基础的语气,带原文前 40 字;
CG:这张构图传了图的差分和说明,最后加一项「保持构图本身」),按 A、B、C 编号。模型只回 {"1": "A", …}。
只发名字、说明、别名和原文,不发对话内容。
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass

from app.emotion.lists import Item

MAX_TEXT = 40
KEEP = "保持构图本身"


class BadReply(Exception):
    """模型回的没法用,str 是原因"""


@dataclass(frozen=True)
class Option:
    """右边的一项:value 是语气行 / 差分的编号,None = 构图本身;text 是编号后面写的那段"""

    value: str | None
    text: str


def letter(i: int) -> str:
    """第 i 项(从 0 数)的字母:A–Z,再往后 AA、AB……(语气超过 26 段时)"""
    out = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        out = chr(ord("A") + r) + out
    return out


def _one_line(text: str | None) -> str:
    return " ".join((text or "").split())


def _names(aliases: Sequence[str]) -> list[str]:
    return [n for n in (a.strip() for a in aliases) if n]


def voice_options(rows: Sequence) -> list[Option]:
    """语音的右边:基础的语气(调用方先用 fill.base_rows 去掉声线版本),名字 + 原文前 40 字"""
    out = []
    for r in rows:
        text = _one_line(r.prompt_text)[:MAX_TEXT]
        out.append(Option(r.id, f"{r.label.strip()}  原文:{text}" if text else r.label.strip()))
    return out


def cg_options(variants: Sequence) -> list[Option]:
    """CG 的右边:传了图的差分(名字:说明),最后一项是不换差分"""
    out = []
    for v in variants:
        desc = _one_line(v.description)
        out.append(Option(v.id, f"{v.label.strip()}:{desc}" if desc else v.label.strip()))
    return [*out, Option(None, KEEP)]


def left_title(pack_name: str) -> str:
    return f"左边是立绘包「{pack_name}」的立绘(名字:说明;也叫:别名)"


def voice_title(voice_name: str) -> str:
    return f"右边是声音「{voice_name}」的语气(名字;原文:这段参考音频说的话,截前 {MAX_TEXT} 个字)"


def cg_title(composition: str) -> str:
    return f"右边是 CG「{composition}」的差分(名字:说明;最后一项是不换差分)"


def build(left: str, items: Sequence[Item], right: str, options: Sequence[Option]) -> str:
    """整段提示词;left、right 是两边的标题(上面三个函数拼的)"""
    lines = [left]
    for n, i in enumerate(items, 1):
        desc = _one_line(i.description)
        aliases = _names(i.aliases)
        line = f"  {n}. {i.label.strip()}"
        if desc:
            line += f":{desc}"
        if aliases:
            line += f"  也叫:{'、'.join(aliases)}"
        lines.append(line)
    lines.append(right)
    lines += [f"  {letter(k)}. {o.text}" for k, o in enumerate(options)]
    lines.append(
        "给左边每一项挑右边最合适的一项,只能从右边挑,每一项都要挑。"
        '只输出 JSON,不要别的字:{"1": "A", "2": "B", …}'
    )
    return "\n".join(lines)


def _first_object(text: str) -> dict | None:
    """回复里第一个能读成 JSON 对象的 {…}:前后的说明、```json 围栏都跳过"""
    decoder = json.JSONDecoder()
    at = text.find("{")
    while at != -1:
        try:
            obj, _ = decoder.raw_decode(text, at)
        except ValueError:
            obj = None
        if isinstance(obj, dict):
            return obj
        at = text.find("{", at + 1)
    return None


def parse_reply(text: str, n_left: int, n_right: int) -> dict[int, int]:
    """{左边第几项(从 1 数): 右边第几项(从 0 数)}。没回的项不在里面;有一项写错就整个不用(BadReply)"""
    obj = _first_object(text)
    if obj is None:
        raise BadReply("回的不是 JSON 对象")
    letters = {letter(k): k for k in range(n_right)}
    out: dict[int, int] = {}
    for key, value in obj.items():
        try:
            n = int(str(key).strip())
        except ValueError:
            raise BadReply(f"左边没有「{key}」这一项") from None
        if not 1 <= n <= n_left:
            raise BadReply(f"左边没有第 {key} 项(只有 1–{n_left})")
        pick = letters.get(value.strip().upper()) if isinstance(value, str) else None
        if pick is None:
            raise BadReply(f"第 {n} 项回的「{value}」不是右边的一项(只有 A–{letter(n_right - 1)})")
        out[n] = pick
    if not out:
        raise BadReply("一项都没配")
    return out
