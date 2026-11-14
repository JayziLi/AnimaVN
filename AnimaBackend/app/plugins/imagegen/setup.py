"""每张卡自己的生图设置 imagegen.setup(设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 3 节)。

- 存在卡的 card_prefs 里,键不带 plugin. 前缀,所以不进 .animavn 角色包(bundle/collect.py 只导出 plugin.*)
- 外层是这张卡所有连接共用的;byConn[连接编号] 是这张卡在那条连接下的那份(换连接各存各的)
- imagegen.last(全局)= 上次改动的那份,只给新卡抄
- 第一次用(还没有 imagegen.last)时升级一次:旧 token 搬进 NovelAI 连接,旧的全局设置拆成每张卡一份,
  卡上以前另设的画风、画师串、不自动出图搬进这张卡自己那份
- 后端只搬字段、不看里面的结构(和 card_prefs 一样,清洗在前端)
"""

from __future__ import annotations

import copy
import json
import os
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, CardPref, TavernCard
from app.plugins.imagegen.connections import KIND_NAMES, TOKEN_ENV, TOKEN_SETTING, first_novelai
from app.plugins.imagegen.models import ImageConnection

SETUP_KEY = "imagegen.setup"
LAST_KEY = "imagegen.last"
# 旧的全局设置(app_settings)和按卡的外观(card_prefs)都是这个键
GLOBAL_KEY = "plugin.imagegen"
SETUP_MAX = 64_000
# 旧全局设置里所有连接共用的:搬到 setup 外层
COMMON = (
    "styleId",
    "size",
    "res",
    "custom",
    "seed",
    "holdLines",
    "place",
    "auto",
    "camera",
    "player",
    "writer",
)
# 旧全局设置里跟着连接走的:搬到 byConn[NovelAI 那条]
PER_CONN = ("model", "steps", "scale", "sampler", "noise", "rescale", "variety", "quality", "ucPreset", "uc", "allowPaid", "skills")
# 以前在卡的 plugin.imagegen 里、现在搬进这张卡 setup 的(角色包不再带)
MOVED = ("styleId", "artists", "autoOff")

_upgrade_lock = threading.Lock()


def blank() -> dict:
    return {"v": 1, "conn": None, "byConn": {}}


def _setting(db: Session, key: str):
    row = db.get(AppSetting, key)
    return row.value if row is not None else None


def _put_setting(db: Session, key: str, value) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def from_legacy(old, nai_id: str | None) -> dict:
    """旧的全局设置 → 一份 setup。NovelAI 那条连接下的参数照旧,画出来和以前一样"""
    old = old if isinstance(old, dict) else {}
    out = blank()
    for k in COMMON:
        if k in old:
            out[k] = copy.deepcopy(old[k])
    if nai_id is not None:
        out["conn"] = nai_id
        out["byConn"][nai_id] = {k: copy.deepcopy(old[k]) for k in PER_CONN if k in old}
    return out


def _with_card(base: dict, card_pref) -> dict:
    """盖上这张卡以前另设的:画风(null = 跟全局)、画师串(空 = 跟画风)、不自动出图"""
    out = copy.deepcopy(base)
    p = card_pref if isinstance(card_pref, dict) else {}
    if isinstance(p.get("styleId"), str) and p["styleId"]:
        out["styleId"] = p["styleId"]
    if isinstance(p.get("artists"), str) and p["artists"].strip():
        out["artists"] = p["artists"]
    if p.get("autoOff") is True:
        out["auto"] = {**(out.get("auto") or {}), "enabled": False}
    return out


def _strip_moved(pref: CardPref | None) -> None:
    if pref is not None and isinstance(pref.value, dict) and any(k in pref.value for k in MOVED):
        pref.value = {k: v for k, v in pref.value.items() if k not in MOVED}


def ensure(db: Session) -> None:
    """第一次用时升级一次(有 imagegen.last 就算升过了)。一个事务做完"""
    if db.get(AppSetting, LAST_KEY) is not None:
        return
    with _upgrade_lock:
        if db.get(AppSetting, LAST_KEY) is not None:
            return
        old = _setting(db, GLOBAL_KEY)
        legacy = _setting(db, TOKEN_SETTING)
        legacy = legacy.strip() if isinstance(legacy, str) else ""
        nai = first_novelai(db)
        if nai is None and (legacy or os.environ.get(TOKEN_ENV, "").strip() or isinstance(old, dict)):
            nai = ImageConnection(name=KIND_NAMES["novelai"], kind="novelai")
            db.add(nai)
            db.flush()
        if nai is not None and legacy and not nai.api_key:
            nai.api_key = legacy
        legacy_row = db.get(AppSetting, TOKEN_SETTING)
        if legacy_row is not None:
            db.delete(legacy_row)
        base = from_legacy(old, nai.id if nai is not None else None)
        looks = {p.card_id: p for p in db.scalars(select(CardPref).where(CardPref.key == GLOBAL_KEY))}
        done = set(db.scalars(select(CardPref.card_id).where(CardPref.key == SETUP_KEY)))
        for card_id in db.scalars(select(TavernCard.id)).all():
            if card_id in done:
                continue
            look = looks.get(card_id)
            db.add(CardPref(card_id=card_id, key=SETUP_KEY, value=_with_card(base, look.value if look else None)))
            _strip_moved(look)
        _put_setting(db, LAST_KEY, base)
        db.commit()


def _conn_ids(db: Session) -> list[str]:
    return list(db.scalars(select(ImageConnection.id).order_by(ImageConnection.created_at)))


def setup_for(db: Session, card_id: str) -> dict:
    """这张卡的那份:没有就抄上次的(盖上这张卡以前另设的)存下来;选的连接没了时,只剩一条就换成那条"""
    ensure(db)
    row = db.get(CardPref, (card_id, SETUP_KEY))
    if row is None:
        look = db.get(CardPref, (card_id, GLOBAL_KEY))
        last = _setting(db, LAST_KEY)
        row = CardPref(card_id=card_id, key=SETUP_KEY, value=_with_card(last if isinstance(last, dict) else blank(), look.value if look else None))
        db.add(row)
        _strip_moved(look)
    value = copy.deepcopy(row.value) if isinstance(row.value, dict) else blank()
    ids = _conn_ids(db)
    if value.get("conn") not in ids:
        value["conn"] = ids[0] if len(ids) == 1 else None
        row.value = copy.deepcopy(value)
    db.commit()
    return value


def save(db: Session, card_id: str, value: dict) -> dict:
    """整份换掉这张卡的那份,同时记成「上次的」给新卡抄"""
    ensure(db)
    if len(json.dumps(value, ensure_ascii=False)) > SETUP_MAX:
        raise ValueError("生图设置太长了")
    conn = value.get("conn")
    if conn is not None and db.get(ImageConnection, conn) is None:
        raise LookupError("选的画图连接不在了")
    row = db.get(CardPref, (card_id, SETUP_KEY))
    if row is None:
        db.add(CardPref(card_id=card_id, key=SETUP_KEY, value=copy.deepcopy(value)))
    else:
        row.value = copy.deepcopy(value)
    _put_setting(db, LAST_KEY, copy.deepcopy(value))
    db.commit()
    return value
