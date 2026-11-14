"""画图连接 /api/imagegen/connections(设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 2 节)。

- 地址和 key 只填一次,每张卡在 imagegen.setup 里选用哪条
- api_key 只写不读。改地址时没一起给 key 就把旧 key 清掉:本地版没有登录,同一个 Wi-Fi 的人能调接口,
  留着旧 key 等于让人能把它骗到别的服务器上
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import CardPref
from app.plugins.imagegen.models import ImageConnection
from app.plugins.imagegen.schemas import ImageConnIn, ImageConnOut, ImageConnPatch

router = APIRouter(prefix="/api/imagegen/connections", tags=["imagegen"])

# 11-07 以前 NovelAI token 存在这里(app_settings,只写不读);第一次用新设置时搬进 NovelAI 连接
TOKEN_SETTING = "secret.novelai_token"
TOKEN_ENV = "NOVELAI_TOKEN"
KIND_NAMES = {"novelai": "NovelAI", "sdapi": "本地 SD", "openai": "中转站"}
OPTIONS_MAX = 20_000


def conn_out(c: ImageConnection) -> ImageConnOut:
    return ImageConnOut(
        id=c.id,
        name=c.name,
        kind=c.kind,
        base_url=c.base_url,
        has_key=bool(c.api_key),
        options=c.options or {},
        created_at=c.created_at,
    )


def _url(v: str | None) -> str | None:
    v = (v or "").strip().rstrip("/")
    return v or None


def _options(v: dict) -> dict:
    if len(json.dumps(v, ensure_ascii=False)) > OPTIONS_MAX:
        raise HTTPException(413, "连接选项太长了")
    return v


def load(db: Session, conn_id: str) -> ImageConnection:
    c = db.get(ImageConnection, conn_id)
    if c is None:
        raise HTTPException(404, "这条画图连接不在了")
    return c


def first_novelai(db: Session) -> ImageConnection | None:
    q = select(ImageConnection).where(ImageConnection.kind == "novelai").order_by(ImageConnection.created_at)
    return db.scalars(q).first()


@router.get("", response_model=list[ImageConnOut])
def list_connections(db: Session = Depends(get_db)):
    # 放在函数里 import:setup.py 也 import 这个文件,写在顶上会绕成循环
    from app.plugins.imagegen.setup import ensure

    ensure(db)  # 第一次用:旧 token 先搬进 NovelAI 连接,列表里才看得到
    rows = db.scalars(select(ImageConnection).order_by(ImageConnection.created_at)).all()
    return [conn_out(c) for c in rows]


@router.get("/usage", response_model=dict[str, int])
def connection_usage(db: Session = Depends(get_db)):
    """每条连接有几张卡在用(连接页改地址、key 时写在旁边):数每张卡 imagegen.setup 里选的 conn"""
    # 放在函数里 import:setup.py 也 import 这个文件,写在顶上会绕成循环
    from app.plugins.imagegen.setup import SETUP_KEY, ensure

    ensure(db)  # 和连接列表一样,第一次用先升级,数出来才对
    used: dict[str, int] = {}
    for value in db.scalars(select(CardPref.value).where(CardPref.key == SETUP_KEY)):
        conn = value.get("conn") if isinstance(value, dict) else None
        if isinstance(conn, str) and conn:
            used[conn] = used.get(conn, 0) + 1
    return used


@router.post("", response_model=ImageConnOut)
def create_connection(req: ImageConnIn, db: Session = Depends(get_db)):
    c = ImageConnection(
        name=req.name.strip() or KIND_NAMES[req.kind],
        kind=req.kind,
        base_url=_url(req.base_url),
        api_key=(req.api_key or "").strip() or None,
        options=_options(req.options),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return conn_out(c)


@router.put("/{conn_id}", response_model=ImageConnOut)
def update_connection(conn_id: str, req: ImageConnPatch, db: Session = Depends(get_db)):
    c = load(db, conn_id)
    sent = req.model_dump(exclude_unset=True)
    if sent.get("name") is not None:
        c.name = sent["name"].strip() or KIND_NAMES.get(c.kind, c.kind)
    if "base_url" in sent:
        new = _url(sent["base_url"])
        if new != c.base_url:
            c.base_url = new
            if "api_key" not in sent:
                c.api_key = None
    if "api_key" in sent:
        c.api_key = (sent["api_key"] or "").strip() or None
    if sent.get("options") is not None:
        c.options = _options(sent["options"])
    db.commit()
    db.refresh(c)
    return conn_out(c)


@router.delete("/{conn_id}", status_code=204)
def delete_connection(conn_id: str, db: Session = Depends(get_db)):
    db.delete(load(db, conn_id))
    db.commit()
