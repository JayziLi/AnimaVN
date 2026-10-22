"""指导模型写的(场景、每个人这次在做什么)+ 不会变的(画风、每个人的外貌)→ 发给 NovelAI 的提示词。纯函数。

指导模型只写会变的东西,长相、画风每次由这里拼,所以每张是同一个人、同一种画风
(10-09 星绘整段剧情的 C 线就是这样:发箍、白发紫眼、蝴蝶结每张都在)。
- 人数标签按每个人的性别算(1girl / 1boy …),一个人时加 solo,一男一女时日常加 couple、nsfw 时加 hetero
  (10-06 发现日常写 hetero 会往成人向带);一个人都没有是风景(no humans, scenery)。
- 每个人一条分角色提示词:girl / boy + 外貌 + 这次的动作表情;不给坐标,NovelAI 自己摆(nai.py 的 use_coords)。
  10-09 起是从左到右排开(两个人 0.35 / 0.65),10-18 试过让指导模型定坐标,两个人常被挤在一起画糊,
  最后改成谁在哪写进构图句,NovelAI 自己排。
- 指导模型写的一句英文构图(composition)原样接在场景标签后面。
- 反向:反向预设 + 画风的反向 + 成人保护词 + 人数保护(单人挡多出来的人);只画全年龄时再挡成人向的词。
- 衣服:每个人平时穿什么(outfit)单独放;指导模型写了这一刻穿什么(clothes:睡衣、泳装、脱了外套、nude)就换掉平时的,
  没写就照平时的。nsfw 场面没写时不加平时的衣服(多半是脱了,写进去两边打架)。
- 男主日常要写衣服、挡光膀子(10-06:不写会被画成没穿上衣)。
- 角色名标签(keqing (genshin impact) 这种)放在这个人提示词的最前面:NovelAI 认得的角色写名字最像。
- 用了参考图的那个人不写长相标签(10-09:V4.5 + 立绘、提示词不写长相最像),衣服照常。
- 画师串放在人数标签后面、场景前面。
- 第一人称(plan.pov,10-12 用户定的默认):画面就是玩家的眼睛 —— 不画玩家这个人(指导模型写了也去掉),
  加 pov、不加 solo;画到玩家的手(scene 里有 pov hands)时按玩家平时的衣服加袖子颜色(black shirt → black sleeves);
  反向不挡 1boy(手是男的),只挡 multiple boys。10-12 试画牵手 / 摸头 / 凑近 / 喂你四张都对。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.plugins.imagegen.nai import SFW_OF, CharPrompt

QUALITY = "very aesthetic, masterpiece, no text"
ADULT_GUARD = "loli, child, chibi, aged down"
SFW_GUARD = "nsfw, nude, nipples, pussy, penis, sex, cum"
PLAYER_DRESSED = "fully clothed"
PLAYER_DRESSED_NEG = "topless male, shirtless"
MALE_WORDS = ("1boy", "boy", "male", "man")
COLORS = ("black", "white", "grey", "gray", "navy", "blue", "red", "brown", "green", "beige", "pink", "purple", "yellow", "orange")


@dataclass(frozen=True)
class Look:
    """一个人不会变的样子:长相标签、平时的衣服、反向、性别(female / male);player = 玩家本人"""

    tags: str = ""
    negative: str = ""
    gender: str = "female"
    player: bool = False
    outfit: str = ""
    # 角色名标签(danbooru 的写法,原创角色空着)
    name_tag: str = ""
    # 长相交给参考图:不写 tags
    ref: bool = False


@dataclass(frozen=True)
class Person:
    who: str
    tags: str = ""
    # 这一刻穿的(和平时不一样时才写);空 = 照平时的
    clothes: str = ""


@dataclass(frozen=True)
class Plan:
    """指导模型的结果里拼提示词要的那部分"""

    scene: str = ""
    people: tuple[Person, ...] = field(default_factory=tuple)
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


def _tags(text: str) -> set[str]:
    return {t.strip().lower() for t in (text or "").split(",") if t.strip()}


def sleeves(outfit: str) -> str:
    """第一人称画到玩家的手时袖子什么颜色:平时穿的衣服里第一个颜色词(black shirt → black sleeves);没有就不写"""
    for word in outfit.lower().replace(",", " ").split():
        if word in COLORS:
            return f"{word} sleeves"
    return ""


def sentence_of(text: str) -> str:
    """构图句子:压成一行,去掉 NovelAI 当加权用的括号,太长截断"""
    flat = " ".join((text or "").translate(str.maketrans("", "", "{}[]")).split())
    return flat[:600].rstrip(" ,")


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
    nsfw = plan.nsfw and not sfw_only
    player = next((v for v in looks.values() if v.player), None)
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
    # NovelAI 要提示词里有 nsfw 才放开画成人内容(10-12 试过:不加的话画出来完全不是)
    if nsfw:
        count.append("nsfw, uncensored")
    hands = ""
    # 指导模型有时写成一个连着的标签(pov hands on her waist):包含就算
    if plan.pov and any("pov hands" in t for t in _tags(plan.scene)) and player is not None:
        hands = sleeves(player.outfit)

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
        base = "girl" if gender == "female" else "boy"
        outfit = person.clothes or ("" if nsfw or look is None else look.outfit)
        face = "" if look is None or look.ref else look.tags
        prompt = join(base, look.name_tag if look else "", face, outfit, person.tags)
        negative = look.negative if look else ""
        if hands and not (look is not None and look.player):
            # 玩家手的袖子颜色写在主提示词里,会串到她身上(10-12 两张实测她都穿上了黑袖子):她的反向挡掉
            negative = join(negative, hands)
        if look is not None and look.player and gender == "male" and not nsfw and not person.clothes:
            prompt = join(prompt, PLAYER_DRESSED)
            negative = join(negative, PLAYER_DRESSED_NEG)
        chars.append(CharPrompt(prompt=prompt, negative=negative))

    # 构图那句接在场景标签后面、画风前面;句子里有逗号,不能进 join(会被拆开去重)
    head = join(", ".join(count), style.artists, plan.scene, hands)
    tail = join(head, style.tags, quality)[len(head):]
    sentence = sentence_of(plan.composition)
    return Assembled(
        prompt=f"{head}, {sentence}{tail}" if sentence else head + tail,
        negative=join(uc, style.negative, *guards),
        chars=tuple(chars),
        model=SFW_OF.get(model, model) if sfw_only else model,
    )
