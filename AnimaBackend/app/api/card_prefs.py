"""按卡设置:一张卡在全局插件设置之上另外改的几项(素材架构设计 2.9,第 2 期)。

键和全局设置(app_settings.py)是同一套,比如 plugin.cg;值只放这张卡改了的那几个字段,
比如 {"jev": {"threshold": 0.75}}。哪些字段能按卡设、怎么和全局合并,由前端的插件声明、
前端合并;后端只存取、不看里面的结构 —— 和全局设置一样,以后加插件不用改后端。
"""

import copy
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.app_settings import check_key
from app.db import get_db
from app.models import CardPref, TavernCard
from app.schemas import CardPrefIn, CardPrefOut

router = APIRouter(tags=["card-prefs"])

PREFS = "/api/tavern/cards/{card_id}/prefs"


def _check_card(card_id: str, db: Session) -> None:
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")


@router.get(PREFS, response_model=dict[str, Any])
def get_card_prefs(card_id: str, db: Session = Depends(get_db)):
    """这张卡另设过的全部项:{键: 改了的字段}。一项都没设过是 {}"""
    _check_card(card_id, db)
    rows = db.scalars(select(CardPref).where(CardPref.card_id == card_id).order_by(CardPref.key))
    return {r.key: r.value for r in rows}


@router.put(PREFS + "/{key}", response_model=CardPrefOut)
def put_card_pref(card_id: str, key: str, req: CardPrefIn, db: Session = Depends(get_db)):
    """整份换掉这一项改了的字段(不和上次存的合并):前端每次都把这张卡现在改了的全部字段发过来"""
    check_key(key)
    _check_card(card_id, db)
    row = db.get(CardPref, (card_id, key))
    if row is None:
        row = CardPref(card_id=card_id, key=key, value=req.value)
        db.add(row)
    else:
        row.value = req.value
    db.commit()
    return CardPrefOut(key=key, value=row.value)


@router.delete(PREFS + "/{key}", status_code=204)
def delete_card_pref(card_id: str, key: str, db: Session = Depends(get_db)):
    """这一项不再另设,回到全局(「恢复成全局」)"""
    check_key(key)
    _check_card(card_id, db)
    row = db.get(CardPref, (card_id, key))
    if row is None:
        raise HTTPException(404, "这张卡没有另设这一项")
    db.delete(row)
    db.commit()


def delete_card_prefs(card_id: str, db: Session) -> None:
    """删卡时由 tavern.delete_card 调用。另设是这张卡自己的,跟着卡一起删"""
    db.execute(delete(CardPref).where(CardPref.card_id == card_id))


def copy_card_prefs(src_id: str, dst_id: str, db: Session) -> None:
    """复制卡时副本带上同样的另设。各存一份:之后改副本不动原卡"""
    for r in db.scalars(select(CardPref).where(CardPref.card_id == src_id)).all():
        db.add(CardPref(card_id=dst_id, key=r.key, value=copy.deepcopy(r.value)))
