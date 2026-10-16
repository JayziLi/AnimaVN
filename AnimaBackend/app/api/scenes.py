"""背景 / BGM / CG 插件:场景包,以及角色卡绑定哪个场景包。

一个场景包 = 一组背景图 + 一组背景音乐 + 一组 CG,AI 在正文里用标签点名(<bg:食堂>、
<bgm:日常>、<cg:海边烟花>),视觉小说界面按名字找到这一行的文件。
CG 下面可以挂差分(parent_id 指向它,名字是立绘的表情名),视觉小说按当前表情换。和立绘的区别是素材不属于
某张卡:同一个世界观的角色共用一个包,卡只记「我用哪个包」。

文件同样存 BLOB、列表只回元数据、取文件的端点带版本号长缓存。
"""

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app import bindings, cg_sync
from app.assets.common import MAX_IMAGE_BYTES, clean_aliases, clean_label, sniff_image_mime, unique_pack_name
from app.db import get_db
from app.images import MAX_WIDTH, MIN_WIDTH, shrink_image
from app.models import CgPack, SceneAsset, ScenePack, TavernCard
from app.schemas import (
    CardScenePackIn,
    CardScenePackOut,
    CardScenePartsIn,
    CardScenePartsOut,
    PackDuplicateIn,
    SceneAssetCreate,
    SceneAssetOut,
    SceneAssetReorder,
    SceneAssetUpdate,
    ScenePackIn,
    ScenePackOut,
    ScenePackUpdate,
)
from app.storage import refs

router = APIRouter(tags=["scenes"])

PACKS = "/api/scene-packs"

# 一首 3~5 分钟的 MP3 在 128~320kbps 下是 3~12MB;服务器 nginx 的上限是 20m,
# multipart 还要占一点,这里留足余量
MAX_AUDIO_BYTES = 16 * 1024 * 1024

NOUN = {"bg": "场景名", "bgm": "音乐名", "cg": "CG 名"}
# CG 差分的名字是立绘的表情名
VARIANT_NOUN = "表情名"


def _load_pack(pack_id: str, db: Session) -> ScenePack:
    pack = db.get(ScenePack, pack_id)
    if pack is None:
        raise HTTPException(404, "场景包不存在")
    return pack


def _load_asset(pack_id: str, asset_id: str, db: Session) -> SceneAsset:
    asset = db.get(SceneAsset, asset_id)
    if asset is None or asset.pack_id != pack_id:
        raise HTTPException(404, "素材不存在")
    return asset


def _clean_pack_name(raw: str, db: Session, exclude_id: str | None = None) -> str:
    name = raw.strip()
    if not name:
        raise HTTPException(400, "场景包名字不能为空")
    if len(name) > 120:
        raise HTTPException(400, "场景包名字最长 120 个字")
    for row in db.scalars(select(ScenePack)):
        if row.id != exclude_id and row.name.casefold() == name.casefold():
            raise HTTPException(409, f"已经有叫「{name}」的场景包了")
    return name


def _pack_out(pack: ScenePack, db: Session) -> ScenePackOut:
    # 差分不算:CG 只数构图
    counts = dict(
        db.execute(
            select(SceneAsset.kind, func.count())
            .where(SceneAsset.pack_id == pack.id, SceneAsset.parent_id.is_(None))
            .group_by(SceneAsset.kind)
        ).all()
    )
    return ScenePackOut(
        id=pack.id,
        name=pack.name,
        description=pack.description,
        bg_count=counts.get("bg", 0),
        bgm_count=counts.get("bgm", 0),
        cg_count=counts.get("cg", 0),
        card_count=bindings.count_cards(db, bindings.SCENE, pack.id),
        title_bgm_id=pack.title_bgm_id,
        cg_pack_id=db.scalar(select(CgPack.id).where(CgPack.source_scene_pack_id == pack.id).limit(1)),
    )


def _check_own_bgm(pack_id: str, bgm_id: str, db: Session, what: str) -> None:
    """封面曲只能是本包的曲子"""
    target = db.get(SceneAsset, bgm_id)
    if target is None or target.pack_id != pack_id or target.kind != "bgm":
        raise HTTPException(400, f"{what}必须是同一个场景包里的一首 BGM")


def _check_bgm(bgm_id: str, db: Session, what: str) -> None:
    """背景的默认曲:任何一个场景包里的曲子都行(背景、BGM 分开绑以后,曲子常在另一个包里)"""
    target = db.get(SceneAsset, bgm_id)
    if target is None or target.kind != "bgm":
        raise HTTPException(400, f"{what}必须是一首 BGM")


def _asset_out(a: SceneAsset) -> SceneAssetOut:
    return SceneAssetOut(
        id=a.id,
        pack_id=a.pack_id,
        kind=a.kind,  # type: ignore[arg-type]
        label=a.label,
        aliases=list(a.aliases or []),
        description=a.description,
        has_file=a.mime is not None,
        mime=a.mime,
        size=a.size,
        file_version=int(a.updated_at.timestamp() * 1000),
        data_sha=a.data_sha if a.mime is not None else None,
        focus_x=a.focus_x,
        bgm_id=a.bgm_id,
        sort=a.sort,
        enabled=a.enabled,
        parent_id=a.parent_id,
        forms=list(a.forms or []),
    )


def _check_unique(
    pack_id: str,
    kind: str,
    names: list[str],
    db: Session,
    exclude_id: str | None = None,
    parent_id: str | None = None,
):
    """同一个包里同一类素材的名字 / 别名不能撞。背景、音乐、CG 各用各的标签,可以同名。
    CG 差分只和同一张 CG 的差分比(每张 CG 都可以有一张「开心」)"""
    taken: dict[str, str] = {}
    rows = db.scalars(
        select(SceneAsset).where(
            SceneAsset.pack_id == pack_id,
            SceneAsset.kind == kind,
            SceneAsset.parent_id == parent_id if parent_id else SceneAsset.parent_id.is_(None),
        )
    )
    for row in rows:
        if row.id == exclude_id:
            continue
        for n in [row.label, *(row.aliases or [])]:
            taken[n.casefold()] = row.label
    noun = VARIANT_NOUN if parent_id else NOUN[kind]
    for n in names:
        owner = taken.get(n.casefold())
        if owner is not None:
            raise HTTPException(409, f"{noun}「{n}」已经被「{owner}」占用了")


def _check_parent(pack_id: str, parent_id: str, db: Session) -> SceneAsset:
    """差分只能挂在同一个包里的一张 CG(构图)下面"""
    parent = db.get(SceneAsset, parent_id)
    if parent is None or parent.pack_id != pack_id or parent.kind != "cg" or parent.parent_id:
        raise HTTPException(400, "差分必须挂在同一个场景包里的一张 CG 下面")
    return parent


def sniff_audio_mime(data: bytes) -> str | None:
    """按文件头认音频格式(理由同 sniff_image_mime:不信任客户端声明的类型)。"""
    if data[:3] == b"ID3":
        return "audio/mpeg"
    if len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        # 帧同步头:layer 位为 00 的是 AAC(ADTS),其余是 MP3
        return "audio/aac" if (data[1] & 0x06) == 0 else "audio/mpeg"
    if data[4:8] == b"ftyp":
        return "audio/mp4"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data[:4] == b"fLaC":
        return "audio/flac"
    return None


# ── 场景包 ──


@router.get(PACKS, response_model=list[ScenePackOut])
def list_packs(db: Session = Depends(get_db)):
    packs = db.scalars(select(ScenePack).order_by(ScenePack.created_at)).all()
    return [_pack_out(p, db) for p in packs]


@router.post(PACKS, response_model=ScenePackOut)
def create_pack(req: ScenePackIn, db: Session = Depends(get_db)):
    pack = ScenePack(name=_clean_pack_name(req.name, db), description=req.description.strip())
    db.add(pack)
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, db)


@router.put(PACKS + "/{pack_id}", response_model=ScenePackOut)
def update_pack(pack_id: str, req: ScenePackUpdate, db: Session = Depends(get_db)):
    pack = _load_pack(pack_id, db)
    if req.name is not None:
        pack.name = _clean_pack_name(req.name, db, exclude_id=pack_id)
    if req.description is not None:
        pack.description = req.description.strip()
    if "title_bgm_id" in req.model_fields_set:
        if req.title_bgm_id is not None:
            _check_own_bgm(pack_id, req.title_bgm_id, db, "封面音乐")
        pack.title_bgm_id = req.title_bgm_id
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, db)


def delete_scene_pack(db: Session, pack_id: str) -> bool:
    """删一个场景包:连同包里的素材、所有卡上的绑定;别的包里拿它的曲子当默认曲的背景改回「不换」;
    从它拆出来的 CG 包留着、不再同步。不提交;包已经不在了返回 False。
    删包接口、撤销导入(app/importer/jobs.py)、素材管理页共用"""
    pack = db.get(ScenePack, pack_id)
    if pack is None:
        return False
    # 别的包里拿这个包的曲子当默认曲的背景改回「不换」
    music = select(SceneAsset.id).where(SceneAsset.pack_id == pack_id, SceneAsset.kind == "bgm")
    db.execute(
        update(SceneAsset)
        .where(SceneAsset.pack_id != pack_id, SceneAsset.bgm_id.in_(music))
        .values(bgm_id=None)
        .execution_options(synchronize_session=False)
    )
    # SQLite 没开外键约束,不会自动级联:素材和绑定手动删
    db.execute(delete(SceneAsset).where(SceneAsset.pack_id == pack_id))
    bindings.remove_target(db, bindings.SCENE, pack_id)
    # 拆出来的 CG 包留着(它是单独绑到卡上的),只是不再和这个场景包同步
    db.execute(update(CgPack).where(CgPack.source_scene_pack_id == pack_id).values(source_scene_pack_id=None))
    db.delete(pack)
    db.flush()
    return True


@router.delete(PACKS + "/{pack_id}", status_code=204)
def delete_pack(pack_id: str, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    delete_scene_pack(db, pack_id)
    db.commit()


def duplicate_scene_pack(db: Session, pack_id: str, name: str | None = None) -> ScenePack:
    """复制一个场景包(素材管理页「创建副本」):背景、曲子照抄(名字、别名、说明、顺序、启用、竖屏焦点),文件按指纹共用;
    背景的默认曲、包的封面曲指着包里的曲子的,换成副本里的同一首(指着别的包的照旧)。
    CG:已经拆成 CG 包的不带(游戏里出的是那个 CG 包;带上就成了没拆过的包,绑上会多出一份 CG);没拆过的连同差分照抄。
    不绑到任何卡。name 同 duplicate_sprite_pack。不提交"""
    src = _load_pack(pack_id, db)
    name = _clean_pack_name(name, db) if name and name.strip() else unique_pack_name(db, ScenePack, f"{src.name} 副本")
    pack = ScenePack(id=uuid.uuid4().hex, name=name, description=src.description)
    db.add(pack)
    rows = db.scalars(
        select(SceneAsset).where(SceneAsset.pack_id == pack_id).order_by(SceneAsset.kind, SceneAsset.sort, SceneAsset.created_at)
    ).all()
    if cg_sync.cg_pack_of_scene(db, pack_id) is not None:
        rows = [r for r in rows if r.kind != "cg"]
    ids = {r.id: uuid.uuid4().hex for r in rows}
    for r in rows:
        row = SceneAsset(
            id=ids[r.id],
            pack_id=pack.id,
            kind=r.kind,
            label=r.label,
            aliases=list(r.aliases or []),
            description=r.description,
            mime=r.mime,
            size=r.size,
            sort=r.sort,
            focus_x=r.focus_x,
            bgm_id=ids.get(r.bgm_id, r.bgm_id),
            parent_id=ids.get(r.parent_id, r.parent_id),
            forms=list(r.forms or []),
            enabled=r.enabled,
        )
        refs.copy_content(refs.SCENE_ASSET, r, row, db)
        db.add(row)
    # 封面曲只能是本包的曲子:指着别处的(本来就不该有)回到默认
    pack.title_bgm_id = ids.get(src.title_bgm_id) if src.title_bgm_id else None
    db.flush()
    return pack


@router.post(PACKS + "/{pack_id}/duplicate", response_model=ScenePackOut)
def duplicate_pack(pack_id: str, req: PackDuplicateIn | None = None, db: Session = Depends(get_db)):
    pack = duplicate_scene_pack(db, pack_id, req.name if req else None)
    db.commit()
    return _pack_out(pack, db)


# ── 素材 ──


@router.get(PACKS + "/{pack_id}/assets", response_model=list[SceneAssetOut])
def list_assets(pack_id: str, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    rows = db.scalars(
        select(SceneAsset)
        .where(SceneAsset.pack_id == pack_id)
        .order_by(SceneAsset.kind, SceneAsset.sort, SceneAsset.created_at)
    ).all()
    return [_asset_out(r) for r in rows]


@router.post(PACKS + "/{pack_id}/assets", response_model=SceneAssetOut)
def create_asset(pack_id: str, req: SceneAssetCreate, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    if req.parent_id is not None:
        if req.kind != "cg":
            raise HTTPException(400, "只有 CG 能挂差分")
        _check_parent(pack_id, req.parent_id, db)
    noun = VARIANT_NOUN if req.parent_id else NOUN[req.kind]
    label = clean_label(req.label, noun)
    aliases = clean_aliases(req.aliases, label, noun)
    _check_unique(pack_id, req.kind, [label, *aliases], db, parent_id=req.parent_id)
    last = db.scalar(
        select(func.max(SceneAsset.sort)).where(
            SceneAsset.pack_id == pack_id,
            SceneAsset.kind == req.kind,
            SceneAsset.parent_id == req.parent_id
            if req.parent_id
            else SceneAsset.parent_id.is_(None),
        )
    )
    asset = SceneAsset(
        pack_id=pack_id,
        kind=req.kind,
        label=label,
        aliases=aliases,
        description=req.description.strip(),
        sort=(last + 1) if last is not None else 0,
        parent_id=req.parent_id,
    )
    db.add(asset)
    db.flush()
    cg_sync.from_scene(db, [asset])
    db.commit()
    db.refresh(asset)
    return _asset_out(asset)


@router.put(PACKS + "/{pack_id}/assets/{asset_id}", response_model=SceneAssetOut)
def update_asset(
    pack_id: str, asset_id: str, req: SceneAssetUpdate, db: Session = Depends(get_db)
):
    asset = _load_asset(pack_id, asset_id, db)
    noun = VARIANT_NOUN if asset.parent_id else NOUN[asset.kind]
    updates = req.model_dump(exclude_unset=True)

    label = clean_label(updates["label"], noun) if updates.get("label") is not None else asset.label
    raw_aliases = updates.get("aliases")
    aliases = clean_aliases(
        raw_aliases if raw_aliases is not None else asset.aliases or [], label, noun
    )
    _check_unique(
        pack_id, asset.kind, [label, *aliases], db, exclude_id=asset_id, parent_id=asset.parent_id
    )
    asset.label = label
    asset.aliases = aliases

    if updates.get("description") is not None:
        asset.description = updates["description"].strip()
    if updates.get("focus_x") is not None:
        asset.focus_x = updates["focus_x"]
    if "bgm_id" in updates:
        bgm_id = updates["bgm_id"]
        if bgm_id is not None:
            # CG 和音乐互不牵连(10-03 用户定),只有背景有默认曲
            if asset.kind != "bg":
                raise HTTPException(400, "只有背景能设默认音乐")
            _check_bgm(bgm_id, db, "默认音乐")
        asset.bgm_id = bgm_id
    if updates.get("enabled") is not None:
        asset.enabled = updates["enabled"]
    if updates.get("forms") is not None:
        if asset.kind != "cg" or asset.parent_id:
            raise HTTPException(400, "只有 CG 能设在哪些状态出现(差分跟着 CG)")
        # 去空、去重,顺序照传来的
        forms = [f.strip() for f in updates["forms"] if f.strip()]
        asset.forms = list(dict.fromkeys(forms))

    db.flush()
    cg_sync.from_scene(db, [asset])
    db.commit()
    db.refresh(asset)
    return _asset_out(asset)


@router.delete(PACKS + "/{pack_id}/assets/{asset_id}", status_code=204)
def delete_asset(pack_id: str, asset_id: str, db: Session = Depends(get_db)):
    asset = _load_asset(pack_id, asset_id, db)
    if asset.kind == "cg":
        # CG 的差分跟着删;拆出来的 CG 包里同一批也删
        variants = list(db.scalars(select(SceneAsset.id).where(SceneAsset.parent_id == asset_id)).all())
        db.execute(delete(SceneAsset).where(SceneAsset.parent_id == asset_id))
        cg_sync.deleted_from_scene(db, [asset_id, *variants])
    if asset.kind == "bgm":
        # 把这首当默认曲的背景 / CG(别的包里的也算)、当封面音乐的包改回默认,不然前端会拿着一个不存在的 id
        db.execute(update(SceneAsset).where(SceneAsset.bgm_id == asset_id).values(bgm_id=None))
        db.execute(
            update(ScenePack)
            .where(ScenePack.id == pack_id, ScenePack.title_bgm_id == asset_id)
            .values(title_bgm_id=None)
        )
    db.delete(asset)
    db.commit()


@router.post(PACKS + "/{pack_id}/assets/reorder", response_model=list[SceneAssetOut])
def reorder_assets(pack_id: str, req: SceneAssetReorder, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    rows = {
        r.id: r
        for r in db.scalars(
            select(SceneAsset).where(
                SceneAsset.pack_id == pack_id,
                SceneAsset.kind == req.kind,
                SceneAsset.parent_id.is_(None),
            )
        )
    }
    if sorted(req.ids) != sorted(rows):
        raise HTTPException(400, "排序列表必须正好包含这一类的全部素材")
    for i, aid in enumerate(req.ids):
        rows[aid].sort = i
    db.flush()
    cg_sync.from_scene(db, rows.values())
    db.commit()
    return [_asset_out(rows[aid]) for aid in req.ids]


@router.put(PACKS + "/{pack_id}/assets/{asset_id}/file", response_model=SceneAssetOut)
async def upload_asset_file(
    pack_id: str, asset_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    asset = _load_asset(pack_id, asset_id, db)
    if asset.kind in ("bg", "cg"):
        limit, sniff, accepted = MAX_IMAGE_BYTES, sniff_image_mime, "PNG / JPEG / WebP / GIF 图片"
    else:
        limit, sniff, accepted = MAX_AUDIO_BYTES, sniff_audio_mime, "MP3 / M4A / AAC / OGG / WAV / FLAC 音频"
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"文件太大了,上限 {limit // 1024 // 1024} MB")
    mime = sniff(data)
    if mime is None:
        raise HTTPException(400, f"只支持 {accepted}")
    refs.save(refs.SCENE_ASSET, asset, data, mime, db)
    asset.mime = mime
    asset.size = len(data)
    db.flush()
    cg_sync.from_scene(db, [asset])
    db.commit()
    db.refresh(asset)
    return _asset_out(asset)


@router.get(PACKS + "/{pack_id}/assets/{asset_id}/file")
def get_asset_file(
    pack_id: str,
    asset_id: str,
    w: int | None = Query(None, ge=MIN_WIDTH, le=MAX_WIDTH),
    db: Session = Depends(get_db),
):
    """素材文件;背景、CG 带 ?w= 时缩到这个宽度的 WebP(标题画面取色、插件页缩略图,见 app/images.py)"""
    asset = db.scalar(select(SceneAsset).where(SceneAsset.id == asset_id, SceneAsset.pack_id == pack_id))
    data = refs.read_bytes(refs.SCENE_ASSET, asset) if asset is not None and asset.mime is not None else None
    if data is None:
        raise HTTPException(404, "这条素材还没有文件")
    small = shrink_image(data, w) if w and asset.kind in ("bg", "cg") else None
    return Response(
        content=small or data,
        media_type="image/webp" if small else asset.mime,
        headers={
            # URL 里带 ?v=file_version,换文件后 URL 就变了,同一个 URL 的内容永远不变
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ── 角色卡绑定 ──


@router.get("/api/tavern/cards/{card_id}/scene-pack", response_model=CardScenePackOut)
def get_card_scene_pack(card_id: str, db: Session = Depends(get_db)):
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")
    packs = bindings.targets(db, card_id, bindings.SCENE)
    return CardScenePackOut(card_id=card_id, pack_id=packs[0] if packs else None)


@router.put("/api/tavern/cards/{card_id}/scene-pack", response_model=CardScenePackOut)
def set_card_scene_pack(card_id: str, req: CardScenePackIn, db: Session = Depends(get_db)):
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")
    if req.pack_id is not None:
        _load_pack(req.pack_id, db)
    # 旧接口只管一个场景包:换掉排第一的那个(换上的背景和 BGM 都出),后面叠着的不动
    bindings.replace_first_scene(db, card_id, req.pack_id)
    db.commit()
    return CardScenePackOut(card_id=card_id, pack_id=req.pack_id)


def _scene_parts_out(card_id: str, db: Session) -> CardScenePartsOut:
    parts = bindings.scene_parts(db, card_id)
    return CardScenePartsOut(card_id=card_id, bg=parts["bg"], bgm=parts["bgm"])


@router.get("/api/tavern/cards/{card_id}/scene-packs", response_model=CardScenePartsOut)
def get_card_scene_parts(card_id: str, db: Session = Depends(get_db)):
    """这张卡的场景包分两栏:出背景的、出曲子的,各按顺序(一个包可能两边都在)"""
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")
    return _scene_parts_out(card_id, db)


@router.put("/api/tavern/cards/{card_id}/scene-packs", response_model=CardScenePartsOut)
def set_card_scene_parts(card_id: str, req: CardScenePartsIn, db: Session = Depends(get_db)):
    """整组替换。两栏共用一个先后(背景的在前,只出曲子的接在后面,见 bindings.replace_scene),返回读回来的样子"""
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")
    for pid in dict.fromkeys([*req.bg, *req.bgm]):
        _load_pack(pid, db)
    bindings.replace_scene(db, card_id, req.bg, req.bgm)
    db.commit()
    return _scene_parts_out(card_id, db)

