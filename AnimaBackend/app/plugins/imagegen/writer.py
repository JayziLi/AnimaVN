"""指导模型:读剧情,写这一幕画什么(场景、每个人这一刻的长相衣服和动作表情)。自动出图时它也是导演,顺便判要不要出。
每条回复写完还让它记一次状态笔记(每个人现在的长相、衣服、特殊的地方,到现在发生了什么),下一张图照着画。

发给它的话分三段:说明书(玩家能改,插件页「高级」)+ 镜头、字段和输出格式(写死在这里,改说明书也不会把格式改坏)+ 这次的剧情。
默认关思考(10-09 实测:Haiku 5.5 开着思考一次 3.6–4.8 秒,关掉 1.2–1.5 秒;DeepSeek flash 关思考约 1.25 秒);
连接不认「关思考」时(有的模型关不掉)退回连接自己的思考设置再试一次。
设计:docs/superpowers/specs/2026-10-22-imagegen-state-notes-design.md
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

# 10-18 改成「给这场戏拍一张 CG」:用户嫌以前像给某一句配插图、没有导演感(构图平、总是中景、两人并排)。
# 10-22 用户改了一版:开头强调分镜和讲故事,「怎么拍」分点写,「上一张」只说接上它
_ROLE = "你是视觉小说的 CG 导演，负责分镜和画面设计，用一张图把故事讲好。"
_SERIES = "用户消息里写了上一张 CG 画的是什么：这张要和它连得上（地点、衣服、光线一致），景别和构图换一换。"
_HOW = (
    "怎么拍：\n"
    "1. 先在 description 里用两三句中文写分镜：这一刻是什么情绪，画面重点是什么。\n"
    "2. 景别跟着情绪走：要看清表情就靠近，要让环境说话就拉远；别总是中景，别总让两人左右并排。\n"
    "3. 用机位、站位、光线和前后景的虚实，表现人物的关系和距离。\n"
    "4. 画整场戏的情绪，不要把某一句台词照字面画出来。\n"
    "5. 主体是人，别让小道具或大背景抢戏。"
)


def _manual() -> str:
    # 10-18 用户:点画笔「不是完全这一句,而是这一段附近的重要的画面内容」;重要的那一拍在还没读到的后几句里也画
    return (
        f"{_ROLE}\n"
        "玩家读到「[>]」那一句时点了「画」：为这一段剧情选出最重要、最打动人的画面，可以是它前后附近的那一拍；"
        "玩家写了「想看什么」就照它画。\n"
        f"{_SERIES}\n\n{_HOW}"
    )


def _auto(when: str, top: str) -> str:
    return (
        f"{_ROLE}\n"
        "读完这条按句编号的回复，决定要不要配一张 CG；要配，就选出这场戏最打动人的一刻。\n"
        f"什么时候出图：{when}或玩家明说想看时。普通闲聊、和上一张差不多的场面不出，拿不准也不出。\n"
        f"importance：3 = 很重要，如第一次到某地、第一次身体接触、告白、{top}玩家明说想看；2 = 值得出；1 = 可出可不出。\n"
        f"{_SERIES}\n\n{_HOW}"
    )


SKILL_MANUAL = _manual()
SKILL_AUTO = _auto("情绪浓烈、关系推进、有氛围的新地点、换装", "")

SKILL_LOOK = """根据角色卡,写这个角色平时的外貌,给 NovelAI(动漫画风的生图模型)用。
只要英文 danbooru 标签,逗号隔开,分三栏:
- name_tag 角色名:如果是已有游戏、动漫、小说里的角色,写 danbooru 的角色标签(比如 keqing (genshin impact)、
  amiya (arknights)、tendou alice (blue archive)),NovelAI 认得这些角色;原创角色空着;
- tags 长相:年龄感(成年写 adult)、发色、发型、刘海、发饰、瞳色、身材;
- outfit 平时穿的:衣服、鞋、配饰。
不要写表情、动作、地点、性格。"""

# 10-22 用户:每条回复写完总结一次角色状态(外貌、衣服、特殊的地方)和发生了什么,下一张图照它画。
# 推断那句是 10-22 实测加的:Wikira 涂脚趾甲那段没明说脱了袜子,笔记照参考抄了 pantyhose,画出来又光脚又穿连裤袜
SKILL_NOTE = """你给视觉小说的 CG 导演记笔记：读上一次的笔记、玩家这次说的话和这条回复，写出这条回复结束时每个人的样子、在哪、到目前为止发生了什么。下一张 CG 照这份笔记画，长相和穿着一定要写准。
- 每个人（只写给定的人）写：look 这一刻的长相（发型、发色、发饰、瞳色、身材、妆容）；clothes 这一刻身上穿戴的全部（光脚、脱掉的也写）；notes 和平时不一样的地方、身上的痕迹、手里拿的、位置和姿势，变了的写「（变了：……）」，没有就空着。
- look 只写长相，不写表情；clothes 只写身上穿戴的，不写手里拿的。
- 看不到的变化按剧情推断：在按脚、涂脚指甲就是光着脚，洗完澡头发是湿的。
- 上一次笔记里的变化，这条回复没改回来的继续保留；没变化的照参考写。
- place：在哪、白天还是晚上、光线。
- story：之前的经过加上这条回复，三到五句，写到这条回复结束为止。
- look、clothes 用英文 danbooru 标签，逗号隔开；notes、place、story 用中文。"""

DEFAULT_SKILLS = {"manual": SKILL_MANUAL, "auto": SKILL_AUTO, "look": SKILL_LOOK, "note": SKILL_NOTE}

# 字段和输出格式写死(10-22 用户:字段约定简单些,强调格式;镜头放在字段前面)。
# 10-22 起不问 nsfw:要不要加 nsfw 标签由代码看标签定(assemble.explicit)
_FIELDS = (
    "- until：画面持续到第几句。换地方、换姿势、换衣服、有人来去时写变化的前一句，没变就写最后一句。\n"
    "- composition：一句全英文，写清镜头、人物位置与关系、动作、光线。\n"
    "- scene：景别、机位、环境、光影、景深。\n"
    "- people：画面里出现的人，who 只能用给定的名字，没人写 []。每人写 look（这一刻的长相）、"
    "clothes（这一刻身上穿戴的全部，光脚、脱掉的也写）、tags（姿势、动作、表情、视线、互动）。\n"
    "- 除了 description 和 title，都用英文 danbooru 标签，逗号隔开。长相和衣服代码不会补，没写就画不出来；"
    "角色名标签代码会加，不用写。"
)
_PICTURE_FIELDS = """  "description": "两三句中文分镜",
  "title": "四到八个字的中文短名",
  "composition": "One English sentence describing the whole picture.",
  "scene": "英文标签",
  "people": [{"who": "给定的名字", "look": "英文标签", "clothes": "英文标签", "tags": "英文标签"}]"""
_AUTO_HEAD = """  "draw": true,
  "importance": 2,
  "reason": "一句中文说明为什么出图",
  "at": 0,
"""


def format_for(mode: str, camera: str) -> str:
    """字段和输出格式(写死,改说明书也改不坏)。pov 只在「指导模型挑」镜头时让它写
    (10-18:定死第三人称时示例里还写着 pov true,自相矛盾)"""
    fields = ("- at：这一刻从第几句开始。\n" if mode == "auto" else "") + _FIELDS
    out = f"字段：\n{fields}\n\n只输出一个 JSON，不要代码块或其他文字，按这个顺序：\n{{\n"
    out += (_AUTO_HEAD if mode == "auto" else "") + '  "until": 0,\n' + _PICTURE_FIELDS
    out += ',\n  "pov": false\n}' if camera == "auto" else "\n}"
    if mode == "auto":
        out += "\ndraw 为 false 时，只输出 draw、importance、reason 三个字段。"
    return out


FORMAT_LOOK = (
    '只输出一个 JSON,不要代码块、不要别的字:\n'
    '{"name_tag": "角色名标签,原创角色空串", "tags": "长相的英文标签", "outfit": "平时穿的英文标签", "gender": "female 或 male"}'
)
FORMAT_NOTE = (
    "只输出一个 JSON，不要代码块或其他文字：\n"
    '{"place": "中文", "people": [{"who": "给定的名字", "look": "英文标签", "clothes": "英文标签", "notes": "中文"}], "story": "中文"}'
)
SFW_NOTE = "这张卡只画全年龄：不要写任何色情或裸露的标签。"
# 镜头(插件页「镜头」,10-12 用户定默认第一人称):由代码加在说明书后面,玩家改说明书也照样生效。
# 10-22 用户:第一人称不提手(一提手,每张都画手)
_POV_HOW = "people 里不写玩家；她看着玩家时写 looking at viewer"
CAMERA_NOTES = {
    "pov": f"镜头：第一人称，画面就是玩家的眼睛。{_POV_HOW}；不要用 from side、from behind 这类从旁边看的镜头。",
    "third": "镜头：第三人称。玩家出现时写进 people（用玩家的名字）。",
    "auto": (
        f"镜头你来挑：一对一、她对着玩家的时刻用第一人称（pov 写 true）：{_POV_HOW}；"
        "两个人的身体都要入镜时（背后抱、并肩走的远景、从侧面看接吻）用第三人称（pov 写 false），玩家写进 people。"
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
    """画面里可能出现的人:名字、性别、平时的样子(给指导模型当参考)"""

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
    # 这一张里每个人穿的(「星绘穿 pajamas」)
    clothes: str = ""


@dataclass(frozen=True)
class NotePerson:
    who: str
    look: str = ""
    clothes: str = ""
    # 和平时不一样的地方(中文)
    notes: str = ""


@dataclass(frozen=True)
class Note:
    """状态笔记:一条回复结束时每个人的样子、在哪、到那时为止发生了什么"""

    place: str = ""
    people: tuple[NotePerson, ...] = ()
    story: str = ""


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
    # 上一条回复结束时的状态笔记;没有(老对话、第一条回复)是 None
    note: Note | None = None
    sfw_only: bool = False
    # pov 第一人称 / third 第三人称 / auto 指导模型挑
    camera: str = "pov"


@dataclass
class NoteContext:
    cast: list[Who]
    lines: list[Line]
    # 上一次的笔记;没有是 None
    prev: Note | None = None
    place: str = ""
    user_text: str = ""


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


def _numbered(lines: list[Line], focus: int | None = None) -> list[str]:
    return [f"{i}. {'[>] ' if i == focus else ''}{_speaker(line)}{line.text}" for i, line in enumerate(lines)]


def _cast_text(cast: list[Who]) -> str:
    return "、".join(f"{w.name}({'玩家,' if w.player else ''}{'男' if w.gender == 'male' else '女'})" for w in cast)


def _note_text(note: Note) -> list[str]:
    out = [f"地点:{note.place}"] if note.place else []
    for p in note.people:
        out.append(f"{p.who} —— 长相:{p.look or '(没写)'}")
        out.append(f"  衣服:{p.clothes or '(没写)'}")
        if p.notes:
            out.append(f"  特殊:{p.notes}")
    return out


def _reference_text(cast: list[Who], changes: str) -> list[str]:
    rows = []
    for w in cast:
        if w.look:
            rows.append(f"{w.name} 的参考长相(平时的样子):{w.look}")
        if w.outfit:
            rows.append(f"{w.name} 的参考衣服(平时的样子):{w.outfit}")
    if not rows:
        return []
    return ["", "出场人物参考描述:", *rows, f"(参考只是平时的样子。{changes}都要照着改,别照抄参考。)"]


def _drawn_text(ctx: Context, mode: str) -> list[str]:
    if not ctx.drawn:
        return []
    # 10-22 用户:「强调上一张是这个就好」:只有上一张时一句话说完
    if len(ctx.drawn) == 1 and ctx.drawn[0].line is None:
        d = ctx.drawn[0]
        return ["", f"上一张 CG:【{d.title}】{d.description}" + (f"({d.clothes})" if d.clothes else "")]
    out = ["", "已经画过的 CG:"]
    n = len(ctx.lines)
    for d in ctx.drawn:
        if d.line is None:
            where = "上一张(上一条回复)"
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
    """用户消息:谁可能出现 → 上一条回复结束时的状态 → 前情和这一条(上下文)→ 画过的图 → 参考 → 想看什么"""
    out = [f"画面里可能出现的人:{_cast_text(ctx.cast)}"]
    if ctx.note is not None:
        out += ["", "角色现在的状态(上一条回复结束时):", *_note_text(ctx.note)]
    out.append("")
    if ctx.note is not None and ctx.note.story:
        out.append(f"前情:{ctx.note.story}")
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
        out += ["这条回复(按句编号):", *_numbered(ctx.lines)]
    else:
        out += ["剧情(按句编号;「[>]」是玩家现在读到的这一句):", *_numbered(ctx.lines, ctx.focus)]
    out += _drawn_text(ctx, mode)
    out += _reference_text(ctx.cast, "状态里记着的变化、这段剧情里的新变化")
    if mode == "manual" and ctx.want.strip():
        out += ["", f"想看什么:{ctx.want.strip()}"]
    return "\n".join(out)


def messages_for(
    ctx: Context,
    mode: str,
    skill: str | None = None,
) -> list[ChatMessage]:
    """system:说明书 → 镜头 → (只画全年龄)→ 字段和格式;user:剧情"""
    system = (skill or DEFAULT_SKILLS[mode]).strip()
    system += "\n\n" + CAMERA_NOTES.get(ctx.camera, CAMERA_NOTES["pov"])
    if ctx.sfw_only:
        system += "\n\n" + SFW_NOTE
    system += "\n\n" + format_for(mode, ctx.camera)
    user = context_text(ctx, mode)
    return [ChatMessage(role="system", content=system), ChatMessage(role="user", content=user)]


def note_messages(ctx: NoteContext, skill: str | None = None) -> list[ChatMessage]:
    """记状态笔记:上一次的笔记 + 背景图 + 玩家这次说的 + 这条回复 + 参考"""
    out = [f"会出现的人:{_cast_text(ctx.cast)}", ""]
    if ctx.prev is not None:
        out += ["上一次的笔记:", *_note_text(ctx.prev)]
        if ctx.prev.story:
            out.append(f"前情:{ctx.prev.story}")
    else:
        out.append("上一次的笔记:还没有,这是第一次。")
    out.append("")
    if ctx.place:
        out.append(f"背景图:{ctx.place}")
    if ctx.user_text:
        out.append(f"玩家这次说:{ctx.user_text}")
    out += ["这条回复(按句编号):", *_numbered(ctx.lines)]
    out += _reference_text(ctx.cast, "上一次笔记里的变化、这条回复里的新变化")
    system = (skill or SKILL_NOTE).strip() + "\n\n" + FORMAT_NOTE
    return [ChatMessage(role="system", content=system), ChatMessage(role="user", content="\n".join(out))]


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
    镜头定死第一人称 / 第三人称时 pov 照设置,不看它写的;只有「指导模型挑」时听它的。
    每个人的 look 一律是字符串(没写是空串):None 只留给 10-22 以前存的老画面(拼提示词时照老规矩补长相)"""
    people: list[Person] = []
    raw_people = data.get("people")
    for p in raw_people if isinstance(raw_people, list) else []:
        if isinstance(p, dict) and _text(p.get("who")):
            people.append(
                Person(
                    who=_text(p.get("who")),
                    tags=_text(p.get("tags")),
                    clothes=_text(p.get("clothes")),
                    look=_text(p.get("look")),
                )
            )
        elif isinstance(p, str) and p.strip():
            people.append(Person(who=p.strip(), look=""))
    pov = camera == "pov" or (camera == "auto" and _bool(data.get("pov")))
    nsfw = False
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


def to_note(data: dict) -> Note:
    """状态笔记:字段类型不对的按能用的读;一个人都没写、也没写经过的算没记成"""
    people: list[NotePerson] = []
    raw_people = data.get("people")
    for p in raw_people if isinstance(raw_people, list) else []:
        if isinstance(p, dict) and _text(p.get("who")):
            people.append(
                NotePerson(
                    who=_text(p.get("who"))[:80],
                    look=_text(p.get("look"))[:1000],
                    clothes=_text(p.get("clothes"))[:1000],
                    notes=_text(p.get("notes"))[:600],
                )
            )
    note = Note(place=_text(data.get("place"))[:300], people=tuple(people[:MAX_PEOPLE]), story=_text(data.get("story"))[:1200])
    if not note.people and not note.story:
        raise WriterError("指导模型没记下状态(people 和 story 都是空的)", json.dumps(data, ensure_ascii=False)[:300])
    return note


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
