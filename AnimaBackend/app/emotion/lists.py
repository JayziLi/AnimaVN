"""表情名单和认词记录(素材架构设计 1.1、1.4,第 1b 期)。

名单:有立绘的卡是它当前立绘包里启用的立绘(pack:<包 id>),没有立绘的卡是内置的 16 个(builtin)。
认一个词:名字和别名对上 → 认词记录 → 本地认词模型(固定算法,每个词单独算)挑一项,记进认词记录。
比对和候选和前端一模一样(plugins/emotionMatch.ts 的 resolveByLabel、emotionCandidates、toRequestCandidate):
认名字和别名时,词去首尾空白、不分大小写,和全部别名比;给模型的名字去首尾空白、去掉空的和超过 40 字的,每项最多 20 个。
第 1d 期玩家能改认词记录、配对表的格子,改之前用 item_keys 校验那一项在不在名单里。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.contracts import BUILTIN_EMOTIONS, LABEL_MAX
from app.emotion.matcher import Candidate, EmotionMatcher
from app.models import PackSprite, SpritePack, WordRecord

BUILTIN = "builtin"
PACK_PREFIX = "pack:"
# 名字的长度上限(app/contracts.py),和 /api/emotion 收的词一样长
MAX_WORD = LABEL_MAX
MAX_NAMES = 20


class ListNotFound(Exception):
    pass


@dataclass(frozen=True)
class Item:
    """名单里的一项:立绘(key 是立绘的 id)或内置表情(key 就是名字)"""

    key: str
    label: str
    aliases: tuple[str, ...]
    # 立绘的用法说明(让模型重配时发过去,设计 1.6.3);内置表情没有
    description: str = ""


@dataclass(frozen=True)
class Resolved:
    word: str
    key: str
    label: str
    # name 名字或别名对上 / record 认词记录 / model 模型这次认的(已经记进认词记录)
    how: str
    source: str | None
    score: float | None


def pack_of(list_ref: str) -> str | None:
    """立绘包的名单 → 包的 id;内置名单、不认识的写法是 None"""
    return list_ref[len(PACK_PREFIX) :] if list_ref.startswith(PACK_PREFIX) else None


def _missing(list_ref: str) -> ListNotFound:
    return ListNotFound(f"找不到这份表情名单:{list_ref}(立绘包可能删了)")


def list_items(db: Session, list_ref: str) -> list[Item] | None:
    """名单里的各项,按游戏里的顺序;名单不存在(包删了、写法不认识)是 None"""
    if list_ref == BUILTIN:
        return [Item(label, label, tuple(aliases)) for label, aliases in BUILTIN_EMOTIONS]
    pack_id = pack_of(list_ref)
    if pack_id is not None:
        if db.get(SpritePack, pack_id) is None:
            return None
        rows = db.scalars(
            select(PackSprite)
            .where(PackSprite.pack_id == pack_id, PackSprite.enabled.is_(True))
            .order_by(PackSprite.sort, PackSprite.created_at)
        )
        return [Item(s.id, s.label, tuple(s.aliases or ()), s.description or "") for s in rows]
    return None


def item_keys(db: Session, list_ref: str, *, with_disabled: bool = False) -> set[str]:
    """名单里各项的编号,改认词记录、改配对表时校验用;名单不存在抛 ListNotFound。
    with_disabled:停用的立绘也算(配对表的格子:那张图重新启用以后照旧按表走,停着的时候也能先改好)"""
    pack_id = pack_of(list_ref)
    if with_disabled and pack_id is not None:
        if db.get(SpritePack, pack_id) is None:
            raise _missing(list_ref)
        return set(db.scalars(select(PackSprite.id).where(PackSprite.pack_id == pack_id)))
    items = list_items(db, list_ref)
    if items is None:
        raise _missing(list_ref)
    return {i.key for i in items}


def exact_item(word: str, items: Sequence[Item]) -> Item | None:
    """名字或别名对上(去首尾空白、不分大小写)"""
    key = word.strip().lower()
    if not key:
        return None
    return next((i for i in items if i.label.lower() == key or any(a.lower() == key for a in i.aliases)), None)


def model_candidates(items: Sequence[Item]) -> list[Candidate]:
    """给认词模型比的候选:每项的名字和别名"""
    out = []
    for i in items:
        names = [n.strip() for n in (i.label, *i.aliases)]
        names = [n for n in names if n and len(n) <= MAX_WORD][:MAX_NAMES]
        if names:
            out.append(Candidate(i.key, tuple(names)))
    return out


def resolve_words(
    db: Session, list_ref: str, words: Sequence[str], matcher: Callable[[], EmotionMatcher]
) -> list[Resolved]:
    """一批词 → 名单里的哪一项。模型认的写进认词记录(来源 model、模型猜的)。
    记录指向的那一项现在不在名单里(停用了、删了)时,这次照模型认,但不改记录:那张图重新启用,记录照旧生效。
    matcher 只在真要问模型时才调(模型没装时抛 EmotionUnavailable)"""
    items = list_items(db, list_ref)
    if items is None:
        raise _missing(list_ref)
    by_key = {i.key: i for i in items}
    words = list(dict.fromkeys(w.strip() for w in words if w.strip()))
    stored = {
        r.word: r
        for r in db.scalars(select(WordRecord).where(WordRecord.list_ref == list_ref, WordRecord.word.in_(words)))
    }
    out: dict[str, Resolved] = {}
    ask: list[str] = []
    for w in words:
        hit = exact_item(w, items)
        if hit is not None:
            out[w] = Resolved(w, hit.key, hit.label, "name", None, None)
            continue
        rec = stored.get(w)
        if rec is not None and rec.item in by_key:
            out[w] = Resolved(w, rec.item, by_key[rec.item].label, "record", rec.source, rec.score)
            continue
        ask.append(w)
    candidates = model_candidates(items)
    if ask and not candidates:
        raise ListNotFound(f"这份表情名单里没有能给认词模型比的名字:{list_ref}")
    if ask:
        for m in matcher().match_singles(ask, candidates):
            out[m.tag] = Resolved(m.tag, m.key, by_key[m.key].label, "model", "model", m.score)
            if m.tag not in stored:
                db.add(WordRecord(list_ref=list_ref, word=m.tag, item=m.key, source="model", guessed=True, score=m.score))
        try:
            db.commit()
        except IntegrityError:
            # 别的页面刚好同时记下了同一个词:以先记的为准(算法固定,结果本来就一样),这次的结果照样返回
            db.rollback()
    return [out[w] for w in words]
