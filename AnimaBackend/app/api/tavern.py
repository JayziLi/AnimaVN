"""酒馆角色卡 / 提示词预设的 CRUD。

调试台（prompt console）用这组端点持久化它导入或编辑的卡和预设。
PNG 解析留在前端 —— 前端解析完把 JSON 和头像一起 POST 过来，
后端只负责存取，不重复实现 PNG chunk 解析。
"""

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import and_, select, update
from sqlalchemy.orm import Session, defer

from app import bindings, states
from app.api.card_prefs import copy_card_prefs, delete_card_prefs
from app.db import get_db, without_required_nulls
from app.models import DebugChat, PromptPreset, TavernCard
from app.schemas import (
    DuplicateRequest,
    PromptPresetCreate,
    PromptPresetOut,
    PromptPresetUpdate,
    TavernCardCreate,
    TavernCardOut,
    TavernCardUpdate,
)

router = APIRouter(prefix="/api/tavern", tags=["tavern"])


def _card_out(card: TavernCard, has_avatar: bool | None = None, state_of: str | None = None) -> TavernCardOut:
    return TavernCardOut(
        id=card.id,
        name=card.name,
        description=card.description,
        personality=card.personality,
        scenario=card.scenario,
        first_mes=card.first_mes,
        mes_example=card.mes_example,
        system_prompt=card.system_prompt,
        post_history_instructions=card.post_history_instructions,
        creator_notes=card.creator_notes,
        alternate_greetings=card.alternate_greetings or [],
        tags=card.tags or [],
        creator=card.creator,
        character_version=card.character_version,
        character_book=card.character_book,
        extensions=card.extensions or {},
        spec=card.spec,
        has_avatar=bool(card.avatar) if has_avatar is None else has_avatar,
        last_chat_id=card.last_chat_id,
        state_of=state_of,
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


def _copy_name(original: str, requested: str | None) -> str:
    return (requested or "").strip() or f"{original} - 副本"


def _unique_preset_name(name: str, db: Session, exclude_id: str | None = None) -> str:
    """预设名不允许重复 —— 撞名就强制加 (2) / (3)... 后缀,直到不撞为止。"""
    base = name.strip() or "未命名预设"
    candidate = base
    suffix = 2
    while True:
        q = select(PromptPreset.id).where(PromptPreset.name == candidate)
        if exclude_id is not None:
            q = q.where(PromptPreset.id != exclude_id)
        if db.scalars(q).first() is None:
            return candidate
        candidate = f"{base} ({suffix})"
        suffix += 1


# ══════════════ 角色卡 ══════════════


def _load_card(card_id: str, db: Session) -> TavernCard:
    card = db.get(TavernCard, card_id)
    if card is None:
        raise HTTPException(404, "角色卡不存在")
    return card


@router.get("/cards", response_model=list[TavernCardOut])
def list_cards(db: Session = Depends(get_db)):
    # 头像是整张 PNG 的 data URL(一张几百 KB,本机 21 张卡共 6 MB),列表只要知道有没有,
    # 不把它读出来
    has_avatar = and_(TavernCard.avatar.is_not(None), TavernCard.avatar != "")
    rows = db.execute(
        select(TavernCard, has_avatar).options(defer(TavernCard.avatar)).order_by(TavernCard.created_at)
    ).all()
    mains = states.main_of_states(db)
    return [_card_out(c, bool(h), mains.get(c.id)) for c, h in rows]


@router.get("/cards/{card_id}", response_model=TavernCardOut)
def get_card(card_id: str, db: Session = Depends(get_db)):
    return _card_out(_load_card(card_id, db), state_of=states.main_of_states(db).get(card_id))


@router.get("/cards/{card_id}/states")
def card_states(card_id: str, db: Session = Depends(get_db)):
    """这张卡所在的状态组(主卡、各状态卡的名字和顺序);不在组里时 group_id 是 null"""
    _load_card(card_id, db)
    return states.group_of(db, card_id)


@router.post("/cards", response_model=TavernCardOut)
def create_card(req: TavernCardCreate, db: Session = Depends(get_db)):
    card = TavernCard(**req.model_dump())
    db.add(card)
    db.commit()
    db.refresh(card)
    return _card_out(card)


@router.put("/cards/{card_id}", response_model=TavernCardOut)
def update_card(card_id: str, req: TavernCardUpdate, db: Session = Depends(get_db)):
    card = _load_card(card_id, db)
    # exclude_unset: the console sends only the field the user just edited
    for field, value in without_required_nulls(TavernCard, req.model_dump(exclude_unset=True)).items():
        setattr(card, field, value)
    db.commit()
    db.refresh(card)
    return _card_out(card)


def delete_card_cascade(db: Session, card_id: str) -> list[str]:
    """删一张卡,连同(它是主卡时)它的状态卡、它们的绑定和按卡设置;对话留着、不再指向它们。
    不提交;返回删掉的卡(这张在最前),卡已经不在了返回 []。删卡接口、撤销导入(app/importer/jobs.py)共用"""
    card = db.get(TavernCard, card_id)
    if card is None:
        return []
    # 主卡的状态卡跟着删;状态卡自己被删时,从它开局的对话改指主卡(states.forget_card)
    doomed = [card_id, *states.cards_to_delete_with(db, card_id)]
    states.forget_card(db, card_id)
    for cid in doomed:
        # 对话比卡活得久:每条分支都存着完整提示词快照,历史照样能回看。
        # 引用置空而不是删对话(SQLAlchemy 的 FK 不带 pragma 不级联,手动来)。
        db.execute(update(DebugChat).where(DebugChat.card_id == cid).values(card_id=None))
        # 绑定、角色位删掉;包和声音是共用的,留着
        bindings.delete_card(db, cid)
        delete_card_prefs(cid, db)
        if cid != card_id:
            db.delete(db.get(TavernCard, cid))
    db.delete(card)
    db.flush()
    return doomed


@router.delete("/cards/{card_id}", status_code=204)
def delete_card(card_id: str, db: Session = Depends(get_db)):
    _load_card(card_id, db)
    delete_card_cascade(db, card_id)
    db.commit()


@router.get("/cards/{card_id}/roster")
def card_roster(card_id: str, db: Session = Depends(get_db)):
    """名册:这张卡的角色位(这一期只有主角色位)和各自绑的立绘包、声音,卡级的场景包、CG 包。只读"""
    _load_card(card_id, db)
    return bindings.roster(db, card_id)


@router.post("/cards/{card_id}/duplicate", response_model=TavernCardOut)
def duplicate_card(card_id: str, req: DuplicateRequest, db: Session = Depends(get_db)):
    src = _load_card(card_id, db)
    copy = TavernCard(
        name=_copy_name(src.name, req.name),
        description=src.description,
        personality=src.personality,
        scenario=src.scenario,
        first_mes=src.first_mes,
        mes_example=src.mes_example,
        system_prompt=src.system_prompt,
        post_history_instructions=src.post_history_instructions,
        creator_notes=src.creator_notes,
        alternate_greetings=list(src.alternate_greetings or []),
        tags=list(src.tags or []),
        creator=src.creator,
        character_version=src.character_version,
        character_book=src.character_book,
        extensions=dict(src.extensions or {}),
        spec=src.spec,
        avatar=src.avatar,
        # last_chat_id 故意不复制:副本还一条对话都没有,继承过来会让它一进去
        # 就打开原卡的对话
    )
    db.add(copy)
    db.flush()  # 先拿到副本的 id,绑定行要挂在它下面
    bindings.copy_card(db, src.id, copy.id)
    copy_card_prefs(src.id, copy.id, db)
    db.commit()
    db.refresh(copy)
    return _card_out(copy)


@router.get("/cards/{card_id}/avatar")
def get_card_avatar(card_id: str, request: Request, db: Session = Depends(get_db)):
    """头像单独取,列表接口只回 has_avatar,免得列一堆卡时把图全拖下来。

    一张能有近 1 MB,ETag 按内容算:刷新页面时浏览器带着它来问,没换图就回 304,不用整张重下。
    """
    card = _load_card(card_id, db)
    if not card.avatar:
        raise HTTPException(404, "这张卡没有头像")
    etag = f'"{hashlib.blake2b(card.avatar.encode(), digest_size=16).hexdigest()}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=card.avatar, media_type="text/plain", headers=headers)


# ══════════════ 预设 ══════════════


def _load_preset(preset_id: str, db: Session) -> PromptPreset:
    preset = db.get(PromptPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "预设不存在")
    return preset


@router.get("/presets", response_model=list[PromptPresetOut])
def list_presets(db: Session = Depends(get_db)):
    return db.scalars(select(PromptPreset).order_by(PromptPreset.created_at)).all()


@router.get("/presets/{preset_id}", response_model=PromptPresetOut)
def get_preset(preset_id: str, db: Session = Depends(get_db)):
    return _load_preset(preset_id, db)


@router.post("/presets", response_model=PromptPresetOut)
def create_preset(req: PromptPresetCreate, db: Session = Depends(get_db)):
    if not req.name.strip():
        raise HTTPException(400, "预设名不能为空")
    data = req.model_dump()
    data["name"] = _unique_preset_name(req.name, db)
    preset = PromptPreset(**data)
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return preset


@router.put("/presets/{preset_id}", response_model=PromptPresetOut)
def update_preset(preset_id: str, req: PromptPresetUpdate, db: Session = Depends(get_db)):
    preset = _load_preset(preset_id, db)
    updates = without_required_nulls(PromptPreset, req.model_dump(exclude_unset=True))
    if "name" in updates and not (updates["name"] or "").strip():
        raise HTTPException(400, "预设名不能为空")
    if "name" in updates:
        updates["name"] = _unique_preset_name(updates["name"], db, exclude_id=preset_id)
    for field, value in updates.items():
        setattr(preset, field, value)
    db.commit()
    db.refresh(preset)
    return preset


@router.delete("/presets/{preset_id}", status_code=204)
def delete_preset(preset_id: str, db: Session = Depends(get_db)):
    # 同上:预设删了只影响「继续聊」时的组装,历史快照自包含
    db.execute(update(DebugChat).where(DebugChat.preset_id == preset_id).values(preset_id=None))
    db.delete(_load_preset(preset_id, db))
    db.commit()


@router.post("/presets/{preset_id}/duplicate", response_model=PromptPresetOut)
def duplicate_preset(preset_id: str, req: DuplicateRequest, db: Session = Depends(get_db)):
    src = _load_preset(preset_id, db)
    copy = PromptPreset(
        name=_unique_preset_name(_copy_name(src.name, req.name), db),
        prompts=list(src.prompts or []),
        prompt_order=list(src.prompt_order or []),
        formats=dict(src.formats or {}),
        params=dict(src.params or {}),
        squash_system_messages=src.squash_system_messages,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy
