"""情绪识别:AI 写的立绘标签对不上立绘名时,挑列表里最像的一个。

接口不查库、不存状态:候选(立绘名 + 别名,或内置基础表情)由前端带过来。
两个接口都是同步函数,FastAPI 会放进线程池跑,推理不堵事件循环。
设计见 docs/superpowers/specs/2026-09-25-sprite-emotion-matching-design.md
认词记录(素材架构第 1b 期,设置 → 数据「表情认法」选了认词记录时用):/resolve、/records、/records/summary,见 app/emotion/lists.py
第 1d 期加了改和删(检查器里「以后『X』都认成」、插件页的认词记录):PUT / DELETE /records
"""

from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.contracts import LABEL_MAX
from app.db import get_db
from app.emotion import lists
from app.emotion.encoder import MODEL_NAME
from app.emotion.matcher import Candidate, EmotionMatcher
from app.emotion.service import EmotionUnavailable, get_matcher
from app.models import WordRecord

router = APIRouter(prefix="/api/emotion", tags=["emotion"])

Word = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=LABEL_MAX)]


class CandidateIn(BaseModel):
    key: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    names: list[Word] = Field(min_length=1, max_length=20)


class MatchIn(BaseModel):
    tags: list[Word] = Field(min_length=1, max_length=50)
    candidates: list[CandidateIn] = Field(min_length=1, max_length=200)


class MatchOut(BaseModel):
    tag: str
    key: str
    name: str
    score: float


class MatchResponse(BaseModel):
    model: str
    results: list[MatchOut]


class StatusOut(BaseModel):
    ready: bool
    model: str
    detail: str | None


def use_matcher() -> EmotionMatcher:
    try:
        return get_matcher()
    except EmotionUnavailable as e:
        raise HTTPException(503, str(e)) from e


@router.post("/match", response_model=MatchResponse)
def match(req: MatchIn, matcher: EmotionMatcher = Depends(use_matcher)):
    candidates = [Candidate(c.key, tuple(c.names)) for c in req.candidates]
    results = matcher.match(req.tags, candidates)
    return MatchResponse(model=matcher.model, results=[MatchOut(**asdict(r)) for r in results])


@router.get("/status", response_model=StatusOut)
def status():
    """顺带触发加载:装了但加载失败也能从这里看出来"""
    try:
        m = get_matcher()
    except EmotionUnavailable as e:
        return StatusOut(ready=False, model=MODEL_NAME, detail=str(e))
    return StatusOut(ready=True, model=m.model, detail=None)


# ── 认词记录(第 1b 期) ──────────────────────────────

ListRef = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ResolveIn(BaseModel):
    list_ref: ListRef
    words: list[Word] = Field(min_length=1, max_length=50)


class ResolveOut(BaseModel):
    word: str
    key: str
    label: str
    how: str
    source: str | None
    score: float | None


class ResolveResponse(BaseModel):
    # 这次用到了认词模型才有
    model: str | None
    results: list[ResolveOut]


class RecordOut(BaseModel):
    word: str
    item: str
    source: str
    guessed: bool
    unstable: bool
    score: float | None


class RecordsResponse(BaseModel):
    list_ref: str
    records: list[RecordOut]


class RecordIn(BaseModel):
    list_ref: ListRef
    word: Word
    # 名单里的一项:立绘的 id / 内置表情的名字
    item: Annotated[str, StringConstraints(min_length=1, max_length=80)]


def _record_out(r: WordRecord) -> RecordOut:
    return RecordOut(word=r.word, item=r.item, source=r.source, guessed=r.guessed, unstable=r.unstable, score=r.score)


class RecordsSummary(BaseModel):
    total: int
    lists: int
    by_source: dict[str, int]


def use_matcher_source() -> Callable[[], EmotionMatcher]:
    """认词模型用到时才加载:名字和记录都对上的一批词不需要模型(测试里换成假的)"""
    return get_matcher


@router.post("/resolve", response_model=ResolveResponse)
def resolve(
    req: ResolveIn,
    db: Session = Depends(get_db),
    source: Callable[[], EmotionMatcher] = Depends(use_matcher_source),
):
    """表情认法选了「认词记录」时认词:名字和别名 → 认词记录 → 认词模型(固定算法)认一次并记下来"""
    used: list[EmotionMatcher] = []

    def matcher() -> EmotionMatcher:
        m = source()
        used.append(m)
        return m

    try:
        results = lists.resolve_words(db, req.list_ref, req.words, matcher)
    except lists.ListNotFound as e:
        raise HTTPException(404, str(e)) from e
    except EmotionUnavailable as e:
        raise HTTPException(503, str(e)) from e
    return ResolveResponse(model=used[0].model if used else None, results=[ResolveOut(**asdict(r)) for r in results])


@router.get("/records", response_model=RecordsResponse)
def records(list_ref: str, db: Session = Depends(get_db)):
    """一份表情名单的认词记录(前端整份读来,先查它再问模型)"""
    rows = db.scalars(select(WordRecord).where(WordRecord.list_ref == list_ref).order_by(WordRecord.word))
    return RecordsResponse(list_ref=list_ref, records=[_record_out(r) for r in rows])


def _find_record(db: Session, list_ref: str, word: str) -> WordRecord | None:
    return db.scalars(select(WordRecord).where(WordRecord.list_ref == list_ref, WordRecord.word == word)).one_or_none()


@router.put("/records", response_model=RecordOut)
def put_record(req: RecordIn, db: Session = Depends(get_db)):
    """以后这个词都认成名单里的这一项:有这条记录就改,没有就新加,只动这一条。
    来源记成「你改的」、不算模型猜的、没有相似度;「今天本来就不稳定」照旧留着(新加的不标)。
    那一项得是名单里现在有的(停用的立绘不算)"""
    try:
        keys = lists.item_keys(db, req.list_ref)
    except lists.ListNotFound as e:
        raise HTTPException(404, str(e)) from e
    if req.item not in keys:
        raise HTTPException(422, "这份表情名单里没有这一项(立绘可能停用或删了)")
    rec = _find_record(db, req.list_ref, req.word)
    if rec is None:
        rec = WordRecord(list_ref=req.list_ref, word=req.word, unstable=False)
        db.add(rec)
    rec.item = req.item
    rec.source = "player"
    rec.guessed = False
    rec.score = None
    # 值没变时 onupdate 不会触发,自己写上
    rec.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _record_out(rec)


@router.delete("/records", status_code=204)
def delete_record(list_ref: str, word: str, db: Session = Depends(get_db)):
    """删一条认词记录,只动这一条:这个词下次出现时重新认(名字对上 → 认词模型认一次再记下来)"""
    rec = _find_record(db, list_ref.strip(), word.strip())
    if rec is None:
        raise HTTPException(404, "没有这条认词记录")
    db.delete(rec)
    db.commit()


@router.get("/records/summary", response_model=RecordsSummary)
def records_summary(db: Session = Depends(get_db)):
    """设置 → 数据:认词记录一共几条、各来源几条、来自几份名单"""
    by_source = {s: n for s, n in db.execute(select(WordRecord.source, func.count()).group_by(WordRecord.source))}
    n_lists = db.scalar(select(func.count(func.distinct(WordRecord.list_ref)))) or 0
    return RecordsSummary(total=sum(by_source.values()), lists=n_lists, by_source=by_source)
