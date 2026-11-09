"""生图卡带的接口 /api/imagegen。

token 和 Jev 的 key 一样存在 app_settings 的 secret.* 里(/api/settings 读不到、导出用户数据时跳过),只写不读;
环境变量 NOVELAI_TOKEN 优先。出图要的设置(画风、外貌、尺寸……)由前端每次带上,这里不存。
11-07 起出图走画图连接(connections.py),不带 connection_id 的老请求照以前用 NovelAI token。
参考图(只 V4.5):默认用这张卡当前立绘包的默认立绘,玩家可以换成别的立绘或上传一张(imagegen_refs)。
"""

from __future__ import annotations

import base64
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import bindings
from app.api.sprites import current_sprites
from app.assets.common import MAX_IMAGE_BYTES, sniff_image_mime
from app.contracts import LABEL_MAX
from app.db import get_db
from app.llm.errors import LLMError
from app.llm.registry import active_connection
from app.models import ApiConnection, AppSetting, CgAsset, CgPack, PackSprite, TavernCard
from app.plugins.imagegen import nai, previews, writer
from app.plugins.imagegen.assemble import QUALITY, Assembled, Look, Person, Plan, Style, assemble, join, natural
from app.plugins.imagegen.sdprompt import SD_QUALITY, SD_UC, sd_prompt
from app.plugins.imagegen.backends import novelai, registry, sdapi
from app.plugins.imagegen.backends.base import BackendError, Conn, Job, LoraUse, Result
from app.plugins.imagegen import connections as conns
from app.plugins.imagegen import setup as setup_mod
from app.plugins.imagegen.connections import TOKEN_ENV, TOKEN_SETTING
from app.plugins.imagegen.models import UPLOAD_REF, GeneratedImage, ImagegenRef, ImageConnection
from app.plugins.imagegen.schemas import (
    AccountOut,
    CharOut,
    CheckOut,
    DefaultsOut,
    GenerateIn,
    ImageOut,
    KeepOut,
    LookAskIn,
    LookAskOut,
    NoteIn,
    NoteIO,
    NoteOut,
    PictureIO,
    PlanIn,
    PlanOut,
    RefImageOut,
    RefIn,
    SetupIn,
    StatusOut,
    TokenIn,
    TrialOut,
)
from app.storage import refs
from app.storage.blobs import store

router = APIRouter(prefix="/api/imagegen", tags=["imagegen"])

# 收藏用的 CG 包认这一句说明(一张卡一个,第一次收藏时建、绑到卡上)
KEEP_PACK_NOTE = "生图(BETA)里点「收藏」的图都放在这里"
_LABEL_BAD = str.maketrans({c: " " for c in "\n\r<>[]{}【】「」"})


# ── token ──


def token_source(db: Session) -> tuple[str | None, str | None]:
    """没指定连接时(老前端)用哪个 token:环境变量 → 第一条 NovelAI 连接的 key → 11-07 以前存的 secret"""
    env = os.environ.get(TOKEN_ENV, "").strip()
    if env:
        return env, "env"
    conn = conns.first_novelai(db)
    if conn is not None and conn.api_key:
        return conn.api_key, "settings"
    row = db.get(AppSetting, TOKEN_SETTING)
    value = row.value.strip() if row is not None and isinstance(row.value, str) else ""
    return (value, "settings") if value else (None, None)


def connection_token(c: ImageConnection) -> str:
    """指定了 NovelAI 连接:用它自己的 key,没填用环境变量"""
    token = (c.api_key or "").strip() or os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        raise HTTPException(400, f"「{c.name}」还没填 NovelAI token")
    return token


def _token(db: Session) -> str:
    token, _ = token_source(db)
    if not token:
        raise HTTPException(400, "还没填 NovelAI token(生图设置的「连接」页)")
    return token


@router.get("/status", response_model=StatusOut)
def status(db: Session = Depends(get_db)):
    token, source = token_source(db)
    return StatusOut(has_token=token is not None, source=source)


@router.put("/token", response_model=StatusOut)
def put_token(req: TokenIn, db: Session = Depends(get_db)):
    """老前端「服务」页填 token:写进第一条 NovelAI 连接(没有就建一条),11-07 以前存的 secret 删掉"""
    value = req.token.strip()
    conn = conns.first_novelai(db)
    if conn is None and value:
        conn = ImageConnection(name=conns.KIND_NAMES["novelai"], kind="novelai")
        db.add(conn)
    if conn is not None:
        conn.api_key = value or None
    legacy = db.get(AppSetting, TOKEN_SETTING)
    if legacy is not None:
        db.delete(legacy)
    db.commit()
    return status(db)


@router.get("/account", response_model=AccountOut)
async def account(db: Session = Depends(get_db)):
    try:
        return AccountOut(**await nai.account(_token(db)))
    except nai.NaiError as e:
        raise HTTPException(502, e.message) from e


@router.get("/defaults", response_model=DefaultsOut)
def defaults():
    return DefaultsOut(
        skills=writer.DEFAULT_SKILLS,
        models=list(nai.MODELS),
        quality=QUALITY,
        free_pixels=nai.FREE_PIXELS,
        free_steps=nai.FREE_STEPS,
        uc_presets=nai.UC_PRESETS,
        quality_presets=nai.QUALITY_PRESETS,
    )


# ── 指导模型 ──


def _connection(db: Session, connection_id: str | None) -> ApiConnection:
    if connection_id:
        conn = db.get(ApiConnection, connection_id)
        if conn is None:
            raise HTTPException(404, "选的指导模型连接不存在了(插件页「生图」重新选一个)")
        return conn
    conn = active_connection(db)
    if conn is None:
        raise HTTPException(400, "没有可用的聊天连接")
    return conn


def _picture(plan: Plan) -> PictureIO:
    return PictureIO(
        scene=plan.scene,
        people=[{"who": p.who, "tags": p.tags, "clothes": p.clothes, "look": p.look} for p in plan.people],
        nsfw=plan.nsfw,
        pov=plan.pov,
        composition=plan.composition,
    )


def _who(req_cast) -> list[writer.Who]:
    return [writer.Who(name=w.name, gender=w.gender, look=w.look, outfit=w.outfit, player=w.player) for w in req_cast]


def _note_in(note: NoteIO | None) -> writer.Note | None:
    if note is None:
        return None
    people = tuple(writer.NotePerson(who=p.who, look=p.look, clothes=p.clothes, notes=p.notes) for p in note.people)
    return writer.Note(place=note.place, people=people, story=note.story)


@router.post("/plan", response_model=PlanOut)
async def plan(req: PlanIn, db: Session = Depends(get_db)):
    """问指导模型:手动 = 画这一幕写什么;自动 = 要不要出、在哪一句、写什么。不出图,不花 Anlas"""
    conn = _connection(db, req.connection_id)
    ctx = writer.Context(
        cast=_who(req.cast),
        lines=[writer.Line(speaker=line.speaker, text=line.text) for line in req.lines],
        focus=req.focus,
        place=req.place,
        want=req.want,
        user_text=req.user_text,
        since=req.since,
        last=req.last,
        drawn=[writer.Drawn(line=d.line, title=d.title, description=d.description, clothes=d.clothes) for d in req.drawn],
        note=_note_in(req.note),
        sfw_only=req.sfw_only,
        camera=req.camera,
    )
    messages = writer.messages_for(
        ctx,
        req.mode,
        req.skill,
    )
    try:
        text, ms = await writer.ask(conn, messages, req.thinking)
    except LLMError as e:
        raise HTTPException(502, f"指导模型({conn.name})出错:{e.message}") from e
    try:
        result = writer.to_result(
            writer.parse_json(text),
            mode=req.mode,
            n_lines=len(req.lines),
            sfw_only=req.sfw_only,
            camera=req.camera,
            focus=req.focus,
        )
    except writer.WriterError as e:
        raise HTTPException(502, f"{e.message}。它回的是:{e.raw}") from e
    return PlanOut(
        draw=result.draw,
        at=result.at,
        until=result.until,
        importance=result.importance,
        reason=result.reason,
        title=result.title,
        description=result.description,
        picture=_picture(result.plan),
        ms=ms,
        connection=conn.name,
    )


@router.post("/note", response_model=NoteOut)
async def note(req: NoteIn, db: Session = Depends(get_db)):
    """记一条回复的状态笔记(每条回复写完时前端调):每个人现在的长相、衣服、特殊的地方,到现在发生了什么。不存库,前端挂在消息上"""
    conn = _connection(db, req.connection_id)
    ctx = writer.NoteContext(
        cast=_who(req.cast),
        lines=[writer.Line(speaker=line.speaker, text=line.text) for line in req.lines],
        prev=_note_in(req.prev),
        place=req.place,
        user_text=req.user_text,
    )
    try:
        text, ms = await writer.ask(conn, writer.note_messages(ctx, req.skill), req.thinking)
        result = writer.to_note(writer.parse_json(text))
    except LLMError as e:
        raise HTTPException(502, f"指导模型({conn.name})出错:{e.message}") from e
    except writer.WriterError as e:
        raise HTTPException(502, f"{e.message}。它回的是:{e.raw}") from e
    return NoteOut(
        place=result.place,
        people=[{"who": p.who, "look": p.look, "clothes": p.clothes, "notes": p.notes} for p in result.people],
        story=result.story,
        ms=ms,
        connection=conn.name,
    )


@router.post("/look", response_model=LookAskOut)
async def ask_look(req: LookAskIn, db: Session = Depends(get_db)):
    """让指导模型读角色卡,写一版平时的外貌标签(玩家再改)"""
    card = db.get(TavernCard, req.card_id)
    if card is None:
        raise HTTPException(404, "角色卡不存在")
    conn = _connection(db, req.connection_id)
    try:
        text, ms = await writer.ask(conn, writer.look_messages(card, req.skill), req.thinking)
        data = writer.parse_json(text)
    except LLMError as e:
        raise HTTPException(502, f"指导模型({conn.name})出错:{e.message}") from e
    except writer.WriterError as e:
        raise HTTPException(502, f"{e.message}。它回的是:{e.raw}") from e
    tags = writer._text(data.get("tags"))
    if not tags:
        raise HTTPException(502, "指导模型没写外貌标签")
    gender = "male" if str(data.get("gender", "")).strip().lower() == "male" else "female"
    return LookAskOut(
        tags=tags, outfit=writer._text(data.get("outfit")), gender=gender, name_tag=writer._text(data.get("name_tag")), ms=ms
    )


# ── 每张卡自己的设置(11-07)──


@router.get("/setup", response_model=dict[str, Any])
def get_setup(card_id: str, db: Session = Depends(get_db)):
    """这张卡的生图设置(不进角色包)。第一次用时把旧的全局设置拆到每张卡"""
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")
    return setup_mod.setup_for(db, card_id)


@router.put("/setup", response_model=dict[str, Any])
def put_setup(card_id: str, req: SetupIn, db: Session = Depends(get_db)):
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")
    try:
        return setup_mod.save(db, card_id, req.value)
    except ValueError as e:
        raise HTTPException(413, str(e)) from e
    except LookupError as e:
        raise HTTPException(400, str(e)) from e


# ── 出图 ──


def image_out(row: GeneratedImage) -> ImageOut:
    return ImageOut(
        id=row.id,
        sha=row.data_sha,
        card_id=row.card_id,
        chat_id=row.chat_id,
        entry_id=row.entry_id,
        swipe=row.swipe,
        line=row.line,
        trigger=row.trigger,
        title=row.title,
        description=row.description,
        picture=row.plan or {},
        prompt=row.prompt,
        negative=row.negative,
        chars=[CharOut(**c) for c in row.chars or []],
        params=row.params or {},
        ms=row.ms,
        kept_asset_id=row.kept_asset_id,
        created_at=row.created_at,
    )


def _reference_bytes(db: Session, card_id: str | None, ref: RefIn) -> bytes | None:
    """参考图的原图:上传的按编号找;立绘按编号找,没给编号用这张卡当前立绘包的默认立绘(排第一的、启用的、有图的)"""
    if ref.kind == "upload":
        row = db.get(ImagegenRef, ref.id) if ref.id else None
        return refs.read_bytes(UPLOAD_REF, row) if row is not None else None
    sprite = db.get(PackSprite, ref.id) if ref.id else None
    if sprite is None and card_id:
        sprite = next((s for s in current_sprites(card_id, db) if s.enabled and s.mime), None)
    return refs.read_bytes(refs.SPRITE, sprite) if sprite is not None and sprite.mime else None


async def _reference(db: Session, req: GenerateIn) -> tuple[str | None, nai.Reference | None, str]:
    """这张要不要带参考图:模型是 V4.5、有人设了参考图、这个人在画面里。返回(谁、参考图、没带上的原因)"""
    name = next((n for n, v in req.looks.items() if v.ref is not None and not v.player), None)
    if name is None:
        return None, None, ""
    if not nai.supports_reference(req.model):
        return None, None, "这个模型不能用参考图(只有 V4.5 能)"
    if all(p.who != name for p in req.picture.people):
        return None, None, ""
    ref = req.looks[name].ref
    data = _reference_bytes(db, req.card_id, ref)
    if data is None:
        return None, None, "找不到参考图(这张卡没有立绘,或者选的图删了),这张用文字写的长相"
    try:
        image = await run_in_threadpool(nai.reference_canvas, data)
    except nai.NaiError as e:
        return None, None, f"{e.message},这张用文字写的长相"
    return name, nai.Reference(image=image, style=ref.style, strength=ref.strength), ""


def _conn_values(c: ImageConnection) -> Conn:
    """数据库对象 → 发请求要的那几项。NovelAI 没填 key 用环境变量,没有就报错;别的种类 key 可以空(本地服务)"""
    key = connection_token(c) if c.kind == "novelai" else (c.api_key or "").strip()
    return Conn(id=c.id, name=c.name, kind=c.kind, base_url=c.base_url, api_key=key, options=dict(c.options or {}))


def _conn_of(db: Session, connection_id: str | None) -> Conn:
    """这张用哪条连接。给了编号就用那条;没给(老前端)照以前:token 按 环境变量 → 连接 → 旧 secret 找"""
    if connection_id:
        c = conns.load(db, connection_id)
        if not registry.drawable(c.kind):
            raise HTTPException(400, f"「{c.name}」这种连接还不能出图")
        return _conn_values(c)
    token = _token(db)
    c = conns.first_novelai(db)
    if c is None:
        return Conn(id=None, name=conns.KIND_NAMES["novelai"], kind="novelai", base_url=None, api_key=token)
    return Conn(id=c.id, name=c.name, kind="novelai", base_url=c.base_url, api_key=token, options=dict(c.options or {}))


@dataclass(frozen=True)
class _Drawn:
    conn: Conn
    built: Assembled
    result: Result
    seed: int
    quality: str
    ref_name: str | None
    reference: nai.Reference | None
    ref_note: str
    ms: int


def _plan_of(picture: PictureIO) -> Plan:
    return Plan(
        scene=picture.scene,
        people=tuple(Person(p.who, p.tags, p.clothes, p.look) for p in picture.people),
        nsfw=picture.nsfw,
        pov=picture.pov,
        composition=picture.composition,
    )


def _looks_of(req: GenerateIn, ref_name: str | None) -> dict[str, Look]:
    return {
        name: Look(
            tags=v.tags,
            negative=v.negative,
            gender=v.gender,
            player=v.player,
            outfit=v.outfit,
            name_tag=v.name_tag,
            ref=name == ref_name,
        )
        for name, v in req.looks.items()
    }


def _plain_reference(db: Session, req: GenerateIn) -> tuple[str | None, bytes | None, str]:
    """NovelAI 以外:这张带不带参考图原件。返回(谁、原件、没带上的原因)"""
    name = next((n for n, v in req.looks.items() if v.ref is not None and not v.player), None)
    if name is None or all(p.who != name for p in req.picture.people):
        return None, None, ""
    data = _reference_bytes(db, req.card_id, req.looks[name].ref)
    if data is None:
        return None, None, "找不到参考图(这张卡没有立绘,或者选的图删了),这张用文字写的长相"
    return name, data, ""


def _remember_api(db: Session, conn: Conn, model: str, api: str | None) -> None:
    """接口选「自动」时,把这个模型试成功的那种记进连接,下次先用它"""
    if not conn.id or not api or (conn.options.get("api") or "auto") != "auto":
        return
    known = dict(conn.options.get("resolved") or {})
    if known.get(model) == api:
        return
    row = db.get(ImageConnection, conn.id)
    if row is None:
        return
    row.options = {**(row.options or {}), "resolved": {**known, model: api}}
    db.commit()


async def _draw_other(req: GenerateIn, db: Session, conn: Conn) -> _Drawn:
    """NovelAI 以外的连接:提示词拼成一段,交给这种连接的后端"""
    plan_ = _plan_of(req.picture)
    sd = conn.kind == "sdapi"
    # 本地 SD 这期不发参考图(ControlNet、IP-Adapter 各家写法不一样),长相照文字写的
    ref_name, ref_data, ref_note = (None, None, "") if sd else _plain_reference(db, req)
    style = Style(tags=req.style.tags, negative=req.style.negative, artists=req.style.artists)
    looks = _looks_of(req, ref_name)
    loras = tuple(LoraUse(x.name, x.weight, x.trigger) for x in req.loras if x.on)
    quality = req.quality if isinstance(req.quality, str) else ("standard" if req.quality else "none")
    model, sampler = req.model, req.sampler
    if sd:
        # 这张卡在本地 SD 下还没选过时,页面带来的是 NovelAI 的默认值:不发,用服务现在的
        model = "" if model in nai.MODELS else model
        sampler = "" if sampler in nai.SAMPLERS else sampler
        prompt, negative = sd_prompt(
            plan_,
            looks,
            style,
            quality=SD_QUALITY.get(quality, ""),
            uc=join(SD_UC.get(req.uc_preset, ""), req.uc.strip()),
            loras=loras,
            sfw_only=req.sfw_only,
        )
    else:
        prompt, negative = natural(plan_, looks, style), ""
    built = Assembled(prompt=prompt, negative=negative, chars=(), model=model)
    seed = req.seed if req.seed is not None else random.randint(0, 2**32 - 1)
    job = Job(
        prompt=prompt,
        negative=negative,
        width=req.width,
        height=req.height,
        seed=seed,
        model=model,
        steps=req.steps,
        scale=req.scale,
        sampler=sampler,
        scheduler=req.scheduler,
        loras=loras,
        reference=ref_data,
        reference_mime=(sniff_image_mime(ref_data) or "image/png") if ref_data else "",
    )
    backend = registry.backend_of(conn.kind)
    job_id = req.job_id if sd else None
    started = datetime.now()
    try:
        if job_id:
            result = await backend.draw(conn, job, on_preview=lambda image, progress: previews.publish(job_id, image, progress))
        else:
            result = await backend.draw(conn, job)
    except BackendError as e:
        raise HTTPException(e.status, e.message) from e
    finally:
        if job_id:
            previews.finish(job_id)
    ms = round((datetime.now() - started).total_seconds() * 1000)
    _remember_api(db, conn, req.model, result.sent.get("api"))
    return _Drawn(conn=conn, built=built, result=result, seed=seed, quality=quality, ref_name=ref_name, reference=None, ref_note=ref_note, ms=ms)


async def _draw(req: GenerateIn, db: Session) -> _Drawn:
    """照这幅画面拼提示词、用选的连接画一张(不存)。出图和测试出图共用;同一个 NovelAI 账号一次只画一张,后来的排队"""
    conn = _conn_of(db, req.connection_id)
    if conn.kind != "novelai":
        return await _draw_other(req, db, conn)
    if req.model not in nai.MODELS:
        raise HTTPException(400, f"不认识的模型 {req.model}")
    if req.width % 64 or req.height % 64:
        raise HTTPException(400, "宽和高要是 64 的倍数")
    if req.sampler not in nai.SAMPLERS:
        raise HTTPException(400, f"不认识的采样器 {req.sampler}")
    if not req.allow_paid and not nai.is_free(req.width, req.height, req.steps):
        raise HTTPException(
            400,
            f"{req.width}×{req.height}、{req.steps} 步超出了 Opus 的免费范围(面积不超过 1024×1024、不超过 28 步),"
            "每张要扣 Anlas。要画就在生图设置「画面」页的「更多」里打开「允许超出免费范围(每张扣 Anlas)」",
        )
    plan_ = _plan_of(req.picture)
    ref_name, reference, ref_note = await _reference(db, req)
    looks = _looks_of(req, ref_name)
    # 质量词、反向预设按最后用的模型挑(只画全年龄时换成 Curated,两边的原文不一样)
    final_model = nai.SFW_OF.get(req.model, req.model) if req.sfw_only else req.model
    quality = req.quality if isinstance(req.quality, str) else ("standard" if req.quality else "none")
    built = assemble(
        plan_,
        looks,
        Style(tags=req.style.tags, negative=req.style.negative, artists=req.style.artists),
        model=req.model,
        uc=", ".join(x for x in (nai.uc_preset(final_model, req.uc_preset), req.uc.strip()) if x),
        quality=nai.quality_tags(final_model, quality),
        sfw_only=req.sfw_only,
    )
    seed = req.seed if req.seed is not None else random.randint(0, 2**32 - 1)
    body = nai.build_body(
        nai.Request(
            prompt=built.prompt,
            negative=built.negative,
            width=req.width,
            height=req.height,
            seed=seed,
            model=built.model,
            steps=req.steps,
            scale=req.scale,
            sampler=req.sampler,
            chars=built.chars,
            reference=reference,
            noise_schedule=req.noise_schedule,
            cfg_rescale=req.cfg_rescale,
            variety=req.variety,
        )
    )
    started = datetime.now()
    try:
        result = await novelai.draw(conn, body)
    except BackendError as e:
        raise HTTPException(e.status, e.message) from e
    ms = round((datetime.now() - started).total_seconds() * 1000)
    return _Drawn(
        conn=conn,
        built=built,
        result=result,
        seed=seed,
        quality=quality,
        ref_name=ref_name,
        reference=reference,
        ref_note=ref_note,
        ms=ms,
    )


def _params(req: GenerateIn, d: _Drawn) -> dict:
    sent = d.result.sent
    params = {
        "model": d.built.model,
        "width": req.width,
        "height": req.height,
        "steps": req.steps,
        "scale": req.scale,
        "sampler": req.sampler,
        "noise_schedule": sent.get("noise_schedule"),
        "cfg_rescale": req.cfg_rescale,
        "variety": "skip_cfg_above_sigma" in sent,
        "quality": d.quality,
        "uc_preset": req.uc_preset,
        "seed": d.seed,
        # 带了参考图:谁、哪张(立绘 / 上传的编号,null = 默认立绘)、是不是连画风一起参考、强度
        "reference": (
            {
                "who": d.ref_name,
                "kind": req.looks[d.ref_name].ref.kind,
                "id": req.looks[d.ref_name].ref.id,
                "style": d.reference.style,
                "strength": d.reference.strength,
            }
            if d.ref_name and d.reference
            # 中转:原图发过去,没有画风和强度这两项
            else {"who": d.ref_name, "kind": req.looks[d.ref_name].ref.kind, "id": req.looks[d.ref_name].ref.id, "style": False, "strength": 1.0}
            if d.ref_name
            else None
        ),
        "reference_note": d.ref_note,
        # 11-07 起:哪条连接、每段用时(plan 是前端问指导模型花的;NovelAI 的传回算在 draw 里)
        "connection": {"id": d.conn.id, "name": d.conn.name, "kind": d.conn.kind},
        "timing": {**d.result.timing.as_dict(), "plan": req.plan_ms},
    }
    if "api" in sent:
        # 中转:记实际用的接口和吸附后的尺寸;它没有种子这一项
        width, height = sent["size"].split("x")
        params.update(api=sent["api"], width=int(width), height=int(height))
        del params["seed"]
    return params


@router.post("/generate", response_model=ImageOut)
async def generate(req: GenerateIn, db: Session = Depends(get_db)):
    """画一张、存进文件仓库(相册里看得到)"""
    d = await _draw(req, db)
    png = d.result.data
    row = GeneratedImage(
        card_id=req.card_id,
        chat_id=req.chat_id,
        entry_id=req.entry_id,
        swipe=req.swipe,
        line=req.line,
        trigger=req.trigger,
        title=req.title.strip(),
        description=req.description.strip(),
        plan=req.picture.model_dump(),
        prompt=d.built.prompt,
        negative=d.built.negative,
        chars=[{"prompt": c.prompt, "negative": c.negative, "x": c.x, "y": c.y} for c in d.built.chars],
        params=_params(req, d),
        mime=sniff_image_mime(png) or d.result.mime,
        size=len(png),
        ms=d.ms,
    )
    row.data_sha = store().put(png, row.mime, db)
    db.add(row)
    db.commit()
    db.refresh(row)
    return image_out(row)


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    """本地 SD 画的时候的进度图(SSE):前端在 /generate 之前开,带同一个 job_id"""
    if len(job_id) > 64:
        raise HTTPException(404, "没有这个任务")
    return StreamingResponse(previews.events(job_id), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.post("/connections/{conn_id}/test", response_model=TrialOut)
async def trial(conn_id: str, req: GenerateIn, db: Session = Depends(get_db)):
    """测试出图:用这条连接真画一张,图直接回、不进相册。花不花钱和平时出图一样(前端按钮上写明)"""
    req = req.model_copy(update={"connection_id": conn_id})
    d = await _draw(req, db)
    return TrialOut(
        mime=sniff_image_mime(d.result.data) or d.result.mime,
        b64=base64.b64encode(d.result.data).decode(),
        prompt=d.built.prompt,
        negative=d.built.negative,
        chars=[CharOut(prompt=c.prompt, negative=c.negative, x=c.x, y=c.y) for c in d.built.chars],
        params=_params(req, d),
        ms=d.ms,
    )


@router.post("/connections/{conn_id}/check", response_model=CheckOut)
async def check(conn_id: str, db: Session = Depends(get_db)):
    """查连接(不花钱)。连不上不报错,原文放进 message"""
    c = conns.load(db, conn_id)
    if not registry.drawable(c.kind):
        return CheckOut(ok=False, message="这种连接还不能用", ms=0)
    if c.kind == "novelai" and not ((c.api_key or "").strip() or os.environ.get(TOKEN_ENV, "").strip()):
        return CheckOut(ok=False, message="还没填 NovelAI token", ms=0)
    conn = _conn_values(c)
    started = time.perf_counter()
    try:
        message = await registry.backend_of(c.kind).check(conn)
    except BackendError as e:
        return CheckOut(ok=False, message=e.message, ms=round((time.perf_counter() - started) * 1000))
    return CheckOut(ok=True, message=message, ms=round((time.perf_counter() - started) * 1000))


@router.get("/connections/{conn_id}/options", response_model=dict[str, Any])
async def connection_options(conn_id: str, db: Session = Depends(get_db)):
    """这条连接能选的模型、采样器、LoRA(不花钱)。拿不到的项不给,界面上就不显示"""
    c = conns.load(db, conn_id)
    if not registry.drawable(c.kind):
        return {}
    if c.kind == "novelai" and not ((c.api_key or "").strip() or os.environ.get(TOKEN_ENV, "").strip()):
        return await novelai.options(Conn(id=c.id, name=c.name, kind=c.kind, base_url=c.base_url, api_key=""))
    try:
        return await registry.backend_of(c.kind).options(_conn_values(c))
    except BackendError as e:
        raise HTTPException(e.status, e.message) from e


@router.post("/connections/{conn_id}/refresh-loras", status_code=204)
async def refresh_loras(conn_id: str, db: Session = Depends(get_db)):
    """让本地 SD 重新扫一遍 LoRA 文件夹,新放进去的也能选到(界面上的「刷新」)"""
    c = conns.load(db, conn_id)
    if c.kind != "sdapi":
        raise HTTPException(400, f"「{c.name}」不是本地 SD 连接")
    try:
        await sdapi.refresh_loras(_conn_values(c))
    except BackendError as e:
        raise HTTPException(e.status, e.message) from e


@router.get("/connections/{conn_id}/account", response_model=AccountOut)
async def connection_account(conn_id: str, db: Session = Depends(get_db)):
    """一条 NovelAI 连接的账户(等级、Anlas、V5 额度条):连接页「查额度」、画面页算扣不扣 Anlas。
    老的 /account 用的是第一条 NovelAI 连接,有两个号时不对"""
    c = conns.load(db, conn_id)
    if c.kind != "novelai":
        raise HTTPException(400, f"「{c.name}」不是 NovelAI 连接")
    try:
        return AccountOut(**await nai.account(connection_token(c), host=c.base_url or nai.HOST))
    except nai.NaiError as e:
        raise HTTPException(502, e.message) from e


# ── 参考图(上传的) ──


@router.post("/refs", response_model=RefImageOut)
async def upload_ref(card_id: str | None = Form(None), file: UploadFile = File(...), db: Session = Depends(get_db)):
    """上传一张参考图(插件页「这张卡」→ 参考图)。图进文件仓库,这里登记一行;卡的设置里记它的编号"""
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"图片太大了,上限 {MAX_IMAGE_BYTES // 1024 // 1024} MB")
    mime = sniff_image_mime(data)
    if mime is None:
        raise HTTPException(400, "只支持 PNG / JPEG / WebP / GIF 图片")
    row = ImagegenRef(card_id=card_id, mime=mime, size=len(data))
    row.data_sha = store().put(data, mime, db)
    db.add(row)
    db.commit()
    db.refresh(row)
    return RefImageOut(id=row.id, sha=row.data_sha, mime=row.mime)


@router.delete("/refs/{ref_id}", status_code=204)
def delete_ref(ref_id: str, db: Session = Depends(get_db)):
    """换掉 / 不用了:删这一行,文件没人引用以后由文件清理收走"""
    row = db.get(ImagegenRef, ref_id)
    if row is not None:
        db.delete(row)
        db.commit()


# ── 画过的图 ──


def _image(db: Session, image_id: str) -> GeneratedImage:
    row = db.get(GeneratedImage, image_id)
    if row is None:
        raise HTTPException(404, "这张图不在了")
    return row


@router.get("/images", response_model=list[ImageOut])
def list_images(
    card_id: str | None = None,
    chat_id: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    q = select(GeneratedImage).order_by(GeneratedImage.created_at.desc()).limit(limit)
    if card_id:
        q = q.where(GeneratedImage.card_id == card_id)
    if chat_id:
        q = q.where(GeneratedImage.chat_id == chat_id)
    return [image_out(r) for r in db.scalars(q)]


@router.get("/images/{image_id}", response_model=ImageOut)
def get_image(image_id: str, db: Session = Depends(get_db)):
    return image_out(_image(db, image_id))


@router.delete("/images/{image_id}", status_code=204)
def delete_image(image_id: str, db: Session = Depends(get_db)):
    """删记录;文件没人引用以后由文件清理收走(收藏进 CG 包的那张 CG 还引用着,不会删)"""
    db.delete(_image(db, image_id))
    db.commit()


def _keep_pack(db: Session, card: TavernCard) -> CgPack:
    """这张卡收藏用的 CG 包:绑着的包里认说明;没有就建一个、排在这张卡的 CG 包最后。
    包标成 AI 生成(generated),素材页放进「AI 生成」那一栏;第 1 步以前建的没有标记,找到时补上"""
    bound = bindings.targets(db, card.id, bindings.CG)
    for pid in bound:
        pack = db.get(CgPack, pid)
        if pack is not None and pack.description == KEEP_PACK_NOTE:
            pack.generated = True
            return pack
    base = f"AI 生图 · {card.name}".strip()[:100]
    name, n = base, 2
    while db.scalar(select(CgPack.id).where(CgPack.name == name)) is not None:
        name, n = f"{base} {n}", n + 1
    pack = CgPack(name=name, description=KEEP_PACK_NOTE, generated=True)
    db.add(pack)
    db.flush()
    bindings.replace(db, card.id, bindings.CG, [*bound, pack.id])
    return pack


def _keep_label(db: Session, pack_id: str, name: str, when: datetime) -> str:
    """CG 名字(AI / Jev 点名用的):指导模型起的短名字(没有就用说明的前一段),去掉标签里不许有的括号;重名加编号"""
    base = " ".join(name.translate(_LABEL_BAD).split())[: LABEL_MAX - 4].strip() or f"生图 {when:%m-%d %H:%M}"
    taken = {
        x.casefold()
        for x in db.scalars(select(CgAsset.label).where(CgAsset.pack_id == pack_id, CgAsset.parent_id.is_(None)))
    }
    label, n = base, 2
    while label.casefold() in taken:
        label, n = f"{base} {n}", n + 1
    return label


@router.post("/images/{image_id}/keep", response_model=KeepOut)
def keep(image_id: str, db: Session = Depends(get_db)):
    """收藏:复制成这张卡「AI 生图」CG 包里的一张 CG(同一份文件),以后 AI / Jev 能直接选它"""
    row = _image(db, image_id)
    if row.kept_asset_id:
        asset = db.get(CgAsset, row.kept_asset_id)
        if asset is not None:
            pack = db.get(CgPack, asset.pack_id)
            return KeepOut(pack_id=asset.pack_id, pack_name=pack.name if pack else "", asset_id=asset.id, label=asset.label)
    card = db.get(TavernCard, row.card_id) if row.card_id else None
    if card is None:
        raise HTTPException(400, "这张图不知道是哪张卡画的,没法收藏")
    if not row.data_sha:
        raise HTTPException(400, "这张图的文件不在了")
    pack = _keep_pack(db, card)
    last = db.scalar(select(func.max(CgAsset.sort)).where(CgAsset.pack_id == pack.id, CgAsset.parent_id.is_(None)))
    asset = CgAsset(
        pack_id=pack.id,
        label=_keep_label(db, pack.id, row.title or row.description, row.created_at),
        description=row.description,
        mime=row.mime,
        size=row.size,
        data_sha=row.data_sha,
        sort=(last + 1) if last is not None else 0,
    )
    db.add(asset)
    db.flush()
    row.kept_asset_id = asset.id
    db.commit()
    return KeepOut(pack_id=pack.id, pack_name=pack.name, asset_id=asset.id, label=asset.label)
