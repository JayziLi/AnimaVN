"""Jev 标注:切好的一条回复 → 每句谁说的、什么表情、场景和音乐换没换、画面上该不该出 CG。

每个插件(立绘 / 背景 / BGM / CG / 玩家台词)可以选「AI 写标签」或「Jev 标」。Jev 模式的那几类,
LLM 不再写标签;前端每写完一句就把它(连同这条回复前面的句子)发过来,这里出题给 Jev
(TypeSafe 的判断模型),再按门槛把答案变成标注。标签由前端照标注缝回正文。
设计见 docs/superpowers/specs/2026-10-01-jev-director-design.md

每句问什么看句子类型和哪些插件是 Jev 模式:
  切句认成主角的引号台词  s 谁说的(立绘或玩家台词是 Jev)、e 什么表情(立绘是 Jev)、
                          t 这句的档(ask_tone,卡带登记的两档门槛题,见 register_tone)
  第一句和旁白            bg 现在在哪个场景(背景是 Jev)、bgm 放哪首(BGM 是 Jev),选项里都有「不换」
  每一句                  cg 画面上该是哪张 CG(CG 是 Jev),选项有「不换」「不显示CG」和每张 CG
「名字:」开头的别人的台词不问。一条回复里场景、音乐各最多换一次:换过以后前端会带上
bg_changed / bgm_changed,就不再问了(逐句问气氛会在几首之间来回跳)。CG 不限次数:
姿势、玩法一条回复里可能换好几回。

CG 的判法是 2026-10-03 拿一部原作游戏的 CG 时间线(4847 句)测出来的:给 Jev 当前地点、
问「这一刻的整体情况」而不是「这一句」、几张相似的 CG 把握加起来算,严格准确率 74.5%。

问法(提示词)可以在插件页改,这里存默认的;门槛也可以调。
"""

from dataclasses import dataclass, field

from app.contracts import SPEAKER_THRESHOLD, SWITCH_THRESHOLD

# 「不换」选项的名字。场景包里真有叫这个名字的,换成 KEEP_FALLBACK
KEEP = "不换"
KEEP_FALLBACK = "保持现在的"
# CG 题里「收起 CG、回到立绘和背景」的选项名;和 CG 重名时换成 CG_OFF_FALLBACK
CG_OFF = "不显示CG"
CG_OFF_FALLBACK = "收起CG"

PREV_MAX = 800
SNIPPET = 50
# 长回复只带要判的句子前面这么多句:每句都带整条回复的话,费用随句数平方涨
CONTEXT_LINES = 24
# 改过的提示词每段最长这么多字
PROMPT_MAX = 500

# 默认问法。2026-10-01 在 93 条真实回复上测过(数据在设计文档第九节)。
# 占位符:{{char}} {{user}} {{n}} 第几句 {{line}} 这句(截前 50 字)
#        {{current}} 现在的背景 / 曲子 {{current_desc}} 它的说明(带括号,没有就是空)
DEFAULT_PROMPTS: dict[str, str] = {
    "state": "视觉小说里 AI 刚写的一条回复,已经切成一句一句。主角是「{{char}}」,玩家是「{{user}}」(旁白里的「你」指的也是玩家)。",
    # 带了上一条回复时接在通用说明后面(2026-10-15 在两个游戏 6 个角色的剧本上测过,
    # 「谁说的」判对 59.6% → 68.8%,见 specs/2026-10-15-jev-previous-reply-ab.md)
    "before": "「上一条回复的最后几句」是这条回复之前、剧情接着往下的那一段,只用来了解前情,不用判。",
    "speaker":"第 {{n}} 句 {{line}} 是谁说的?",
    "speaker_char": "{{char}}本人说出口的话",
    "speaker_user": "玩家「{{user}}」说的话(旁白里写「你说」「你对她说」的那句)",
    "speaker_other": "{{char}}以外的其他角色说的话",
    "speaker_none": "不是有人在说话:心里想的、转述或引用的话、写在东西上的字、强调某个词",
    "emotion": "第 {{n}} 句 {{line}} 说出口的这一刻,{{char}}脸上是什么表情?结合前后文里情绪的起伏来判断,不要只看这句的字面。",
    "bg": "写到第 {{n}} 句时,人物在哪个场景?地点和白天、夜晚都要对上。还在「{{current}}」就选「不换」;只是提到、回忆、打算去某个地方也选「不换」。",
    "bg_keep": "还在「{{current}}」{{current_desc}}:没换地方,白天夜晚也没变",
    "bgm": "第 {{n}} 句这一刻的气氛,最适合放哪首背景音乐?和现在这首「{{current}}」还搭就选「不换」;气氛只是稍有起伏也选「不换」,明显转变(比如闲聊转为紧张、热闹转为伤感)才换。",
    "bgm_keep": "现在这首「{{current}}」{{current_desc}}还合适",
    # CG 看的是这一刻的整体情况:场面还在进行时,这句只是在说话也照样显示;先对正在发生的事,细节只作参考。
    # 私有版的说法在 private-defaults 卡带里(app/plugins/private_defaults.py)
    "cg": "写到第 {{n}} 句时,{{char}}和{{user}}在哪里、正在做什么?画面上应该显示哪张 CG?看的是这一刻的整体情况,"
    "不是只看这一句:CG 里的场面(比如一起看烟花、在海边散步)还在进行时,即使这一句只是在说话、在想事情,也照样显示对应的 CG。"
    "先对场面和动作:在哪里、在做什么、有谁在场、人物是什么姿势。"
    "衣着和小细节只是参考,对不上也可以用场面最接近的那张。"
    "只是说要去做、还在准备还不算;事情已经开始了,就选场面最接近的那张。"
    "现在的画面还对得上就选「不换」;场面变了、动作变了才换别的 CG;"
    "这段场面结束了、回到日常了,或者正在发生的事和哪张 CG 都对不上,才选「不显示CG」。",
    "cg_keep": "现在的画面「{{current}}」还对得上",
    "cg_off": "不显示 CG,回到立绘和背景:这段场面结束了,或者正在发生的事和哪张 CG 都对不上",
}


@dataclass(frozen=True)
class TwoLevel:
    """「两档门槛」题(素材架构设计 2.2 的通用题型):每句二选一,第一档的把握到 min_first 就算第一档(不用过半);
    没给概率时只信选中的那项。问法、两档的说明都是 DEFAULT_PROMPTS 里的键,插件页能改"""

    first: str
    second: str
    min_first: float
    # 问法的键:题目、第一档的说明、第二档的说明
    prompt: str
    first_prompt: str
    second_prompt: str


# 卡带登记的「这句的档」题:请求里 ask_tone、而且是角色的台词时才问,答案写进 LineDecision.tone。
# 没有卡带登记时不问(ask_tone 当没传)
_tone: TwoLevel | None = None


def register_prompts(prompts: dict[str, str]) -> None:
    """卡带加载时调:加几段默认问法,或者换掉内核的(私有版的说法);键的先后不变。可以重复调"""
    DEFAULT_PROMPTS.update(prompts)


def register_tone(question: TwoLevel | None, prompts: dict[str, str] | None = None) -> None:
    """卡带加载时调:登记「这句的档」题,连同它的默认问法(加进 DEFAULT_PROMPTS)。可以重复调"""
    global _tone
    _tone = question
    register_prompts(prompts or {})


def tone_question() -> TwoLevel | None:
    return _tone


@dataclass(frozen=True)
class Thresholds:
    # 默认值(0.8 / 0.6)和可调范围前后端共用,在 app/contracts.py
    # 判成「不是主角说的」要有这么大把握,否则还算主角的(实测判错的置信度大多 ≤0.6,判对的 ≥0.9)
    speaker: float = SPEAKER_THRESHOLD["default"]
    # 选了「不换」以外的场景 / 曲子,把握到这么大才换(实测 0.6 时换得勤又不太乱跳)
    bg: float = SWITCH_THRESHOLD["default"]
    bgm: float = SWITCH_THRESHOLD["default"]
    # CG:几张 CG 的把握加起来到这么多才换 / 「不显示CG」到这么多才收起(见 _cg_decision)
    cg: float = SWITCH_THRESHOLD["default"]


@dataclass(frozen=True)
class Choice:
    label: str
    aliases: tuple[str, ...] = ()
    description: str = ""


@dataclass(frozen=True)
class Line:
    text: str
    # 切句认的说话人:旁白 None,主角的引号台词是主角名字,「名字:」开头的是那个名字
    speaker: str | None


@dataclass(frozen=True)
class SceneState:
    """现在的场景和音乐(回复开始时的,加上这条回复里已经判出来的切换)"""

    bg: str | None = None
    bgm: str | None = None
    # 这条回复里已经换过了:不再问
    bg_changed: bool = False
    bgm_changed: bool = False
    # 现在画面上的 CG(没有是 None)
    cg: str | None = None
    # 现在的地点:背景名和说明(CG 题要用;CG 对不对得上地点很要紧)
    place: str = ""


@dataclass(frozen=True)
class AnnotateInput:
    char: str
    user: str
    prev: str
    # 这条回复到最后一个要判的句子为止
    lines: list[Line]
    targets: list[int]
    # 立绘是 Jev 时才有;没有就不问表情
    emotions: list[Choice]
    # 背景 / BGM 是 Jev 时才有;没有就不问
    bgs: list[Choice]
    bgms: list[Choice]
    # CG 是 Jev 时才有;没有就不问
    cgs: list[Choice] = field(default_factory=list)
    scene: SceneState = field(default_factory=SceneState)
    # 立绘或玩家台词是 Jev 时问「谁说的」
    ask_speaker: bool = True
    # 角色的台词多问一道「这句的档」(卡带登记了才问,见 register_tone)
    ask_tone: bool = False
    thresholds: Thresholds = field(default_factory=Thresholds)
    # 改过的问法(键见 DEFAULT_PROMPTS);没有的用默认
    prompts: dict[str, str] = field(default_factory=dict)
    # 上一条 AI 回复的最后几句(插件页的「带上一条回复」);空 = 不带,请求和以前一字不差
    before: list[Line] = field(default_factory=list)


@dataclass(frozen=True)
class LineDecision:
    index: int
    # 问了才有:char / user / other / none
    speaker: str | None = None
    emotion: str | None = None
    # 只在要换的时候有
    bg: str | None = None
    bgm: str | None = None
    # 换成这张 CG / 收起 CG;都没有 = 画面不变
    cg: str | None = None
    cg_off: bool = False
    # 问了才有:登记的那道题的第一档 / 第二档
    tone: str | None = None
    confidence: dict[str, float] = field(default_factory=dict)


def _snippet(text: str) -> str:
    return text if len(text) <= SNIPPET else text[:SNIPPET] + "…"


def _kind(line: Line, char: str) -> str:
    if line.speaker is None:
        return "旁白"
    if line.speaker == char:
        return "引号里的话"
    return f"{line.speaker}的台词"


def _criteria(items: list[Choice]) -> dict[str, str]:
    out: dict[str, str] = {}
    for c in items:
        desc = c.description.strip() or c.label
        if c.aliases:
            desc += f"(也叫:{'、'.join(c.aliases)})"
        out[c.label] = desc
    return out


def _prompt(inp: AnnotateInput, key: str, **values: str) -> str:
    text = inp.prompts.get(key) or DEFAULT_PROMPTS[key]
    values = {"char": inp.char, "user": inp.user, **values}
    for name, value in values.items():
        text = text.replace("{{" + name + "}}", value)
    return text


def keep_key(items: list[Choice]) -> str:
    """「不换」选项的名字(和素材重名时换一个)"""
    return KEEP_FALLBACK if any(c.label == KEEP for c in items) else KEEP


def cg_off_key(items: list[Choice]) -> str:
    """「不显示CG」选项的名字(和 CG 重名时换一个)"""
    return CG_OFF_FALLBACK if any(c.label == CG_OFF for c in items) else CG_OFF


def _is_dialogue(inp: AnnotateInput, i: int) -> bool:
    return inp.lines[i].speaker == inp.char


def _asks_scene(inp: AnnotateInput, i: int) -> bool:
    return inp.lines[i].speaker is None or i == 0


def _asks_bg(inp: AnnotateInput) -> bool:
    return len(inp.bgs) >= 2 and inp.scene.bg is not None and not inp.scene.bg_changed


def _asks_bgm(inp: AnnotateInput) -> bool:
    # 除了现在放的这首没有别的可换:题目只剩「不换」一个选项,问了也是白花 token
    others = any(c.label != inp.scene.bgm for c in inp.bgms)
    return others and not inp.scene.bgm_changed


def _switch_question(inp: AnnotateInput, kind: str, n: int, items: list[Choice], current: str | None) -> dict:
    """场景 / 音乐:一道选择题,「不换」排第一,现在这个不单列"""
    here = next((c for c in items if c.label == current), None)
    desc = f"({here.description.strip()})" if here and here.description.strip() else ""
    name = current or "没有音乐"
    keep = keep_key(items)
    return {
        "type": "choice",
        "instructions": _prompt(inp, kind, n=str(n), current=name, current_desc=desc),
        "criteria": {
            keep: _prompt(inp, f"{kind}_keep", current=name, current_desc=desc),
            **_criteria([c for c in items if c.label != current]),
        },
    }


def _cg_question(inp: AnnotateInput, n: int, line: str) -> dict:
    """CG:一道选择题。现在有 CG 时「不换」排第一,「不显示CG」第二,现在这张不单列"""
    current = inp.scene.cg
    criteria: dict[str, str] = {}
    if current:
        criteria[keep_key(inp.cgs)] = _prompt(inp, "cg_keep", current=current, current_desc="")
    criteria[cg_off_key(inp.cgs)] = _prompt(inp, "cg_off")
    criteria.update(_criteria([c for c in inp.cgs if c.label != current]))
    return {
        "type": "choice",
        "instructions": _prompt(inp, "cg", n=str(n), line=line),
        "criteria": criteria,
    }


def build_request(inp: AnnotateInput) -> tuple[dict, dict]:
    """返回 (state, questions)。题目名带句号(从 1 数):s3 = 第 3 句谁说的"""
    last = max(inp.targets)
    first = max(0, min(inp.targets) - CONTEXT_LINES)
    intro = _prompt(inp, "state")
    if first > 0:
        intro += f"前面的 {first} 句省略了。"
    state: dict = {"说明": intro}
    if inp.before:
        # 按时间顺序放:上一条回复 → 玩家上一句 → 本条回复
        state["说明"] += _prompt(inp, "before")
        state["上一条回复的最后几句"] = [{"类型": _kind(x, inp.char), "内容": x.text} for x in inp.before]
    state |= {
        "玩家上一句": (inp.prev or "(无)")[:PREV_MAX],
        "本条回复": [
            {"句": i + 1, "类型": _kind(inp.lines[i], inp.char), "内容": inp.lines[i].text}
            for i in range(first, last + 1)
        ],
    }
    if _asks_bg(inp):
        state["现在的场景"] = inp.scene.bg
    if _asks_bgm(inp) and inp.scene.bgm:
        state["现在的背景音乐"] = inp.scene.bgm
    if inp.cgs:
        if inp.scene.place:
            state["现在的地点(背景)"] = inp.scene.place
        here = next((c for c in inp.cgs if c.label == inp.scene.cg), None)
        state["现在的画面"] = (
            f"CG「{here.label}」:{here.description.strip() or here.label}"
            if here
            else "没有 CG(显示立绘和背景)"
        )

    questions: dict = {}
    for i in inp.targets:
        n = i + 1
        line = _snippet(inp.lines[i].text)
        if _is_dialogue(inp, i):
            if inp.ask_speaker:
                questions[f"s{n}"] = {
                    "type": "choice",
                    "instructions": _prompt(inp, "speaker", n=str(n), line=line),
                    "criteria": {
                        who: _prompt(inp, f"speaker_{who}") for who in ("char", "user", "other", "none")
                    },
                }
            if inp.emotions:
                questions[f"e{n}"] = {
                    "type": "choice",
                    "instructions": _prompt(inp, "emotion", n=str(n), line=line),
                    "criteria": _criteria(inp.emotions),
                }
            if inp.ask_tone and _tone is not None:
                questions[f"t{n}"] = {
                    "type": "choice",
                    "instructions": _prompt(inp, _tone.prompt, n=str(n), line=line),
                    "criteria": {
                        _tone.first: _prompt(inp, _tone.first_prompt),
                        _tone.second: _prompt(inp, _tone.second_prompt),
                    },
                }
        if inp.cgs:
            questions[f"cg{n}"] = _cg_question(inp, n, line)
        if not _asks_scene(inp, i):
            continue
        if _asks_bg(inp):
            questions[f"bg{n}"] = _switch_question(inp, "bg", n, inp.bgs, inp.scene.bg)
        if _asks_bgm(inp):
            questions[f"bgm{n}"] = _switch_question(inp, "bgm", n, inp.bgms, inp.scene.bgm)
    return state, questions


def _num(v) -> float:
    """Jev 回的概率 / 把握:不是数(字符串、null)当 0,别让整次标注 500"""
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def _choice(answers: dict, name: str, allowed: set[str]) -> tuple[str | None, float]:
    """(选了哪个, 它的概率)。概率缺了用 confidence"""
    a = answers.get(name)
    # choice 不是字符串(列表、对象)时 in 会抛 unhashable,整次标注 500
    if not isinstance(a, dict) or not isinstance(a.get("choice"), str) or a["choice"] not in allowed:
        return None, 0.0
    c = a["choice"]
    probs = a.get("probabilities") if isinstance(a.get("probabilities"), dict) else {}
    return c, _num(probs.get(c, a.get("confidence")))


def _two_level_decision(q: TwoLevel, answers: dict, name: str) -> tuple[str | None, float]:
    """(第一档 / 第二档, 第一档的把握)。第一档的把握到 q.min_first 就算第一档;没给概率时只信选中的那项"""
    choice, p = _choice(answers, name, {q.first, q.second})
    if choice is None:
        return None, 0.0
    a = answers[name]
    probs = a.get("probabilities") if isinstance(a.get("probabilities"), dict) else {}
    first = probs.get(q.first)
    if not isinstance(first, (int, float)):
        first = p if choice == q.first else 1.0 - p
    first = float(first)
    return (q.first if first >= q.min_first else q.second), first


def _cg_decision(inp: AnnotateInput, answers: dict, name: str) -> tuple[str | None, bool, float]:
    """(换成哪张, 要不要收起, 把握)。

    几张相似的 CG(海边散步 / 海边烟花)会把把握分掉:Jev 明明选对了,每张却只有 0.4,
    单看一张永远过不了门槛。所以「换」看所有别的 CG 的把握加起来,够了就换成其中最高的那张;
    「收起」看「不显示CG」一项。实测这样比只看选中那张多对 2.6 个点(设计文档第五节)"""
    a = answers.get(name)
    if not isinstance(a, dict):
        return None, False, 0.0
    probs = a.get("probabilities") if isinstance(a.get("probabilities"), dict) else {}
    labels = {c.label for c in inp.cgs if c.label != inp.scene.cg}
    off = cg_off_key(inp.cgs)
    if not probs:
        # 没给概率时只信选中的那项
        c = a.get("choice")
        probs = {c: _num(a.get("confidence"))} if isinstance(c, str) else {}
    probs = {k: float(v) for k, v in probs.items() if isinstance(v, (int, float))}
    if probs.get(off, 0.0) >= inp.thresholds.cg:
        return None, inp.scene.cg is not None, probs[off]
    others = {k: v for k, v in probs.items() if k in labels}
    total = sum(others.values())
    if others and total >= inp.thresholds.cg:
        return max(others, key=lambda k: others[k]), False, total
    return None, False, 0.0


def decide(inp: AnnotateInput, answers: dict) -> list[LineDecision]:
    """Jev 的答案 → 每句的标注。没问的、漏答的、答了不认识的名字都当没有。
    一次判好几句时,场景 / 音乐只取最前面那次切换(一条回复各最多换一次)"""
    t = inp.thresholds
    emotions = {c.label for c in inp.emotions}
    bgs = {c.label for c in inp.bgs} | {keep_key(inp.bgs)}
    bgms = {c.label for c in inp.bgms} | {keep_key(inp.bgms)}
    bg_done, bgm_done = not _asks_bg(inp), not _asks_bgm(inp)
    out: list[LineDecision] = []
    for i in sorted(inp.targets):
        n = i + 1
        speaker = emotion = bg = bgm = cg = tone = None
        cg_off = False
        conf: dict[str, float] = {}
        if _is_dialogue(inp, i):
            if inp.ask_speaker:
                who, who_conf = _choice(answers, f"s{n}", {"char", "user", "other", "none"})
                speaker = who if who and who != "char" and who_conf >= t.speaker else "char"
                if who:
                    conf["speaker"] = who_conf
            if inp.emotions and speaker in ("char", None):
                emotion, e_conf = _choice(answers, f"e{n}", emotions)
                if emotion:
                    conf["emotion"] = e_conf
            if inp.ask_tone and _tone is not None and speaker in ("char", None):
                tone, t_conf = _two_level_decision(_tone, answers, f"t{n}")
                if tone:
                    conf["tone"] = t_conf
        if _asks_scene(inp, i):
            if not bg_done:
                where, p = _choice(answers, f"bg{n}", bgs)
                if where and where != keep_key(inp.bgs) and where != inp.scene.bg and p >= t.bg:
                    bg, bg_done = where, True
                    conf["bg"] = p
            if not bgm_done:
                tune, p = _choice(answers, f"bgm{n}", bgms)
                if tune and tune != keep_key(inp.bgms) and tune != inp.scene.bgm and p >= t.bgm:
                    bgm, bgm_done = tune, True
                    conf["bgm"] = p
        if inp.cgs:
            cg, cg_off, p = _cg_decision(inp, answers, f"cg{n}")
            if cg or cg_off:
                conf["cg"] = p
        out.append(LineDecision(i, speaker, emotion, bg, bgm, cg, cg_off, tone, conf))
    return out
