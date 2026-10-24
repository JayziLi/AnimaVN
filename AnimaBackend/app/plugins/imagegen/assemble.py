"""指导模型写的画面(场景、每个人这一刻的长相衣服和动作表情)+ 不会变的(人数、画风、角色名)→ 发给 NovelAI 的提示词。纯函数。

10-22 起长相和衣服全听指导模型的(用户:代码每次补平时的衣服发型,剧情里光着脚还补上 pantyhose, flats),
卡上写的长相、平时的衣服只当参考给它看(writer.py);这里不再补。设计:docs/superpowers/specs/2026-10-22-imagegen-state-notes-design.md
- 人数标签按每个人的性别算(1girl / 1boy …),一个人时加 solo,一男一女时日常加 couple、nsfw 时加 hetero
  (10-06 发现日常写 hetero 会往成人向带);一个人都没有是风景(no humans, scenery)。
- 每个人一条分角色提示词:girl / boy + 角色名标签 + 这一刻的长相 + 这一刻穿的 + 动作表情;不给坐标,NovelAI 自己摆(nai.py 的 use_coords)。
  10-09 起是从左到右排开(两个人 0.35 / 0.65),10-18 试过让指导模型定坐标,两个人常被挤在一起画糊,
  最后改成谁在哪写进构图句,NovelAI 自己排。
- 角色名标签(keqing (genshin impact) 这种)照旧由这里加在这个人提示词的最前面:NovelAI 认得的角色写名字最像。
- 用了参考图的那个人也写指导模型写的长相(10-22 对比:不写的话扎马尾、头发放下来这些变化画不出来,写了照样像立绘;
  10-09 那时长相是卡上写死的,不写最像)。
- 老的画面(10-22 以前存的,person.look 是 None)照老规矩:补卡上的长相(用了参考图的不补),没写这一刻穿的就补平时的衣服
  (nsfw 时不补),「换一张」画出来和以前一样。
- 指导模型写的一句英文构图(composition)原样接在场景标签后面;画师串放在人数标签后面、场景前面。
- nsfw 不问指导模型:plan.nsfw 开着,或者标签里写了裸露 / 性器官的词,就加 nsfw, uncensored
  (NovelAI 要有这个才放开画成人内容,10-12 试过不加画出来完全不是)。只画全年龄的卡一律不加。
- 反向:反向预设 + 画风的反向 + 成人保护词 + 人数保护(单人挡多出来的人);只画全年龄时再挡成人向的词。
- 第一人称(plan.pov):画面就是玩家的眼睛 —— 不画玩家这个人(指导模型写了也去掉),加 pov、不加 solo;
  反向不挡 1boy(手是男的),只挡 multiple boys。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.plugins.imagegen.nai import SFW_OF, CharPrompt

QUALITY = "very aesthetic, masterpiece, no text"
ADULT_GUARD = "loli, child, chibi, aged down"
SFW_GUARD = "nsfw, nude, nipples, pussy, penis, sex, cum"
MALE_WORDS = ("1boy", "boy", "male", "man")
# 标签里有这些词(整词)就算成人向的画面:sexy、analog 这种不算
_EXPLICIT = re.compile(
    r"\b(nude|naked|nipples?|pussy|penis|sex|vaginal|anal|anus|topless|bottomless|cum|fellatio|paizuri|handjob|erection)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Look:
    """一个人卡上写的样子:长相标签、平时的衣服(只给老画面补)、反向、性别(female / male);player = 玩家本人"""

    tags: str = ""
    negative: str = ""
    gender: str = "female"
    player: bool = False
    outfit: str = ""
    # 角色名标签(danbooru 的写法,原创角色空着)
    name_tag: str = ""
    # 带了参考图:老画面不补卡上的长相
    ref: bool = False


@dataclass(frozen=True)
class Person:
    who: str
    tags: str = ""
    # 这一刻穿的
    clothes: str = ""
    # 这一刻的长相(10-22 起指导模型写);None = 老的画面,照老规矩补卡上的长相和平时的衣服
    look: str | None = None


@dataclass(frozen=True)
class Plan:
    """指导模型的结果里拼提示词要的那部分"""

    scene: str = ""
    people: tuple[Person, ...] = field(default_factory=tuple)
    # 要求画成人向
    nsfw: bool = False
    # 第一人称:玩家是镜头
    pov: bool = False
    # 一句英文自然语言的整体构图(10-18 实测 V4.5 读得懂:写的光圈、谁在谁身后都画出来了)
    composition: str = ""


@dataclass(frozen=True)
class Style:
    tags: str = ""
    negative: str = ""
    # 画师串(artist:xxx, …)
    artists: str = ""


@dataclass(frozen=True)
class Assembled:
    prompt: str
    negative: str
    chars: tuple[CharPrompt, ...]
    model: str


def join(*parts: str) -> str:
    """几段逗号分隔的标签拼成一串:去空、去重(不分大小写),先出现的留着"""
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        for tag in (part or "").split(","):
            t = tag.strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                out.append(t)
    return ", ".join(out)


def _gender_of(person: Person, look: Look | None) -> str:
    if look is not None:
        return look.gender
    words = {t.strip().lower() for t in person.tags.split(",")}
    return "male" if words & set(MALE_WORDS) else "female"


def _count(word: str, n: int) -> str:
    return f"{n}{word}" if n == 1 else f"{n}{word}s"


def explicit(plan: Plan) -> bool:
    """画面里写了裸露 / 性器官 / 性行为的标签(场景、构图、每个人的长相衣服动作)"""
    parts = [plan.scene, plan.composition, *(f"{p.tags} {p.clothes} {p.look or ''}" for p in plan.people)]
    return any(_EXPLICIT.search(x) for x in parts if x)


def sentence_of(text: str) -> str:
    """构图句子:压成一行,去掉 NovelAI 当加权用的括号,太长截断"""
    flat = " ".join((text or "").translate(str.maketrans("", "", "{}[]")).split())
    return flat[:600].rstrip(" ,")


def _wears(person: Person, look: Look | None, nsfw: bool) -> tuple[str, str]:
    """这个人的(长相, 衣服):新画面照指导模型写的;老画面补卡上的长相(用了参考图的不补,和以前一样)和平时的衣服"""
    if person.look is not None:
        return person.look, person.clothes
    face = "" if look is None or look.ref else look.tags
    outfit = person.clothes or ("" if nsfw or look is None else look.outfit)
    return face, outfit


def assemble(
    plan: Plan,
    looks: dict[str, Look],
    style: Style,
    *,
    model: str,
    uc: str = "",
    quality: str = QUALITY,
    sfw_only: bool = False,
) -> Assembled:
    """uc = 反向预设 + 玩家另外写的反向;quality = 质量词原文(空串 = 不加),都由调用方按最后用的模型挑好"""
    nsfw = (plan.nsfw or explicit(plan)) and not sfw_only
    people = list(plan.people)
    if plan.pov:
        people = [p for p in people if not (looks.get(p.who) and looks[p.who].player)]
    genders = [_gender_of(p, looks.get(p.who)) for p in people]
    girls, boys = genders.count("female"), genders.count("male")

    count: list[str] = []
    if girls:
        count.append(_count("girl", girls))
    if boys:
        count.append(_count("boy", boys))
    if not people:
        count.append("pov" if plan.pov else "no humans, scenery")
    elif plan.pov:
        count.append("pov")
    elif len(people) == 1:
        count.append("solo")
    elif girls and boys:
        count.append("hetero" if nsfw else "couple")
    if nsfw:
        count.append("nsfw, uncensored")

    guards = [ADULT_GUARD]
    if people:
        if not boys:
            # 第一人称画得到玩家的手:不挡 1boy
            guards.append("multiple boys" if plan.pov else "1boy, multiple boys")
        if not girls:
            guards.append("1girl, multiple girls")
        if girls == 1:
            guards.append("2girls, multiple girls")
        if boys == 1:
            guards.append("2boys, multiple boys")
    if sfw_only:
        guards.append(SFW_GUARD)

    chars: list[CharPrompt] = []
    for person, gender in zip(people, genders, strict=True):
        look = looks.get(person.who)
        face, outfit = _wears(person, look, nsfw)
        base = "girl" if gender == "female" else "boy"
        prompt = join(base, look.name_tag if look else "", face, outfit, person.tags)
        chars.append(CharPrompt(prompt=prompt, negative=look.negative if look else ""))

    # 构图那句接在场景标签后面、画风前面;句子里有逗号,不能进 join(会被拆开去重)
    head = join(", ".join(count), style.artists, plan.scene)
    tail = join(head, style.tags, quality)[len(head):]
    sentence = sentence_of(plan.composition)
    return Assembled(
        prompt=f"{head}, {sentence}{tail}" if sentence else head + tail,
        negative=join(uc, style.negative, *guards),
        chars=tuple(chars),
        model=SFW_OF.get(model, model) if sfw_only else model,
    )
