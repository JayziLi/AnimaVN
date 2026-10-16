"""立绘插件:立绘包、包里的「表情名 → 立绘图」映射,以及角色卡挂哪些包。

一个立绘包是一整套表情立绘,和场景包一样不属于某张卡:卡挂一个或几个包,其中一个是
「当前」,游戏里随时换;同一个包也能挂在好几张卡上。按卡读的两个接口(立绘列表、封面
头像)读的是这张卡的当前包。

表情名是给 AI 用的词汇表(label + aliases),图是 BLOB。列表接口只返回元数据
和 has_image,图单独按 id 取,并且带版本号走长缓存 —— 视觉小说界面切换表情时,
图片都是直接从浏览器缓存里拿的。
"""

import copy
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

# 名字和图片的校验在 app/assets/common.py(立绘、场景包、声音共用);这几个名字连同 LABEL_MAX
# 在这里留着同名导出,外面的脚本 from app.api.sprites import ... 照旧能用
from app import bindings
from app.assets.common import MAX_IMAGE_BYTES, clean_aliases, clean_label, sniff_image_mime, unique_pack_name
from app.contracts import LABEL_MAX  # noqa: F401  (同名导出)
from app.db import get_db
from app.emotion.lists import PACK_PREFIX
from app.images import MAX_WIDTH, MIN_WIDTH, shrink_image
from app.models import PackSprite, SpritePack, SpritePackLayout, TavernCard, WordRecord
from app.schemas import (
    CardSpritePackCurrentIn,
    CardSpritePacksIn,
    CardSpritePacksOut,
    PackDuplicateIn,
    SpriteCreate,
    SpriteLayoutOut,
    SpriteLayoutUpdate,
    SpriteOut,
    SpritePackIn,
    SpritePackOut,
    SpritePackUpdate,
    SpriteReorderRequest,
    SpriteUpdate,
)
from app.sprite_faces import face_thumbnail, scan
from app.storage import refs

router = APIRouter(tags=["sprites"])

PACKS = "/api/sprite-packs"
SPRITES = PACKS + "/{pack_id}/sprites"
CARD = "/api/tavern/cards/{card_id}"


def _load_card(card_id: str, db: Session) -> TavernCard:
    card = db.get(TavernCard, card_id)
    if card is None:
        raise HTTPException(404, "角色卡不存在")
    return card


def _load_pack(pack_id: str, db: Session) -> SpritePack:
    pack = db.get(SpritePack, pack_id)
    if pack is None:
        raise HTTPException(404, "立绘包不存在")
    return pack


def _load_sprite(pack_id: str, sprite_id: str, db: Session) -> PackSprite:
    sprite = db.get(PackSprite, sprite_id)
    if sprite is None or sprite.pack_id != pack_id:
        raise HTTPException(404, "立绘不存在")
    return sprite


def _version(sprite: PackSprite) -> int:
    return int(sprite.updated_at.timestamp() * 1000)


def _out(sprite: PackSprite) -> SpriteOut:
    return SpriteOut(
        id=sprite.id,
        pack_id=sprite.pack_id,
        label=sprite.label,
        aliases=list(sprite.aliases or []),
        description=sprite.description,
        has_image=sprite.mime is not None,
        image_version=_version(sprite),
        image_sha=sprite.image_sha if sprite.mime is not None else None,
        sort=sprite.sort,
        enabled=sprite.enabled,
        face_scan=sprite.face_scan,
        effect=sprite.effect,
    )


def _check_unique(pack_id: str, names: list[str], db: Session, exclude_id: str | None = None):
    """同一个包里,任何两行的表情名/别名都不能撞 —— 撞了就不知道该换哪张图。
    不同的包可以(也最好)用同一套名字:换包时按名字对上。"""
    taken: dict[str, str] = {}
    for row in db.scalars(select(PackSprite).where(PackSprite.pack_id == pack_id)):
        if row.id == exclude_id:
            continue
        for n in [row.label, *(row.aliases or [])]:
            taken[n.casefold()] = row.label
    for n in names:
        owner = taken.get(n.casefold())
        if owner is not None:
            raise HTTPException(409, f"表情名「{n}」已经被「{owner}」占用了")


def _pack_sprites(pack_id: str, db: Session) -> list[PackSprite]:
    """排第一的是默认表情。"""
    return list(
        db.scalars(
            select(PackSprite)
            .where(PackSprite.pack_id == pack_id)
            .order_by(PackSprite.sort, PackSprite.created_at)
        ).all()
    )


# ── 立绘包 ──


def _clean_pack_name(raw: str, db: Session, exclude_id: str | None = None) -> str:
    name = raw.strip()
    if not name:
        raise HTTPException(400, "立绘包名字不能为空")
    if len(name) > 120:
        raise HTTPException(400, "立绘包名字最长 120 个字")
    for row in db.scalars(select(SpritePack)):
        if row.id != exclude_id and row.name.casefold() == name.casefold():
            raise HTTPException(409, f"已经有叫「{name}」的立绘包了")
    return name


def _pack_out(pack: SpritePack, db: Session) -> SpritePackOut:
    sprites = db.scalar(
        select(func.count()).select_from(PackSprite).where(PackSprite.pack_id == pack.id)
    )
    return SpritePackOut(
        id=pack.id,
        name=pack.name,
        description=pack.description,
        sprite_count=sprites or 0,
        card_count=bindings.count_cards(db, bindings.SPRITE, pack.id),
    )


@router.get(PACKS, response_model=list[SpritePackOut])
def list_packs(db: Session = Depends(get_db)):
    packs = db.scalars(select(SpritePack).order_by(SpritePack.created_at)).all()
    return [_pack_out(p, db) for p in packs]


@router.post(PACKS, response_model=SpritePackOut)
def create_pack(req: SpritePackIn, db: Session = Depends(get_db)):
    pack = SpritePack(name=_clean_pack_name(req.name, db), description=req.description.strip())
    db.add(pack)
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, db)


@router.put(PACKS + "/{pack_id}", response_model=SpritePackOut)
def update_pack(pack_id: str, req: SpritePackUpdate, db: Session = Depends(get_db)):
    pack = _load_pack(pack_id, db)
    if req.name is not None:
        pack.name = _clean_pack_name(req.name, db, exclude_id=pack_id)
    if req.description is not None:
        pack.description = req.description.strip()
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, db)


def delete_sprite_pack(db: Session, pack_id: str) -> bool:
    """删一个立绘包:连同包里的立绘、摆法、所有绑定。拿它当当前包的卡换成它后面挂着的下一个包。
    不提交;包已经不在了返回 False。删包接口、撤销导入(app/importer/jobs.py)、素材管理页共用"""
    pack = db.get(SpritePack, pack_id)
    if pack is None:
        return False
    for card_id in bindings.cards_using(db, bindings.SPRITE, pack_id):
        old = bindings.targets(db, card_id, bindings.SPRITE)
        was = bindings.primary(db, card_id, bindings.SPRITE)
        keep = [p for p in old if p != pack_id]
        current = was if was in keep else _next_current(old, was, keep)
        bindings.replace(db, card_id, bindings.SPRITE, keep, current)
    # SQLite 没开外键约束,不会自动级联
    db.execute(delete(PackSprite).where(PackSprite.pack_id == pack_id))
    db.execute(delete(SpritePackLayout).where(SpritePackLayout.pack_id == pack_id))
    db.delete(pack)
    db.flush()
    return True


@router.delete(PACKS + "/{pack_id}", status_code=204)
def delete_pack(pack_id: str, db: Session = Depends(get_db)):
    """连同包里的立绘、摆法、所有绑定一起删。拿它当当前包的卡换成它后面挂着的下一个包。"""
    _load_pack(pack_id, db)
    delete_sprite_pack(db, pack_id)
    db.commit()


def duplicate_sprite_pack(db: Session, pack_id: str, name: str | None = None) -> SpritePack:
    """复制一个立绘包(素材管理页「创建副本」):立绘照抄(名字、别名、说明、顺序、启用、找脸结果、入场动效),
    图按指纹共用;摆法、认词记录(pack:<id>,记的那一项换成副本里的同一张)一起复制。不绑到任何卡。
    name 不给就叫「X 副本」(撞名加「 2」);给了照建包的规矩查(撞名 409)。不提交"""
    src = _load_pack(pack_id, db)
    name = _clean_pack_name(name, db) if name and name.strip() else unique_pack_name(db, SpritePack, f"{src.name} 副本")
    pack = SpritePack(id=uuid.uuid4().hex, name=name, description=src.description)
    db.add(pack)
    ids: dict[str, str] = {}
    for s in _pack_sprites(pack_id, db):
        row = PackSprite(
            id=uuid.uuid4().hex,
            pack_id=pack.id,
            label=s.label,
            aliases=list(s.aliases or []),
            description=s.description,
            mime=s.mime,
            sort=s.sort,
            enabled=s.enabled,
            face_scan=copy.deepcopy(s.face_scan),
            effect=copy.deepcopy(s.effect),
        )
        refs.copy_content(refs.SPRITE, s, row, db)
        db.add(row)
        ids[s.id] = row.id
    layout = db.get(SpritePackLayout, pack_id)
    if layout is not None:
        db.add(SpritePackLayout(pack_id=pack.id, auto=layout.auto, zoom=layout.zoom, dx=layout.dx, dy=layout.dy))
    # 认词记录:这一项在副本里是哪张就记哪张;指着已经删掉的立绘的不抄
    for rec in db.scalars(select(WordRecord).where(WordRecord.list_ref == PACK_PREFIX + pack_id)).all():
        if rec.item in ids:
            db.add(
                WordRecord(
                    list_ref=PACK_PREFIX + pack.id,
                    word=rec.word,
                    item=ids[rec.item],
                    source=rec.source,
                    guessed=rec.guessed,
                    unstable=rec.unstable,
                    score=rec.score,
                )
            )
    db.flush()
    return pack


@router.post(PACKS + "/{pack_id}/duplicate", response_model=SpritePackOut)
def duplicate_pack(pack_id: str, req: PackDuplicateIn | None = None, db: Session = Depends(get_db)):
    pack = duplicate_sprite_pack(db, pack_id, req.name if req else None)
    db.commit()
    return _pack_out(pack, db)


# ── 包里的立绘 ──


@router.get(SPRITES, response_model=list[SpriteOut])
def list_sprites(pack_id: str, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    return [_out(r) for r in _pack_sprites(pack_id, db)]


@router.post(SPRITES, response_model=SpriteOut)
def create_sprite(pack_id: str, req: SpriteCreate, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    label = clean_label(req.label)
    aliases = clean_aliases(req.aliases, label)
    _check_unique(pack_id, [label, *aliases], db)
    last = db.scalar(select(func.max(PackSprite.sort)).where(PackSprite.pack_id == pack_id))
    sprite = PackSprite(
        pack_id=pack_id,
        label=label,
        aliases=aliases,
        description=req.description.strip(),
        sort=(last + 1) if last is not None else 0,
    )
    db.add(sprite)
    db.commit()
    db.refresh(sprite)
    return _out(sprite)


# 位置:按脸对齐 + 每个包的微调。
# /layout 要写在 /{sprite_id} 前面,不然 PUT /layout 会被当成改一张叫 layout 的立绘


def _layout_out(row: SpritePackLayout | None) -> SpriteLayoutOut:
    if row is None:
        return SpriteLayoutOut(auto=True, zoom=1.0, dx=0.0, dy=0.0)
    return SpriteLayoutOut(auto=row.auto, zoom=row.zoom, dx=row.dx, dy=row.dy)


@router.get(SPRITES + "/layout", response_model=SpriteLayoutOut)
def get_sprite_layout(pack_id: str, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    return _layout_out(db.get(SpritePackLayout, pack_id))


@router.put(SPRITES + "/layout", response_model=SpriteLayoutOut)
def update_sprite_layout(pack_id: str, req: SpriteLayoutUpdate, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    row = db.get(SpritePackLayout, pack_id)
    if row is None:
        row = SpritePackLayout(pack_id=pack_id, auto=True, zoom=1.0, dx=0.0, dy=0.0)
        db.add(row)
    for key, value in req.model_dump(exclude_none=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _layout_out(row)


@router.post(SPRITES + "/scan-faces", response_model=list[SpriteOut])
def scan_sprite_faces(pack_id: str, rescan: bool = False, db: Session = Depends(get_db)):
    """给还没找过脸的立绘补上(rescan=true 时全部重找)。

    只写 face_scan、不动 updated_at:图没变,图片地址里的版本号就不能变,
    不然浏览器要把整套图重新下载一遍。
    """
    _load_pack(pack_id, db)
    query = select(PackSprite).where(PackSprite.pack_id == pack_id, refs.has_content(refs.SPRITE))
    if not rescan:
        query = query.where(PackSprite.face_scan.is_(None))
    for row in db.scalars(query).all():
        data = refs.read_bytes(refs.SPRITE, row)
        if data is None:
            continue
        result = scan(data)
        if result is None:
            raise HTTPException(503, "服务器上没装 OpenCV,找不了脸;立绘先按撑满高度、居中摆")
        db.execute(
            update(PackSprite)
            .where(PackSprite.id == row.id)
            .values(face_scan=result, updated_at=PackSprite.updated_at)
        )
    db.commit()
    db.expire_all()
    return list_sprites(pack_id, db)


@router.put(SPRITES + "/{sprite_id}", response_model=SpriteOut)
def update_sprite(pack_id: str, sprite_id: str, req: SpriteUpdate, db: Session = Depends(get_db)):
    sprite = _load_sprite(pack_id, sprite_id, db)
    updates = req.model_dump(exclude_unset=True)
    if "effect" in updates:
        # 三样都没选 = 没设。和 scan-faces 一样不动 updated_at:图没变,图片地址里的版本号不能变
        effect = updates["effect"] if updates["effect"] and any(updates["effect"].values()) else None
        db.execute(
            update(PackSprite)
            .where(PackSprite.id == sprite_id)
            .values(effect=effect, updated_at=PackSprite.updated_at)
        )
        db.refresh(sprite)
    label =clean_label(updates["label"]) if updates.get("label") is not None else sprite.label
    raw_aliases = updates.get("aliases")
    aliases = clean_aliases(raw_aliases if raw_aliases is not None else sprite.aliases or [], label)
    _check_unique(pack_id, [label, *aliases], db, exclude_id=sprite_id)
    sprite.label = label
    sprite.aliases = aliases
    if updates.get("description") is not None:
        sprite.description = updates["description"].strip()
    if updates.get("enabled") is not None:
        sprite.enabled = updates["enabled"]
    db.commit()
    db.refresh(sprite)
    return _out(sprite)


@router.delete(SPRITES + "/{sprite_id}", status_code=204)
def delete_sprite(pack_id: str, sprite_id: str, db: Session = Depends(get_db)):
    db.delete(_load_sprite(pack_id, sprite_id, db))
    db.commit()


@router.post(SPRITES + "/reorder", response_model=list[SpriteOut])
def reorder_sprites(pack_id: str, req: SpriteReorderRequest, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    rows = {r.id: r for r in _pack_sprites(pack_id, db)}
    if sorted(req.ids) != sorted(rows):
        raise HTTPException(400, "排序列表必须正好包含这个包的全部立绘")
    for i, sid in enumerate(req.ids):
        rows[sid].sort = i
    db.commit()
    return [_out(rows[sid]) for sid in req.ids]


@router.put(SPRITES + "/{sprite_id}/image", response_model=SpriteOut)
async def upload_sprite_image(
    pack_id: str, sprite_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    sprite = _load_sprite(pack_id, sprite_id, db)
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"图片太大了,上限 {MAX_IMAGE_BYTES // 1024 // 1024} MB")
    mime = sniff_image_mime(data)
    if mime is None:
        raise HTTPException(400, "只支持 PNG / JPEG / WebP / GIF 图片")
    refs.save(refs.SPRITE, sprite, data, mime, db)
    sprite.mime = mime
    # 没装 OpenCV 时是 None,之后由 scan-faces 补。
    # 解码 + 找脸要几百毫秒,放线程池里跑:这是 async 接口,直接跑会把同时在流式生成的回复卡住
    sprite.face_scan = await run_in_threadpool(scan, data)
    db.commit()
    db.refresh(sprite)
    return _out(sprite)


@router.get(SPRITES + "/{sprite_id}/image")
def get_sprite_image(
    pack_id: str,
    sprite_id: str,
    w: int | None = Query(None, ge=MIN_WIDTH, le=MAX_WIDTH),
    db: Session = Depends(get_db),
):
    """立绘原图;带 ?w= 时缩到这个宽度的 WebP(取色用,见 app/images.py)"""
    sprite = db.scalar(select(PackSprite).where(PackSprite.id == sprite_id, PackSprite.pack_id == pack_id))
    data = refs.read_bytes(refs.SPRITE, sprite) if sprite is not None and sprite.mime is not None else None
    if data is None:
        raise HTTPException(404, "这条立绘还没有图")
    small = shrink_image(data, w) if w else None
    return Response(
        content=small or data,
        media_type="image/webp" if small else sprite.mime,
        headers={
            # 前端请求的 URL 里带着 ?v=image_version,换图后 URL 就变了,
            # 所以同一个 URL 对应的内容永远不会变,可以放心长期缓存
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ── 角色卡挂哪些包 ──


def _bindings_out(card_id: str, db: Session) -> CardSpritePacksOut:
    return CardSpritePacksOut(
        card_id=card_id,
        pack_ids=bindings.targets(db, card_id, bindings.SPRITE),
        current=bindings.primary(db, card_id, bindings.SPRITE),
    )


def _next_current(old: list[str], gone: str | None, keep: list[str]) -> str | None:
    """当前包被拿掉(或删了)之后换成哪个:原来排在它后面、还挂着的下一个,到头了绕回前面;
    一个都不剩就是 None。"""
    if gone in old:
        i = old.index(gone)
        for pid in old[i + 1 :] + old[:i]:
            if pid in keep:
                return pid
    return keep[0] if keep else None


def current_pack_id(card_id: str, db: Session) -> str | None:
    """这张卡游戏里正在用的包;一个包都没挂时是 None。"""
    return bindings.primary(db, card_id, bindings.SPRITE)


def current_sprites(card_id: str, db: Session) -> list[PackSprite]:
    """这张卡当前包里的立绘(含禁用的),排第一的是默认表情。语音的「按立绘表情补齐」也用它。"""
    pack_id = current_pack_id(card_id, db)
    return _pack_sprites(pack_id, db) if pack_id else []


@router.get(CARD + "/sprite-packs", response_model=CardSpritePacksOut)
def get_card_sprite_packs(card_id: str, db: Session = Depends(get_db)):
    _load_card(card_id, db)
    return _bindings_out(card_id, db)


@router.put(CARD + "/sprite-packs", response_model=CardSpritePacksOut)
def set_card_sprite_packs(card_id: str, req: CardSpritePacksIn, db: Session = Depends(get_db)):
    """整组替换(和 CardVoice 一样)。第一次挂上的包自动成为当前包。"""
    _load_card(card_id, db)
    ids = list(dict.fromkeys(req.pack_ids))
    for pid in ids:
        _load_pack(pid, db)
    if req.current is not None and req.current not in ids:
        raise HTTPException(400, "当前包必须是这张卡挂着的包")
    old = bindings.targets(db, card_id, bindings.SPRITE)
    was = bindings.primary(db, card_id, bindings.SPRITE)
    current = req.current or (was if was in ids else _next_current(old, was, ids))
    bindings.replace(db, card_id, bindings.SPRITE, ids, current)
    db.commit()
    return _bindings_out(card_id, db)


@router.put(CARD + "/sprite-packs/current", response_model=CardSpritePacksOut)
def set_card_current_pack(
    card_id: str, req: CardSpritePackCurrentIn, db: Session = Depends(get_db)
):
    """游戏里换一套立绘:只换当前包,挂着哪些包不变。"""
    _load_card(card_id, db)
    ids = bindings.targets(db, card_id, bindings.SPRITE)
    if req.pack_id not in ids:
        raise HTTPException(400, "这张卡没挂这个立绘包")
    bindings.replace(db, card_id, bindings.SPRITE, ids, req.pack_id)
    db.commit()
    return _bindings_out(card_id, db)


@router.get(CARD + "/sprites", response_model=list[SpriteOut])
def list_card_sprites(card_id: str, db: Session = Depends(get_db)):
    """这张卡当前包的立绘;没挂包时是空列表。"""
    _load_card(card_id, db)
    return [_out(r) for r in current_sprites(card_id, db)]


@router.get(CARD + "/sprites/face")
def get_card_face(
    card_id: str,
    request: Request,
    size: int = Query(96, ge=32, le=256),
    db: Session = Depends(get_db),
):
    """封面上的角色头像圈:这张卡当前包的默认立绘(排第一的、启用的、有图的)按脸裁一张小图。

    整张立绘动辄几百 KB,封面上一排十几个圆只要几 KB 的脸。ETag 跟着立绘、版本、脸框走
    (换了包立绘 id 就变了),浏览器每次问一下,没变就 304。没有带图的立绘时 404,
    前端退回卡面头像。
    """
    _load_card(card_id, db)
    rows = [r for r in current_sprites(card_id, db) if r.enabled and r.mime is not None]
    if not rows:
        raise HTTPException(404, "这张卡还没有带图的立绘")
    sprite = rows[0]
    face = _face_of(sprite, rows)
    box = "-".join(f"{face[k]:.4f}" for k in "xywh") if face else "none"
    etag = f'"{sprite.id}.{_version(sprite)}.{size}.{box}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)

    data = refs.read_bytes(refs.SPRITE, sprite)
    if data is None:
        raise HTTPException(404, "这张卡还没有带图的立绘")
    thumb = face_thumbnail(data, face, size)
    if thumb is None:
        raise HTTPException(503, "服务器上没装 OpenCV,裁不了头像")
    return Response(content=thumb, media_type="image/webp", headers=headers)


def _face_of(sprite: PackSprite, rows: list[PackSprite]) -> dict | None:
    """这张立绘的脸框;它自己没认出脸时,借同样画布大小的其他表情的(差分的脸位置一样)"""

    def canvas(row: PackSprite) -> tuple | None:
        found = row.face_scan or {}
        size = found.get("width"), found.get("height")
        return None if None in size else size

    own = (sprite.face_scan or {}).get("face")
    if own or canvas(sprite) is None:
        return own
    for row in rows:
        if canvas(row) == canvas(sprite) and (row.face_scan or {}).get("face"):
            return row.face_scan["face"]
    return None

