"""指导模型:读剧情,写这一幕画什么(场景、每个人的动作表情)。自动出图时它也是导演,顺便判要不要出。

发给它的话分三段:说明书(玩家能改,插件页「高级」)+ 输出格式(写死在这里,改说明书也不会把格式改坏)+ 这次的剧情。
默认关思考(10-09 实测:Haiku 5.5 开着思考一次 3.6–4.8 秒,关掉 1.2–1.5 秒;DeepSeek flash 关思考约 1.25 秒);
连接不认「关思考」时(有的模型关不掉)退回连接自己的思考设置再试一次。
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

from app.llm.base import ChatMessage
from app.llm.errors import LLMError
from app.llm.registry import provider_for
from app.models import ApiConnection, TavernCard
from app.plugins.imagegen.assemble import Person, Plan

MAX_PEOPLE = 4

SKILL_MANUAL = """你是视觉小说的插画指导。根据玩家正在看的剧情,给 NovelAI(动漫画风的生图模型)写这一幕的画面。

写法:
- 标签用英文 danbooru 标签,逗号隔开,不要写句子。例如 sitting, hugging own knees, looking at viewer, blush, smile, beach, sunset, waves, from side, cowboy shot。
- 画「[>]」标出的那一句此刻的样子;前面几句是上下文。
- 画面里有谁就在 people 里写谁,who 只能用给你的名字;没人的风景 people 写 []。两个人时写清相对位置和互动(holding hands, hug, head on another's shoulder, facing each other)。
- 不要写头发、眼睛、身材:代码会自动加上。
- 衣服:和平时一样就让 clothes 空着(代码加平时的衣服);这一刻穿得不一样(睡衣、泳装、浴巾、脱了外套、nude)就在 clothes 里写这一刻穿的全部。
- 手里拿着的东西要写出来(holding ice cream, holding umbrella)。
- 镜头选最能表现这一刻的:close-up / portrait / upper body / cowboy shot / full body / from above / from below / from side。
- scene 写地点、时间、天气、光线、氛围,地点和剧情一致。
- 玩家写了「想看什么」时以它为准。
- 画面里有裸露或性内容时 nsfw 写 true;不是就写 false。"""

SKILL_AUTO = """你是视觉小说的导演,决定这条回复要不要配一张插图(CG),要的话顺便写好画面。

什么时候出图:
- 值得出:第一次到一个有氛围的地方;身体接触(牵手、拥抱、亲吻、靠肩、膝枕);强烈的情绪(哭、告白、大笑);换了衣服;玩家明说想看(「给我看看」「拍张照」)。
- 不出:闲聊、普通对话、和上一张图差不多的场面。拿不准就不出。
- importance:3 = 第一次到某地、第一次身体接触、告白、玩家明说想看;2 = 值得出;1 = 可出可不出。
- at 写这个画面出现的那一句的编号(从 0 数)。

写画面的方法:
- 标签用英文 danbooru 标签,逗号隔开,不要写句子。
- 画面里有谁就在 people 里写谁,who 只能用给你的名字;没人的风景 people 写 []。两个人时写清相对位置和互动。
- 不要写头发、眼睛、身材:代码会自动加上。衣服和平时一样就让 clothes 空着;穿得不一样(睡衣、泳装、nude)就在 clothes 里写这一刻穿的全部。
- 手里拿着的东西要写出来。
- 镜头选最能表现这一刻的;scene 写地点、时间、天气、光线、氛围。
- 画面里有裸露或性内容时 nsfw 写 true;不是就写 false。"""

SKILL_LOOK = """根据角色卡,写这个角色平时的外貌,给 NovelAI(动漫画风的生图模型)用。
只要英文 danbooru 标签,逗号隔开,分三栏:
- name_tag 角色名:如果是已有游戏、动漫、小说里的角色,写 danbooru 的角色标签(比如 keqing (genshin impact)、
  amiya (arknights)、tendou alice (blue archive)),NovelAI 认得这些角色;原创角色空着;
- tags 长相:年龄感(成年写 adult)、发色、发型、刘海、发饰、瞳色、身材;
- outfit 平时穿的:衣服、鞋、配饰。
不要写表情、动作、地点、性格。"""

DEFAULT_SKILLS = {"manual": SKILL_MANUAL, "auto": SKILL_AUTO, "look": SKILL_LOOK}

_PICTURE_FIELDS = """  "title": "四到八个字的短名字,比如 河堤回眸、深夜抱枕",
  "description": "一句中文:画的是什么",
  "scene": "英文标签:镜头、地点、时间、光线、氛围",
  "people": [{"who": "名字", "tags": "英文标签:姿势、动作、表情、视线、手里的东西", "clothes": "这一刻穿的(和平时一样就空着)"}],
  "nsfw": false,
  "pov": true,
  "until": "这个画面一直持续到第几句(编号)。说话、表情、手上的小动作都不算变;换了地方、换了姿势(比如背后抱变成面对面)、换了衣服、有人来或走才算结束,写变之前那一句;后面一直没变就写给你的最后一句"""

FORMAT_MANUAL = "只输出一个 JSON,不要代码块、不要别的字:\n{\n" + _PICTURE_FIELDS + "\n}"
FORMAT_AUTO = (
    "只输出一个 JSON,不要代码块、不要别的字:\n{\n"
    '  "draw": true,\n  "at": 0,\n  "importance": 2,\n  "reason": "一句中文:为什么出 / 不出",\n'
    + _PICTURE_FIELDS
    + "\n}\ndraw 是 false 时其余字段留空。"
)
FORMAT_LOOK = (
    '只输出一个 JSON,不要代码块、不要别的字:\n'
    '{"name_tag": "角色名标签,原创角色空串", "tags": "长相的英文标签", "outfit": "平时穿的英文标签", "gender": "female 或 male"}'
)
SFW_NOTE = "这张卡只画全年龄:nsfw 一律写 false,不要写任何色情或裸露的标签。"
# 镜头(插件页「镜头」,10-12 用户定默认第一人称):由代码加在说明书后面,玩家改说明书也照样生效
_POV_HOW = (
    "people 里不要写玩家;她看着玩家写 looking at viewer;玩家的手入镜时(牵手、摸头、递东西、喂食、被她拉着走)"
    "在 scene 里写 pov hands 和手在做什么(holding hands、headpat、incoming food);"
    "不要写 from side、from behind 这类从旁边看的镜头"
)
CAMERA_NOTES = {
    "pov": f"镜头:第一人称 —— 画面就是玩家的眼睛。{_POV_HOW}。pov 写 true。",
    "third": "镜头:第三人称 —— 玩家出现时写进 people(用玩家的名字),不要写 pov。pov 写 false。",
    "auto": (
        "镜头你来挑:一对一、她对着玩家的时刻(看着你、喂你、牵手、摸头、凑过来)用第一人称:pov 写 true,"
        f"{_POV_HOW};两个人的身体都要入镜时(背后抱、并肩走的远景、从侧面看接吻)用第三人称:pov 写 false,玩家写进 people。"
    ),
}
CAMERAS = tuple(CAMERA_NOTES)


class WriterError(Exception):
    def __init__(self, message: str, raw: str = ""):
        super().__init__(message)
        self.message = message
        self.raw = raw


@dataclass(frozen=True)
class Line:
    speaker: str | None
    text: str


@dataclass(frozen=True)
class Who:
    """画面里可能出现的人:名字、性别、平时的样子(只给指导模型参考,别让它重复写)"""

    name: str
    gender: str = "female"
    look: str = ""
    player: bool = False
    outfit: str = ""


@dataclass
class Context:
    cast: list[Who]
    lines: list[Line]
    # 手动:玩家现在看到的这一句;自动:不用
    focus: int | None = None
    place: str = ""
    want: str = ""
    user_text: str = ""
    # 自动:隔了几条回复、上一张画的是什么(手动时 lines 里 focus 后面那几句只用来判断画面到哪一句结束)
    since: int | None = None
    last: str = ""
    sfw_only: bool = False
    # pov 第一人称 / third 第三人称 / auto 指导模型挑
    camera: str = "pov"


@dataclass
class Result:
    plan: Plan
    title: str = ""
    description: str = ""
    draw: bool = True
    at: int | None = None
    # 画面到第几句为止(编号,和 lines 一样);None = 没写,前端按默认句数收
    until: int | None = None
    importance: int = 1
    reason: str = ""
    raw: dict = field(default_factory=dict)


def _speaker(line: Line) -> str:
    return f"{line.speaker}:" if line.speaker else "(旁白)"


def context_text(ctx: Context, mode: str) -> str:
    cast = "、".join(f"{w.name}({'玩家,' if w.player else ''}{'男' if w.gender == 'male' else '女'})" for w in ctx.cast)
    out = [f"画面里可能出现的人:{cast}"]
    for w in ctx.cast:
        if w.look:
            out.append(f"{w.name}的长相(代码会自动加上,不要重复写):{w.look}")
        if w.outfit:
            out.append(f"{w.name}平时穿的(代码会自动加上;穿得不一样时才写 clothes):{w.outfit}")
    if ctx.place:
        out.append(f"现在的地点:{ctx.place}")
    if ctx.user_text:
        out.append(f"玩家刚说:{ctx.user_text}")
    if mode == "auto":
        if ctx.since is None:
            out.append("这段对话还没出过图。")
        else:
            out.append(f"上一张图在 {ctx.since} 条回复以前" + (f",画的是:{ctx.last}" if ctx.last else "") + "。")
        out.append("\n这条回复(按句编号):")
        out += [f"{i}. {_speaker(line)}{line.text}" for i, line in enumerate(ctx.lines)]
    else:
        out.append("\n剧情(按句编号;「[>]」是玩家现在看到的这一句,画它;后面几句只用来判断画面到哪一句结束,不要画进去):")
        for i, line in enumerate(ctx.lines):
            mark = "[>] " if i == ctx.focus else ""
            out.append(f"{i}. {mark}{_speaker(line)}{line.text}")
        if ctx.want.strip():
            out.append(f"\n想看什么:{ctx.want.strip()}")
    return "\n".join(out)


def messages_for(
    ctx: Context,
    mode: str,
    skill: str | None = None,
) -> list[ChatMessage]:
    system = (skill or DEFAULT_SKILLS[mode]).strip()
    system += "\n\n" + CAMERA_NOTES.get(ctx.camera, CAMERA_NOTES["pov"])
    if ctx.sfw_only:
        system += "\n\n" + SFW_NOTE
    system += "\n\n" + (FORMAT_AUTO if mode == "auto" else FORMAT_MANUAL)
    user = context_text(ctx, mode)
    return [ChatMessage(role="system", content=system), ChatMessage(role="user", content=user)]


def card_text(card: TavernCard) -> str:
    """写外貌时给模型看的卡:名字、描述(外貌一般写在这里)、性格、场景,太长的截断"""
    parts = [f"名字:{card.name}", f"描述:{card.description[:4000]}"]
    if card.personality.strip():
        parts.append(f"性格:{card.personality[:800]}")
    if card.scenario.strip():
        parts.append(f"场景:{card.scenario[:800]}")
    return "\n".join(parts)


def look_messages(card: TavernCard, skill: str | None = None) -> list[ChatMessage]:
    system = (skill or SKILL_LOOK).strip() + "\n\n" + FORMAT_LOOK
    return [ChatMessage(role="system", content=system), ChatMessage(role="user", content=card_text(card))]


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


def parse_json(text: str) -> dict:
    """模型回的那段里找出一个 JSON 对象:去掉代码块、取第一个 { 到最后一个 }"""
    t = _FENCE.sub("", text.strip())
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end <= start:
        raise WriterError("指导模型回的不是 JSON", text[:300])
    try:
        data = json.loads(t[start : end + 1])
    except ValueError as e:
        raise WriterError(f"指导模型回的 JSON 解析不了:{e}", text[:300]) from e
    if not isinstance(data, dict):
        raise WriterError("指导模型回的不是一个 JSON 对象", text[:300])
    return data


def _text(v) -> str:
    if isinstance(v, list):
        return ", ".join(str(x).strip() for x in v if str(x).strip())
    return str(v).strip() if v is not None else ""


def _int(v, default: int | None) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _bool(v) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("true", "yes", "1", "是")
    return bool(v)


def to_result(
    data: dict,
    *,
    mode: str,
    n_lines: int = 0,
    sfw_only: bool = False,
    camera: str = "pov",
    focus: int | None = None,
) -> Result:
    """校验、补齐:字段类型不对的按能用的读(列表当逗号串、"true" 当真),读不出的给默认值。
    镜头定死第一人称 / 第三人称时 pov 照设置,不看它写的;只有「指导模型挑」时听它的"""
    people: list[Person] = []
    raw_people = data.get("people")
    for p in raw_people if isinstance(raw_people, list) else []:
        if isinstance(p, dict) and _text(p.get("who")):
            people.append(Person(who=_text(p.get("who")), tags=_text(p.get("tags")), clothes=_text(p.get("clothes"))))
        elif isinstance(p, str) and p.strip():
            people.append(Person(who=p.strip()))
    pov = camera == "pov" or (camera == "auto" and _bool(data.get("pov")))
    nsfw = _bool(data.get("nsfw"))
    plan = Plan(scene=_text(data.get("scene")), people=tuple(people[:MAX_PEOPLE]), nsfw=nsfw and not sfw_only, pov=pov)
    result = Result(plan=plan, title=_text(data.get("title"))[:20], description=_text(data.get("description")), raw=data)
    if mode == "auto":
        result.draw = _bool(data.get("draw"))
        at = _int(data.get("at"), None)
        result.at = None if at is None else max(0, min(at, max(n_lines - 1, 0)))
        result.importance = max(1, min(_int(data.get("importance"), 1) or 1, 3))
        result.reason = _text(data.get("reason"))
    # 结束句不能早于开始那句(自动是 at,手动是玩家看到的那句)、不能超出给它看的句子
    start = (result.at if mode == "auto" else focus) or 0
    until = _int(data.get("until"), None)
    if until is not None and n_lines > 0:
        result.until = max(start, min(until, n_lines - 1))
    if result.draw and not plan.scene and not plan.people:
        raise WriterError("指导模型没写画面(scene 和 people 都是空的)", json.dumps(data, ensure_ascii=False)[:300])
    return result


def _with_thinking(conn: ApiConnection, thinking: str | None) -> ApiConnection:
    """同一个连接、换一种思考设置(不进库,只用来发这一次)"""
    return ApiConnection(
        id=conn.id,
        name=conn.name,
        api_type=conn.api_type,
        base_url=conn.base_url,
        api_key=conn.api_key,
        model=conn.model,
        thinking=thinking,
    )


async def ask(conn: ApiConnection, messages: list[ChatMessage], thinking: str | None = "off") -> tuple[str, int]:
    """问一次,返回 (回的原文, 毫秒)。thinking 是 "conn" 时照连接自己的设置;关思考被拒时退回连接自己的再问一次"""
    if conn.api_type != "mock" and not conn.model:
        raise LLMError(f"连接「{conn.name}」还没有填写模型名")
    started = time.perf_counter()
    first = conn if thinking == "conn" or thinking == conn.thinking else _with_thinking(conn, thinking)
    try:
        text = await provider_for(first).complete(messages, conn.model)
    except LLMError:
        if first is conn:
            raise
        text = await provider_for(conn).complete(messages, conn.model)
    return text, round((time.perf_counter() - started) * 1000)
