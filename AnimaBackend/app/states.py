"""状态组(素材架构设计 3.5,第 4 期):几张卡是同一个角色的几个状态。全后端只有这里读写 card_state_groups / card_states。

这一期的状态组都是迁移拆出来的(私有迁移);卡编辑器的「状态」页(加状态、改名、
在选角页单独显示)是以后的事。删卡、复制卡按设计 3.5.6 处理:删主卡连同状态卡一起删;删状态卡只从组里拿掉,
从它开局的对话改指主卡;复制一张卡得到一张独立的卡。
"""

from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import CardState, CardStateGroup, DebugChat


def state_of(db: Session, card_id: str) -> CardState | None:
    return db.get(CardState, card_id)


def group_states(db: Session, group_id: str) -> list[CardState]:
    return list(db.scalars(select(CardState).where(CardState.group_id == group_id).order_by(CardState.sort)).all())


def group_of(db: Session, card_id: str) -> dict:
    """这张卡所在的状态组:{group_id, main_card_id, states: [{card_id, name, sort, show_in_pick}]};不在组里时 group_id 是 None"""
    row = state_of(db, card_id)
    if row is None:
        return {"group_id": None, "main_card_id": None, "states": []}
    group = db.get(CardStateGroup, row.group_id)
    return {
        "group_id": row.group_id,
        "main_card_id": group.main_card_id if group else None,
        "states": [
            {"card_id": s.card_id, "name": s.name, "sort": s.sort, "show_in_pick": s.show_in_pick}
            for s in group_states(db, row.group_id)
        ],
    }


def main_of_states(db: Session) -> dict[str, str]:
    """每张「不是主卡的状态卡」→ 它的主卡(卡列表的 state_of 用)"""
    rows = db.execute(
        select(CardState.card_id, CardStateGroup.main_card_id).join(CardStateGroup, CardStateGroup.id == CardState.group_id)
    ).all()
    return {card: main for card, main in rows if card != main}


def cards_to_delete_with(db: Session, card_id: str) -> list[str]:
    """删这张卡时一起删的状态卡(它是主卡时是组里别的卡;不是主卡或不在组里时没有)"""
    row = state_of(db, card_id)
    if row is None:
        return []
    group = db.get(CardStateGroup, row.group_id)
    if group is None or group.main_card_id != card_id:
        return []
    return [s.card_id for s in group_states(db, row.group_id) if s.card_id != card_id]


def forget_card(db: Session, card_id: str) -> None:
    """删卡前调用:主卡 → 整个组拆掉;状态卡 → 从组里拿掉,从它开局的对话改指主卡"""
    row = state_of(db, card_id)
    if row is None:
        return
    group = db.get(CardStateGroup, row.group_id)
    if group is not None and group.main_card_id == card_id:
        db.execute(delete(CardState).where(CardState.group_id == group.id))
        db.delete(group)
    else:
        if group is not None:
            db.execute(update(DebugChat).where(DebugChat.card_id == card_id).values(card_id=group.main_card_id))
        db.delete(row)
    db.flush()
