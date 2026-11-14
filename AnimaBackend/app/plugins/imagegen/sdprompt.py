"""把画面拼成 SD 系模型(Illustrious、Pony、SDXL,经 A1111 接口)用的提示词。纯函数。设计第 5、9 节。

人数、每个人的标签、反向都借 assemble.py 拼好的结果,规则和 NovelAI 那边是同一套;这里只负责换顺序、转写法:
- NovelAI 把每个人分开发,SD 只有一段,所以每个人的标签接在人数后面;开头的 girl / boy 去掉,人数已经写了。
- A1111 里括号是加权,角色名的括号要转义;NovelAI 的 1.4::x:: 和 {x} 换成 (x:1.4) 和 (x:1.05)。
- LoRA 标签最后接上,不过转换(名字里的括号不能转义)。
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from app.plugins.imagegen.assemble import ADULT_GUARD, SFW_GUARD, Look, Plan, Style, assemble, explicit, join, sentence_of
from app.plugins.imagegen.backends.base import LoraUse

# Illustrious 系常用的质量词
SD_QUALITY: dict[str, str] = {
    "standard": "masterpiece, best quality, amazing quality, very aesthetic, absurdres",
    "light": "masterpiece, best quality",
    "none": "",
}

# 常用的反向词;human 是多挡手和身体画坏
SD_UC: dict[str, str] = {
    "heavy": (
        "lowres, worst quality, low quality, bad quality, bad anatomy, bad hands, missing fingers, extra digits, "
        "fewer digits, extra limbs, jpeg artifacts, signature, watermark, username, artist name, text, error, blurry, cropped"
    ),
    "light": "lowres, worst quality, low quality, bad anatomy, bad hands, signature, watermark",
    "human": "lowres, worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, extra limbs, extra arms, extra legs",
    "none": "",
}

BRACE_WEIGHT = 1.05

# 括号里结尾是「:数字」就是 A1111 的加权
_A1111_WEIGHT = re.compile(r":\s*-?(?:\d+(?:\.\d*)?|\.\d+)\s*$")
_NAI_WEIGHT = re.compile(r"(?<![\w.])(-?(?:\d+(?:\.\d*)?|\.\d+))::(.*?)::", re.DOTALL)
_BRACE = re.compile(r"\{([^{}]*)\}")
# 「(artist:1.2)」是给叫 artist 的标签加权,不是画师前缀
_ARTIST = re.compile(r"\bartist:(?![\d.]+\s*\))\s*", re.IGNORECASE)
_COMMAS = re.compile(r"\s*,[\s,]*")


def _escape_parens(text: str) -> str:
    """字面的括号前面加反斜杠。A1111 加权的括号、已经转义的括号不动"""
    literal: set[int] = set()
    opened: list[int] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "(":
            opened.append(i)
        elif ch == ")":
            if not opened:
                literal.add(i)
            else:
                start = opened.pop()
                if not _A1111_WEIGHT.search(text[start + 1 : i]):
                    literal.update((start, i))
        i += 1
    literal.update(opened)
    return "".join(f"\\{c}" if n in literal else c for n, c in enumerate(text))


def _weighted(inner: str, weight: float) -> str:
    inner = inner.strip(" ,\t\r\n")
    return f"({inner}:{weight:g})" if inner else ""


def _nai_weight(match: re.Match[str]) -> str:
    weight = float(match.group(1))
    return _weighted(match.group(2), weight) if weight > 0 else ""


def _braces(text: str) -> str:
    """由里往外一层层换,嵌套的就嵌套"""
    while True:
        out = _BRACE.sub(lambda m: _weighted(m.group(1), BRACE_WEIGHT), text)
        if out == text:
            return out
        text = out


def to_sd_tags(text: str) -> str:
    """NovelAI 写法转 A1111 写法。括号要最先转义,不然后面生成的加权括号也被转义了"""
    out = _escape_parens(text or "")
    out = _NAI_WEIGHT.sub(_nai_weight, out)
    out = _braces(out)
    out = _ARTIST.sub("", out)
    return _COMMAS.sub(", ", " ".join(out.split())).strip(" ,")


def lora_tag(lora: LoraUse) -> str:
    """<lora:名字:权重>,名字空了返回空串"""
    name = re.sub(r"[<>:\r\n]", "", lora.name).strip()
    if not name:
        return ""
    return f"<lora:{name}:{min(max(lora.weight, 0), 2):g}>"


def sd_prompt(
    plan: Plan,
    looks: dict[str, Look],
    style: Style,
    *,
    quality: str = "",
    uc: str = "",
    loras: Iterable[LoraUse] = (),
    sfw_only: bool = False,
) -> tuple[str, str]:
    """返回 (正面, 反向)。正面:人数, 触发词, 每个人, 画师, 场景, 构图句, 画风, 质量词, LoRA。loras 传什么就发什么,关掉的调用方先过滤"""
    loras = tuple(loras)
    built = assemble(plan, looks, style, model="", uc=uc, quality="", sfw_only=sfw_only)
    # 只拿人数:其他段都不给,assemble 就只拼出人数标签
    count_plan = Plan(people=plan.people, nsfw=plan.nsfw or explicit(plan), pov=plan.pov)
    count = assemble(count_plan, looks, Style(), model="", quality="", sfw_only=sfw_only).prompt
    triggers = ", ".join(x.trigger for x in loras if x.trigger)
    # 每个人开头的 girl / boy 去掉
    people = [c.prompt.partition(",")[2] for c in built.chars]

    # 构图句有逗号,不能进 join(会被拆开去重),和 assemble 一样夹在中间
    head = join(count, triggers, *people, style.artists, plan.scene)
    tail = join(head, style.tags, quality)[len(head) :]
    sentence = sentence_of(plan.composition)
    positive = to_sd_tags(f"{head}, {sentence}{tail}" if sentence else head + tail)
    lora_text = " ".join(t for t in map(lora_tag, loras) if t)
    if lora_text:
        positive = f"{positive}, {lora_text}" if positive else lora_text

    negative = to_sd_tags(join(built.negative, *(c.negative for c in built.chars)))
    # 玩家写的 0::x:: 这类写法转换时可能连带删掉保护词,这里补回去
    negative = join(negative, ADULT_GUARD, SFW_GUARD if sfw_only else "")
    return positive, negative
