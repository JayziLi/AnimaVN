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

# 10-18 改成「给这场戏拍一张 CG」:用户嫌以前像给某一句配插图、没有导演感(构图平、总是中景、两人并排);
# 说明书只讲想要什么样的 CG,不列规则和词表(用户:「描述清楚需求就好,不需要太严格的限制」,初稿交给 GPT 压短)。
# 先写中文分镜(description)再写英文:一句英文构图(composition,NovelAI V4.5 读得懂句子,谁站在哪也写在这里)+ 标签。
# 不让它写坐标:10-18 试过,两个人常被挤在一起画糊(nai.py 的 use_coords)
_HOW = (
    "怎么拍：先用 description 写两三句中文分镜，想清楚这一刻的情绪和视觉重点，再写英文描述与标签。"
    "根据情绪选择景别、机位、人物位置、光线和前后景的虚实，让构图表现人物的关系与距离。"
    "需要看清表情时靠近，需要环境承载情绪时拉开，不必总用中景或让两人左右并排。"
    "画面服务于整场戏，不要把某句话逐字画出来，也不要让无关的小物件或宏大背景抢走主体。"
)
_UNTIL = (
    "until 是显示结束的句号编号。换地方、换姿势、换衣服或有人来去时，写变化前一句；一直没变写最后一句。"
    "说话、表情和手上的小动作不算变化。"
)
_FIELDS = (
    "- composition 用一句英文自然语言描述整张画面的镜头、人物在画面里的位置与关系、动作和光线；"
    "scene 用英文 danbooru 标签写景别、机位、环境、光影与景深；人物 tags 写姿势、动作、表情、视线和互动。"
    "标签用逗号隔开，与分镜保持一致。\n"
    "- people 只列画面中出现的人，who 只能用给定的名字；无人风景写 []。\n"
    "- 不写头发、眼睛、身材，代码会自动补充。衣服和平时一样时 clothes 写空字符串；不一样时，用英文标签写这一刻的全部穿着。"
)
# 10-18 用户:「要知道之后画了什么、前面画了什么,这样大概能出一个连续的图」:用户消息里列出前后画过的图
_SERIES = (
    "用户消息里会列出前后已经画过的图：让这张和它们连得上（地点、衣服、光线一致），像同一组 CG 里的一张，"
    "景别和构图别和它们重复。"
)


def _manual(nsfw: str) -> str:
    # 10-18 用户:点画笔「不是完全这一句,而是这一段附近的重要的画面内容」;重要的那一拍在还没读到的后几句里也画
    return (
        "你是视觉小说的 CG 导演。玩家读到「[>]」那一句时点了「画」：为这一段剧情选出最重要、最打动人的画面，"
        "设计一张值得留下的 CG。不一定是「[>]」这一句本身，可以是它前后附近的那一拍。"
        "玩家写了「想看什么」时以它为准。\n"
        f"{_SERIES}\n\n"
        f"{_HOW}\n\n字段约定：\n- {_UNTIL}\n{_FIELDS}\n- {nsfw}"
    )


def _auto(when: str, top: str, nsfw: str) -> str:
    return (
        "你是视觉小说的 CG 导演。读完整条按句编号的回复，决定是否配一张 CG；要出图，就为这场戏选出最打动人的一刻，"
        "设计一张值得玩家留下的画面。\n"
        f"{_SERIES}\n\n"
        f"什么时候出图：{when}或玩家明说想看时，考虑出图。普通闲聊、和上一张 CG 差不多的场面不出，拿不准也不出。"
        f"importance：3 = 很重要，如第一次到某地、第一次身体接触、告白、{top}玩家明说想看；2 = 值得出；1 = 可出可不出。\n\n"
        f"{_HOW}\n\n字段约定：\n- at 是选中这一刻开始的句号编号；{_UNTIL}\n{_FIELDS}\n- {nsfw}"
    )


_NSFW = "nsfw：画面里有裸露写 true，否则写 false。"
SKILL_MANUAL = _manual(_NSFW)
SKILL_AUTO = _auto("情绪浓烈、关系推进、有氛围的新地点、换装", "", _NSFW)

SKILL_LOOK = """根据角色卡,写这个角色平时的外貌,给 NovelAI(动漫画风的生图模型)用。
只要英文 danbooru 标签,逗号隔开,分三栏:
- name_tag 角色名:如果是已有游戏、动漫、小说里的角色,写 danbooru 的角色标签(比如 keqing (genshin impact)、
  amiya (arknights)、tendou alice (blue archive)),NovelAI 认得这些角色;原创角色空着;
- tags 长相:年龄感(成年写 adult)、发色、发型、刘海、发饰、瞳色、身材;
- outfit 平时穿的:衣服、鞋、配饰。
不要写表情、动作、地点、性格。"""

DEFAULT_SKILLS = {"manual": SKILL_MANUAL, "auto": SKILL_AUTO, "look": SKILL_LOOK}

_PICTURE_FIELDS = """  "description": "两三句中文分镜，说明选中的瞬间、情绪及画面安排",
  "title": "四到八个字的中文短名",
  "composition": "One English sentence describing the whole picture.",
  "scene": "英文 danbooru 标签，逗号隔开",
  "people": [{"who": "给定的名字", "tags": "英文 danbooru 标签，逗号隔开", "clothes": ""}],
  "nsfw": false"""
_AUTO_HEAD = """  "draw": true,
  "importance": 2,
  "reason": "一句中文说明为什么出图",
  "at": 0,
"""


def format_for(mode: str, camera: str) -> str:
    """输出格式(写死,改说明书也改不坏)。pov 只在「指导模型挑」镜头时让它写
    (10-18:定死第三人称时示例里还写着 pov true,自相矛盾)"""
    out = "只输出一个 JSON，不要代码块或其他文字。字段按以下顺序排列，description 放在英文画面描述与标签之前：\n{\n"
    out += (_AUTO_HEAD if mode == "auto" else "") + '  "until": 0,\n' + _PICTURE_FIELDS
    out += ',\n  "pov": false\n}' if camera == "auto" else "\n}"
    if mode == "auto":
        out += "\ndraw 为 false 时，只输出 draw、importance、reason 三个字段。"
    return out


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
    "pov": f"镜头:第一人称 —— 画面就是玩家的眼睛。{_POV_HOW}。",
    "third": "镜头:第三人称 —— 玩家出现时写进 people(用玩家的名字),不要写 pov。",
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


@dataclass(frozen=True)
class Drawn:
    """前后已经画过的一张(给指导模型接上连贯):line 是在给它的那段剧情里的编号,
    None = 上一条回复的;小于 0 / 超出这段 = 这条回复里更前 / 更后面"""

    line: int | None
    title: str = ""
    description: str = ""
    # 这一张里谁穿得和平时不一样(「星绘穿 pajamas」)
    clothes: str = ""


@dataclass
class Context:
    cast: list[Who]
    lines: list[Line]
    # 手动:玩家现在读到的这一句;自动:不用
    focus: int | None = None
    place: str = ""
    want: str = ""
    user_text: str = ""
    # 自动:隔了几条回复、上一张画的是什么(没传 drawn 的旧前端才用 last)
    since: int | None = None
    last: str = ""
    # 前后已经画过的图
    drawn: list[Drawn] = field(default_factory=list)
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


def _drawn_text(ctx: Context, mode: str) -> list[str]:
    if not ctx.drawn:
        return []
    out = ["\n前后已经画过的图:"]
    n = len(ctx.lines)
    for d in ctx.drawn:
        if d.line is None:
            where = "上一条回复"
        elif d.line < 0:
            where = "这条回复更前面"
        elif d.line >= n:
            where = "这条回复更后面"
        elif mode == "manual" and ctx.focus is not None and d.line != ctx.focus:
            where = f"第 {d.line} 句(在玩家读到的这句{'前面' if d.line < ctx.focus else '后面'})"
        else:
            where = f"第 {d.line} 句"
        out.append(f"- {where}:【{d.title}】{d.description}" + (f"({d.clothes})" if d.clothes else ""))
    return out


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
            last = f",画的是:{ctx.last}" if ctx.last and not ctx.drawn else ""
            out.append(f"上一张图在 {ctx.since} 条回复以前{last}。")
        out.append("\n这条回复(按句编号):")
        out += [f"{i}. {_speaker(line)}{line.text}" for i, line in enumerate(ctx.lines)]
        out += _drawn_text(ctx, mode)
    else:
        out.append("\n剧情(按句编号;「[>]」是玩家现在读到的这一句):")
        for i, line in enumerate(ctx.lines):
            mark = "[>] " if i == ctx.focus else ""
            out.append(f"{i}. {mark}{_speaker(line)}{line.text}")
        out += _drawn_text(ctx, mode)
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
    system += "\n\n" + format_for(mode, ctx.camera)
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
    plan = Plan(
        scene=_text(data.get("scene")),
        people=tuple(people[:MAX_PEOPLE]),
        nsfw=nsfw and not sfw_only,
        pov=pov,
        composition=_text(data.get("composition"))[:600],
    )
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
