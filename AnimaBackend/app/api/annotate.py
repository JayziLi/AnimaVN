"""Jev 标注:LLM 写好的句子 → 每句谁说的、什么表情、场景和音乐换没换、该不该出 CG。

前端流式时每写完一句(或几句)发一次;候选(立绘、背景、音乐、CG)、门槛、改过的问法由前端带过来,
接口不查库。判断逻辑在 app/annotate/judge.py,设计见 docs/superpowers/specs/2026-10-01-jev-director-design.md
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, BeforeValidator, Field, StringConstraints, model_validator
from sqlalchemy.orm import Session

from app.annotate import client as jev
from app.annotate.judge import (
    CG_OFF,
    DEFAULT_PROMPTS,
    KEEP,
    PROMPT_MAX,
    AnnotateInput,
    Choice,
    Line,
    SceneState,
    Thresholds,
    build_request,
    decide,
)
from app.db import get_db

router = APIRouter(prefix="/api/annotate", tags=["annotate"])

Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


def _clip(n: int):
    """超长的截掉而不是 422:库里的描述、别名、卡名没有这些上限,写得详细一点的 CG 描述、
    一条长回复就会让整批标注失败,而且前端只看到「失败」、标注悄悄全停了"""
    return BeforeValidator(lambda v: v[:n] if isinstance(v, (str, list)) else v)


def Clipped(n: int):  # noqa: N802 —— 当类型用
    return Annotated[str, _clip(n), StringConstraints(max_length=n)]


# 一次最多判这么多句:每句的题目都带着整份候选,句子多了会超过 Jev 一次 64K token 的上限
MAX_TARGETS = 16


class ChoiceIn(BaseModel):
    label: Label
    aliases: Annotated[list[Label], _clip(20)] = Field(default_factory=list, max_length=20)
    description: Clipped(300) = ""


class LineIn(BaseModel):
    text: Annotated[str, StringConstraints(max_length=2000)]
    speaker: Clipped(80) | None = None


class SceneIn(BaseModel):
    bg: str | None = None
    bgm: str | None = None
    # 这条回复里已经换过了:不再问(一条回复各最多换一次)
    bg_changed: bool = False
    bgm_changed: bool = False
    # 现在画面上的 CG;现在的地点(背景名和说明,CG 题用)
    cg: str | None = None
    place: Clipped(400) = ""


class ThresholdsIn(BaseModel):
    speaker: float = Field(0.8, ge=0.5, le=0.95)
    bg: float = Field(0.6, ge=0.3, le=0.95)
    bgm: float = Field(0.6, ge=0.3, le=0.95)
    cg: float = Field(0.6, ge=0.3, le=0.95)


PromptKey = Literal[
    "state", "speaker", "speaker_char", "speaker_user", "speaker_other", "speaker_none",
    "emotion", "bg", "bg_keep", "bgm", "bgm_keep", "cg", "cg_keep", "cg_off",
]


class AnnotateRequest(BaseModel):
    # 先去空格再截:先截的话纯空格的名字会混过非空检查,79 个空格 + 名字会只剩名字的头一个字
    char: Annotated[
        str,
        BeforeValidator(lambda v: v.strip()[:80] if isinstance(v, str) else v),
        StringConstraints(min_length=1, max_length=80),
    ]
    user: Clipped(80) = ""
    prev: Clipped(8000) = ""
    lines: list[LineIn] = Field(min_length=1, max_length=400)
    targets: list[int] = Field(min_length=1, max_length=MAX_TARGETS)
    # 立绘是 Jev 才带;背景 / BGM 是 Jev 才带。不带就不问
    emotions: list[ChoiceIn] = Field(default_factory=list, max_length=200)
    bgs: list[ChoiceIn] = Field(default_factory=list, max_length=200)
    bgms: list[ChoiceIn] = Field(default_factory=list, max_length=200)
    # CG 是 Jev 才带(只带构图,差分前端按表情挑)
    cgs: list[ChoiceIn] = Field(default_factory=list, max_length=200)
    scene: SceneIn = Field(default_factory=SceneIn)
    # 立绘或玩家台词是 Jev 时问「谁说的」
    ask_speaker: bool = True
    thresholds: ThresholdsIn = Field(default_factory=ThresholdsIn)
    # 插件页里改过的问法;没改的不传,用默认
    prompts: dict[PromptKey, Annotated[str, StringConstraints(max_length=PROMPT_MAX)]] = Field(
        default_factory=dict
    )

    @model_validator(mode="after")
    def _targets_in_range(self):
        if any(t < 0 or t >= len(self.lines) for t in self.targets):
            raise ValueError("targets 里有超出句子范围的下标")
        return self


class LineDecisionOut(BaseModel):
    index: int
    speaker: str | None
    emotion: str | None
    bg: str | None
    bgm: str | None
    cg: str | None = None
    cg_off: bool = False
    confidence: dict[str, float]


class AnnotateResponse(BaseModel):
    lines: list[LineDecisionOut]
    # 这次请求 Jev 花了多久、多少输入 token(没问 Jev 时都是 0)
    ms: int
    tokens: int


class StatusOut(BaseModel):
    has_key: bool
    source: str | None


class KeyIn(BaseModel):
    key: Annotated[str, StringConstraints(max_length=500)]


def _choices(items: list[ChoiceIn]) -> list[Choice]:
    return [Choice(c.label, tuple(c.aliases), c.description) for c in items]


@router.post("/lines", response_model=AnnotateResponse)
async def annotate_lines(req: AnnotateRequest, db: Session = Depends(get_db)):
    key, _ = jev.key_source(db)
    if not key:
        raise HTTPException(503, "还没设 Jev 的 API key(插件页「Jev 标注」里填)")
    inp = AnnotateInput(
        char=req.char,
        user=req.user,
        prev=req.prev,
        lines=[Line(x.text, x.speaker) for x in req.lines],
        targets=list(dict.fromkeys(req.targets)),
        emotions=_choices(req.emotions),
        bgs=_choices(req.bgs),
        bgms=_choices(req.bgms),
        cgs=_choices(req.cgs),
        scene=SceneState(
            req.scene.bg,
            req.scene.bgm,
            req.scene.bg_changed,
            req.scene.bgm_changed,
            req.scene.cg,
            req.scene.place,
        ),
        ask_speaker=req.ask_speaker,
        thresholds=Thresholds(
            req.thresholds.speaker, req.thresholds.bg, req.thresholds.bgm, req.thresholds.cg
        ),
        prompts={k: v for k, v in req.prompts.items() if v.strip()},
    )
    state, questions = build_request(inp)
    answers, tokens, ms = {}, 0, 0
    if questions:
        try:
            answers, tokens, ms = await jev.ask(key, state, questions)
        except jev.JevError as e:
            raise HTTPException(e.status, e.message) from e
    return AnnotateResponse(
        lines=[LineDecisionOut(**d.__dict__) for d in decide(inp, answers)], ms=ms, tokens=tokens
    )


class DefaultsOut(BaseModel):
    prompts: dict[str, str]
    keep: str
    # CG 题里「收起 CG」那个选项的名字
    cg_off: str = CG_OFF
    thresholds: ThresholdsIn


@router.get("/defaults", response_model=DefaultsOut)
def defaults():
    """默认问法和门槛:插件页显示、「恢复默认」都从这里拿,默认值只在后端存一份"""
    return DefaultsOut(prompts=DEFAULT_PROMPTS, keep=KEEP, thresholds=ThresholdsIn())


class TryOut(BaseModel):
    ms: int


@router.post("/test", response_model=TryOut)
async def try_key(db: Session = Depends(get_db)):
    """用现在的 key 问 Jev 一道小题:通了回耗时,不通回原因"""
    key, _ = jev.key_source(db)
    if not key:
        raise HTTPException(503, "还没设 Jev 的 key")
    question = {
        "ok": {
            "type": "choice",
            "instructions": "这句话是在打招呼吗?",
            "criteria": {"yes": "是打招呼", "no": "不是"},
        }
    }
    try:
        _, _, ms = await jev.ask(key, "你好,欢迎回来!", question)
    except jev.JevError as e:
        raise HTTPException(e.status, e.message) from e
    return TryOut(ms=ms)


@router.post("/warmup", status_code=204)
async def warmup(db: Session = Depends(get_db)):
    """玩家发消息时叫一声:LLM 还在想的时候先把到 Jev 的连接连好"""
    key, _ = jev.key_source(db)
    if key:
        await jev.warmup()
    return Response(status_code=204)


@router.get("/status", response_model=StatusOut)
def status(db: Session = Depends(get_db)):
    key, source = jev.key_source(db)
    return StatusOut(has_key=key is not None, source=source)


@router.put("/key", status_code=204)
def put_key(req: KeyIn, db: Session = Depends(get_db)):
    """只能写、不能读;传空串就删掉"""
    jev.save_key(db, req.key)
    return Response(status_code=204)
