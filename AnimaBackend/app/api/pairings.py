"""配对表(素材架构设计 1.6.4):一份表情名单的每一项,配声音的哪一行语气 / CG 构图的哪张差分。

第 1c 期:设置 → 数据「表情认法」选了认词记录时,前端整份读来,语音按它挑那一行、CG 按它挑那一帧。
只回共用的表(card_id 是空的);只给某张卡另存的表还没做。
第 1d 期:每张表带上被哪些卡用(配对页改共用的表之前先告诉玩家),能改一格(来源「你改的」);
缺的格子当场补上(POST /fill,比名字 → 本地模型,逻辑在 app/pairing/fill.py);
让聊天模型重配(GET /{id}/estimate 看发出去的字,POST /{id}/suggest 发一次,只回建议不改表;提示词在 app/pairing/prompt.py),
采纳一条就是改一格、来源记 chat。
表由回放工具 seed 填(app/replay/seed.py)。
"""

from collections.abc import Callable, Sequence
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import bindings
from app.api.emotion import use_matcher_source
from app.db import get_db
from app.emotion import lists
from app.emotion.matcher import EmotionMatcher
from app.llm.base import ChatMessage
from app.llm.errors import LLMError
from app.llm.registry import active_connection, provider_for
from app.models import (
    ApiConnection,
    CgAsset,
    Pairing,
    PairingRow,
    SceneAsset,
    SpritePack,
    VoiceEmotion,
    VoiceProfile,
)
from app.pairing import fill as filling
from app.pairing import prompt as asking

router = APIRouter(prefix="/api/pairings", tags=["pairings"])


class PairingCellOut(BaseModel):
    # 名单里的一项(立绘的 id)
    item: str
    # 声音的一行语气 / CG 的一张差分;CG 是空的 = 用构图本身那张
    value: str | None
    # 来源和三个标记的意思见 app/models.py 的 PairingRow
    source: str
    guessed: bool
    pending: bool
    unstable: bool


class PairingTableOut(BaseModel):
    id: str
    follower: str
    list_ref: str
    # 声音的 id / CG 构图的 id
    target: str
    # 用这张表的卡(按卡 id 排):voice = 挂着这个立绘包、主声音是这个声音的卡;
    # cg = 挂着这个立绘包、绑的场景包里有这个构图的卡。名单不是立绘包(内置表情)的是空的
    cards: list[str]
    cells: list[PairingCellOut]


class CellIn(BaseModel):
    # voice:这个声音的一行语气(不能空);cg:这张构图的一张差分,null = 用构图本身那张
    value: str | None
    # player 你改的;chat 采纳了聊天模型的建议
    source: Literal["player", "chat"] = "player"


class FillIn(BaseModel):
    follower: Literal["voice", "cg"]
    # 现在只补立绘包的名单(pack:<包 id>)
    list_ref: str
    # 声音的 id / CG 构图的 id
    target: str


class EstimateOut(BaseModel):
    # 发出去的字数(就是 prompt 的长度)
    chars: int
    # 发给模型的原文:前端显示「发出去的是这些」
    prompt: str


class SuggestIn(BaseModel):
    # 不给 = 当前的聊天连接
    connection_id: str | None = None


class SuggestionOut(BaseModel):
    item: str
    # 表里现在配的;new 时是 null
    current: str | None
    # 模型建议的;CG 是 null = 用构图本身那张
    suggested: str | None
    # 表里还没有这一格:采纳就是新加
    new: bool


class SuggestOut(BaseModel):
    # 只列和现在不一样的(表里还没有的格子也列),按名单的顺序
    suggestions: list[SuggestionOut]
    # 模型漏了没配的项
    unanswered: list[str]


class SkippedOut(BaseModel):
    item: str
    reason: str


class FillOut(BaseModel):
    table_id: str
    # 这次新加的格子,按名单的顺序
    added: list[PairingCellOut]
    # 没补上的(本地认词模型用不了等),下次再补
    skipped: list[SkippedOut]


def _cell_out(r: PairingRow) -> PairingCellOut:
    return PairingCellOut(
        item=r.item, value=r.value, source=r.source, guessed=r.guessed, pending=r.pending, unstable=r.unstable
    )


def _cards_using(db: Session, follower: str, list_ref: str, targets: list[str]) -> dict[str, list[str]]:
    """每张表(按 target)被哪些卡用"""
    pack_id = lists.pack_of(list_ref)
    if pack_id is None or not targets:
        return {}
    attached = set(bindings.cards_using(db, bindings.SPRITE, pack_id))
    out: dict[str, list[str]] = {}
    for target in targets:
        if follower == "voice":
            # 只算拿它当主声音的卡
            cards = [
                c
                for c in bindings.cards_using(db, bindings.VOICE, target)
                if bindings.primary(db, c, bindings.VOICE) == target
            ]
        else:
            # 第 4 期起 CG 在 CG 包里、单独绑到卡上;还没迁过的库照旧看场景包
            cg = db.get(CgAsset, target)
            if cg is not None:
                cards = bindings.cards_using(db, bindings.CG, cg.pack_id)
            else:
                scene_pack = db.scalar(select(SceneAsset.pack_id).where(SceneAsset.id == target))
                cards = bindings.cards_using(db, bindings.SCENE, scene_pack) if scene_pack else []
        cards = sorted(c for c in cards if c in attached)
        if cards:
            out[target] = cards
    return out


def _voice_rows(db: Session, profile_id: str) -> list[VoiceEmotion]:
    """声音的各段语气,按语音页的顺序;声音不存在 404"""
    if db.get(VoiceProfile, profile_id) is None:
        raise HTTPException(404, "这个声音不存在")
    return list(
        db.scalars(
            select(VoiceEmotion)
            .where(VoiceEmotion.profile_id == profile_id)
            .order_by(VoiceEmotion.sort, VoiceEmotion.created_at)
        )
    )


def _cg_row(db: Session, asset_id: str) -> CgAsset | SceneAsset | None:
    """CG 构图或差分:CG 包里的优先(第 4 期起;迁过来的和场景包里那一行编号一样),没有再找场景包里的"""
    row = db.get(CgAsset, asset_id)
    if row is not None:
        return row
    row = db.get(SceneAsset, asset_id)
    return row if row is not None and row.kind == "cg" else None


def _variants(db: Session, composition_id: str) -> list[CgAsset | SceneAsset]:
    """CG 构图下面启用、传了图的差分,按顺序(和填表、游戏里挑差分认的一样);不是构图 404"""
    comp = _cg_row(db, composition_id)
    if comp is None or comp.parent_id is not None:
        raise HTTPException(404, "这张 CG 不存在")
    model = type(comp)
    return list(
        db.scalars(
            select(model)
            .where(model.parent_id == composition_id, model.enabled.is_(True), model.mime.is_not(None))
            .order_by(model.sort, model.created_at)
        )
    )


def _right_side(db: Session, follower: str, target: str) -> list:
    """配对表的右边:声音的各段语气 / 构图的差分。一行都没有就不用配(422)"""
    if follower == "voice":
        rows = _voice_rows(db, target)
        if not rows:
            raise HTTPException(422, "这个声音还没有语气,不用配")
        return rows
    variants = _variants(db, target)
    if not variants:
        raise HTTPException(422, "这张 CG 没有传了图的差分,不用配")
    return variants


def _pack_items(db: Session, list_ref: str) -> list[lists.Item]:
    if lists.pack_of(list_ref) is None:
        raise HTTPException(422, "现在只能给立绘包的名单配")
    items = lists.list_items(db, list_ref)
    if items is None:
        raise HTTPException(404, f"找不到这份表情名单:{list_ref}(立绘包可能删了)")
    return items


@router.get("", response_model=list[PairingTableOut])
def list_pairings(
    follower: Literal["voice", "cg"],
    list_ref: str,
    target: str | None = None,
    db: Session = Depends(get_db),
):
    """一份名单的共用配对表,按 target 排;给了 target 只回那一张。格子按名单项排"""
    q = select(Pairing).where(Pairing.follower == follower, Pairing.list_ref == list_ref, Pairing.card_id == "")
    if target is not None:
        q = q.where(Pairing.target == target)
    tables = db.scalars(q.order_by(Pairing.target)).all()
    cells: dict[str, list[PairingCellOut]] = {}
    if tables:
        rows = db.scalars(
            select(PairingRow).where(PairingRow.pairing_id.in_([t.id for t in tables])).order_by(PairingRow.item)
        )
        for r in rows:
            cells.setdefault(r.pairing_id, []).append(_cell_out(r))
    cards = _cards_using(db, follower, list_ref, [t.target for t in tables])
    return [
        PairingTableOut(
            id=t.id,
            follower=t.follower,
            list_ref=t.list_ref,
            target=t.target,
            cards=cards.get(t.target, []),
            cells=cells.get(t.id, []),
        )
        for t in tables
    ]


@router.put("/{pairing_id}/cells/{item}", response_model=PairingCellOut)
def put_cell(pairing_id: str, item: str, req: CellIn, db: Session = Depends(get_db)):
    """改配对表的一格(没有就新加),只动这一格:来源记成「你改的」(采纳聊天模型的建议时是 chat),不算模型猜的、不待重配,
    「今天本来就不稳定」照旧留着(新加的不标)。几张卡共用这张表时它们都跟着变(配对页改之前先问)。
    那一项得是名单里的立绘,停用的也行:重新启用以后照表走"""
    table = db.get(Pairing, pairing_id)
    if table is None:
        raise HTTPException(404, "配对表不存在")
    try:
        keys = lists.item_keys(db, table.list_ref, with_disabled=True)
    except lists.ListNotFound as e:
        raise HTTPException(422, str(e)) from e
    if item not in keys:
        raise HTTPException(422, "这张配对表的名单里没有这一项")
    if table.follower == "voice":
        row = db.get(VoiceEmotion, req.value) if req.value else None
        if row is None or row.profile_id != table.target:
            raise HTTPException(422, "这个声音里没有这一段语气")
    elif req.value is not None:
        frame = _cg_row(db, req.value)
        if frame is None or frame.parent_id != table.target:
            raise HTTPException(422, "这张 CG 下面没有这张差分")
    cell = db.get(PairingRow, (pairing_id, item))
    if cell is None:
        cell = PairingRow(pairing_id=pairing_id, item=item, unstable=False)
        db.add(cell)
    cell.value = req.value
    cell.source = req.source
    cell.guessed = False
    cell.pending = False
    # 值没变时 onupdate 不会触发,自己写上;表也算改过
    now = datetime.now(timezone.utc)
    cell.updated_at = now
    table.updated_at = now
    db.commit()
    return _cell_out(cell)


@router.post("/fill", response_model=FillOut)
def fill(
    req: FillIn,
    db: Session = Depends(get_db),
    source: Callable[[], EmotionMatcher] = Depends(use_matcher_source),
):
    """缺格补配:名单里(启用的立绘)共用表还没有的项,voice 比名字 → 本地认词模型(来源 local、待重配),
    cg 比名字 → 构图本身(待重配)。表不在先建;已有的格子一条不动。本地模型用不了时那几项不补,写进 skipped"""
    items = _pack_items(db, req.list_ref)
    right = _right_side(db, req.follower, req.target)
    table = db.scalar(
        select(Pairing).where(
            Pairing.follower == req.follower,
            Pairing.list_ref == req.list_ref,
            Pairing.target == req.target,
            Pairing.card_id == "",
        )
    )
    if table is None:
        table = Pairing(follower=req.follower, list_ref=req.list_ref, target=req.target, card_id="")
        db.add(table)
        db.flush()
    have = set(db.scalars(select(PairingRow.item).where(PairingRow.pairing_id == table.id)))
    missing = [i for i in items if i.key not in have]
    if req.follower == "voice":
        cells, skipped = filling.fill_voice(missing, right, source)
    else:
        cells, skipped = filling.fill_cg(missing, right), []
    now = datetime.now(timezone.utc)
    added = [
        PairingRow(
            pairing_id=table.id,
            item=c.item,
            value=c.value,
            source=c.source,
            guessed=c.guessed,
            pending=c.pending,
            unstable=False,
            updated_at=now,
        )
        for c in cells
    ]
    db.add_all(added)
    if added:
        table.updated_at = now
    try:
        db.commit()
    except IntegrityError as e:
        # 别的页面同时在补同一张表:这次不写,过一会儿再补(前端失败过一分钟再试)
        db.rollback()
        raise HTTPException(409, "这张配对表正在别处补,稍后再试") from e
    return FillOut(
        table_id=table.id,
        added=[_cell_out(r) for r in added],
        skipped=[SkippedOut(item=s.item, reason=s.reason) for s in skipped],
    )


def _ask_for(db: Session, pairing_id: str) -> tuple[Pairing, list[lists.Item], list[asking.Option], str]:
    """重配要发的那次请求:表、左边(启用的立绘)、右边(基础的语气 / 传了图的差分 + 构图本身)、提示词"""
    table = db.get(Pairing, pairing_id)
    if table is None:
        raise HTTPException(404, "配对表不存在")
    items = _pack_items(db, table.list_ref)
    if not items:
        raise HTTPException(422, "名单里没有启用的立绘,不用配")
    right = _right_side(db, table.follower, table.target)
    if table.follower == "voice":
        options = asking.voice_options(filling.base_rows(right))
        title = asking.voice_title(db.get(VoiceProfile, table.target).name)
    else:
        options = asking.cg_options(right)
        title = asking.cg_title(_cg_row(db, table.target).label)
    pack = db.get(SpritePack, lists.pack_of(table.list_ref))
    return table, items, options, asking.build(asking.left_title(pack.name), items, title, options)


def _suggestions(
    items: Sequence[lists.Item], options: Sequence[asking.Option], picks: dict[int, int], cells: dict[str, PairingRow]
) -> list[SuggestionOut]:
    out = []
    for n, item in enumerate(items, 1):
        if n not in picks:
            continue
        value = options[picks[n]].value
        cell = cells.get(item.key)
        if cell is None or cell.value != value:
            out.append(
                SuggestionOut(item=item.key, current=cell.value if cell else None, suggested=value, new=cell is None)
            )
    return out


@router.get("/{pairing_id}/estimate", response_model=EstimateOut)
def estimate(pairing_id: str, db: Session = Depends(get_db)):
    """「让模型重配」会发出去什么(设计 1.6.3):按钮旁边显示字数,点之前能看原文。这里不发请求"""
    prompt = _ask_for(db, pairing_id)[3]
    return EstimateOut(chars=len(prompt), prompt=prompt)


@router.post("/{pairing_id}/suggest", response_model=SuggestOut)
async def suggest(pairing_id: str, req: SuggestIn | None = None, db: Session = Depends(get_db)):
    """让聊天模型把这张表重配一遍(花钱:只在玩家点了按钮以后发一次)。只回和现在不一样的建议,不改表;
    采纳走 PUT 一格(source=chat)。模型回的没法用、请求失败都是 502,带原因"""
    table, items, options, prompt = _ask_for(db, pairing_id)
    if req is not None and req.connection_id:
        conn = db.get(ApiConnection, req.connection_id)
        if conn is None:
            raise HTTPException(404, "这个聊天连接不存在")
    else:
        conn = active_connection(db)
        if conn is None:
            raise HTTPException(400, "没有可用的聊天连接")
    if conn.api_type != "mock" and not conn.model:
        raise HTTPException(400, f"连接「{conn.name}」还没有填写模型名")
    try:
        reply = await provider_for(conn).complete([ChatMessage(role="user", content=prompt)], conn.model)
    except LLMError as e:
        raise HTTPException(502, e.message) from e
    try:
        picks = asking.parse_reply(reply, len(items), len(options))
    except asking.BadReply as e:
        raise HTTPException(502, f"模型回的没法用:{e}") from e
    cells = {r.item: r for r in db.scalars(select(PairingRow).where(PairingRow.pairing_id == table.id))}
    return SuggestOut(
        suggestions=_suggestions(items, options, picks, cells),
        unanswered=[i.key for n, i in enumerate(items, 1) if n not in picks],
    )
