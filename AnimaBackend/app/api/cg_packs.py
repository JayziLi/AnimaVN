"""CG 包(素材架构设计 3.4,第 4 期):包的增删改、包里的构图和差分、卡绑哪些 CG 包。

规则和以前场景包里的 CG 一样:构图的名字 / 别名在一个包里不能撞,差分只和同一张构图的差分比;删构图连差分一起删;
排序只排构图。迁移时从场景包拆出来的 CG 包,改动同步回那个场景包(app/cg_sync.py)。
包里的每一条用和场景素材同一个形状返回(SceneAssetOut,kind = cg,source = cg),前端当场景素材的 CG 用。
"""

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app import bindings, cg_sync
from app.assets.common import MAX_IMAGE_BYTES, clean_aliases, clean_label, sniff_image_mime, unique_pack_name
from app.db import get_db
from app.images import MAX_WIDTH, MIN_WIDTH, shrink_image
from app.models import CgAsset, CgPack, TavernCard
from app.schemas import (
    CardCgPacksIn,
    CardCgPacksOut,
    CgAssetCreate,
    CgAssetReorder,
    CgAssetUpdate,
    CgPackIn,
    CgPackOut,
    CgPackUpdate,
    PackDuplicateIn,
    SceneAssetOut,
)
from app.storage import refs

router = APIRouter(tags=["cg-packs"])

PACKS = "/api/cg-packs"
NOUN, VARIANT_NOUN = "CG 名", "表情名"


def _load_pack(pack_id: str, db: Session) -> CgPack:
    pack = db.get(CgPack, pack_id)
    if pack is None:
        raise HTTPException(404, "CG 包不存在")
    return pack


def _load_asset(pack_id: str, asset_id: str, db: Session) -> CgAsset:
    asset = db.get(CgAsset, asset_id)
    if asset is None or asset.pack_id != pack_id:
        raise HTTPException(404, "这张 CG 不存在")
    return asset


def _clean_pack_name(raw: str, db: Session, exclude_id: str | None = None) -> str:
    name = raw.strip()
    if not name:
        raise HTTPException(400, "CG 包名字不能为空")
    if len(name) > 120:
        raise HTTPException(400, "CG 包名字最长 120 个字")
    for row in db.scalars(select(CgPack)):
        if row.id != exclude_id and row.name.casefold() == name.casefold():
            raise HTTPException(409, f"已经有叫「{name}」的 CG 包了")
    return name


def _pack_out(pack: CgPack, db: Session) -> CgPackOut:
    count = db.scalar(
        select(func.count()).select_from(CgAsset).where(CgAsset.pack_id == pack.id, CgAsset.parent_id.is_(None))
    )
    return CgPackOut(
        id=pack.id,
        name=pack.name,
        description=pack.description,
        cg_count=count or 0,
        card_count=bindings.count_cards(db, bindings.CG, pack.id),
        source_scene_pack_id=pack.source_scene_pack_id,
        generated=bool(pack.generated),
    )


def asset_out(a: CgAsset) -> SceneAssetOut:
    return SceneAssetOut(
        id=a.id,
        pack_id=a.pack_id,
        kind="cg",
        label=a.label,
        aliases=list(a.aliases or []),
        description=a.description,
        has_file=a.mime is not None,
        mime=a.mime,
        size=a.size,
        file_version=int(a.updated_at.timestamp() * 1000),
        data_sha=a.data_sha if a.mime is not None else None,
        focus_x=a.focus_x,
        bgm_id=None,
        sort=a.sort,
        enabled=a.enabled,
        parent_id=a.parent_id,
        forms=list(a.forms or []),
        source="cg",
    )


def _check_unique(pack_id: str, names: list[str], db: Session, exclude_id: str | None = None, parent_id: str | None = None):
    taken: dict[str, str] = {}
    rows = db.scalars(
        select(CgAsset).where(
            CgAsset.pack_id == pack_id,
            CgAsset.parent_id == parent_id if parent_id else CgAsset.parent_id.is_(None),
        )
    )
    for row in rows:
        if row.id == exclude_id:
            continue
        for n in [row.label, *(row.aliases or [])]:
            taken[n.casefold()] = row.label
    noun = VARIANT_NOUN if parent_id else NOUN
    for n in names:
        owner = taken.get(n.casefold())
        if owner is not None:
            raise HTTPException(409, f"{noun}「{n}」已经被「{owner}」占用了")


def pack_assets(pack_id: str, db: Session) -> list[CgAsset]:
    """包里的构图和差分,按 sort, created_at(和以前场景包里的 CG 一样)"""
    return list(
        db.scalars(select(CgAsset).where(CgAsset.pack_id == pack_id).order_by(CgAsset.sort, CgAsset.created_at)).all()
    )


# ── 包 ──


@router.get(PACKS, response_model=list[CgPackOut])
def list_packs(db: Session = Depends(get_db)):
    return [_pack_out(p, db) for p in db.scalars(select(CgPack).order_by(CgPack.created_at)).all()]


@router.post(PACKS, response_model=CgPackOut)
def create_pack(req: CgPackIn, db: Session = Depends(get_db)):
    pack = CgPack(name=_clean_pack_name(req.name, db), description=req.description.strip())
    db.add(pack)
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, db)


@router.put(PACKS + "/{pack_id}", response_model=CgPackOut)
def update_pack(pack_id: str, req: CgPackUpdate, db: Session = Depends(get_db)):
    pack = _load_pack(pack_id, db)
    if req.name is not None:
        pack.name = _clean_pack_name(req.name, db, exclude_id=pack_id)
    if req.description is not None:
        pack.description = req.description.strip()
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, db)


def delete_cg_pack(db: Session, pack_id: str) -> bool:
    """删一个 CG 包:连同包里的 CG 和所有卡上的绑定;从场景包拆出来的,场景包里那些 CG 也跟着删(两边一致)。
    不提交;包已经不在了返回 False。删包接口、撤销导入(app/importer/jobs.py)、素材管理页共用"""
    pack = db.get(CgPack, pack_id)
    if pack is None:
        return False
    ids = [a.id for a in pack_assets(pack_id, db)]
    if pack.source_scene_pack_id is not None:
        cg_sync.deleted_to_scene(db, ids)
    db.execute(delete(CgAsset).where(CgAsset.pack_id == pack_id))
    bindings.remove_target(db, bindings.CG, pack_id)
    db.delete(pack)
    db.flush()
    return True


@router.delete(PACKS + "/{pack_id}", status_code=204)
def delete_pack(pack_id: str, db: Session = Depends(get_db)):
    """连同包里的 CG 和所有卡上的绑定一起删;从场景包拆出来的,场景包里那些 CG 也跟着删(两边一致)"""
    _load_pack(pack_id, db)
    delete_cg_pack(db, pack_id)
    db.commit()


def duplicate_cg_pack(db: Session, pack_id: str, name: str | None = None) -> CgPack:
    """复制一个 CG 包(素材管理页「创建副本」):构图和差分照抄(名字、别名、说明、顺序、启用、焦点、forms),差分挂到副本里的
    同一张构图下面,图按指纹共用。副本是单独的包:不连到来源场景包(改它不往场景包同步),AI 生成的照旧标 AI 生成。
    不绑到任何卡。name 同 duplicate_sprite_pack。不提交"""
    src = _load_pack(pack_id, db)
    name = _clean_pack_name(name, db) if name and name.strip() else unique_pack_name(db, CgPack, f"{src.name} 副本")
    pack = CgPack(id=uuid.uuid4().hex, name=name, description=src.description, generated=bool(src.generated))
    db.add(pack)
    rows = pack_assets(pack_id, db)
    ids = {a.id: uuid.uuid4().hex for a in rows}
    for a in rows:
        row = CgAsset(
            id=ids[a.id],
            pack_id=pack.id,
            parent_id=ids.get(a.parent_id, a.parent_id),
            label=a.label,
            aliases=list(a.aliases or []),
            description=a.description,
            mime=a.mime,
            size=a.size,
            sort=a.sort,
            focus_x=a.focus_x,
            forms=list(a.forms or []),
            enabled=a.enabled,
        )
        refs.copy_content(refs.CG_ASSET, a, row, db)
        db.add(row)
    db.flush()
    return pack


@router.post(PACKS + "/{pack_id}/duplicate", response_model=CgPackOut)
def duplicate_pack(pack_id: str, req: PackDuplicateIn | None = None, db: Session = Depends(get_db)):
    pack = duplicate_cg_pack(db, pack_id, req.name if req else None)
    db.commit()
    return _pack_out(pack, db)


# ── 包里的 CG ──


@router.get(PACKS + "/{pack_id}/assets", response_model=list[SceneAssetOut])
def list_assets(pack_id: str, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    return [asset_out(a) for a in pack_assets(pack_id, db)]


@router.post(PACKS + "/{pack_id}/assets", response_model=SceneAssetOut)
def create_asset(pack_id: str, req: CgAssetCreate, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    if req.parent_id is not None:
        parent = db.get(CgAsset, req.parent_id)
        if parent is None or parent.pack_id != pack_id or parent.parent_id:
            raise HTTPException(400, "差分必须挂在同一个 CG 包里的一张构图下面")
    noun = VARIANT_NOUN if req.parent_id else NOUN
    label = clean_label(req.label, noun)
    aliases = clean_aliases(req.aliases, label, noun)
    _check_unique(pack_id, [label, *aliases], db, parent_id=req.parent_id)
    last = db.scalar(
        select(func.max(CgAsset.sort)).where(
            CgAsset.pack_id == pack_id,
            CgAsset.parent_id == req.parent_id if req.parent_id else CgAsset.parent_id.is_(None),
        )
    )
    asset = CgAsset(
        pack_id=pack_id,
        label=label,
        aliases=aliases,
        description=req.description.strip(),
        sort=(last + 1) if last is not None else 0,
        parent_id=req.parent_id,
    )
    db.add(asset)
    db.flush()
    cg_sync.to_scene(db, [asset])
    db.commit()
    db.refresh(asset)
    return asset_out(asset)


@router.put(PACKS + "/{pack_id}/assets/{asset_id}", response_model=SceneAssetOut)
def update_asset(pack_id: str, asset_id: str, req: CgAssetUpdate, db: Session = Depends(get_db)):
    asset = _load_asset(pack_id, asset_id, db)
    noun = VARIANT_NOUN if asset.parent_id else NOUN
    updates = req.model_dump(exclude_unset=True)
    label = clean_label(updates["label"], noun) if updates.get("label") is not None else asset.label
    raw_aliases = updates.get("aliases")
    aliases = clean_aliases(raw_aliases if raw_aliases is not None else asset.aliases or [], label, noun)
    _check_unique(pack_id, [label, *aliases], db, exclude_id=asset_id, parent_id=asset.parent_id)
    asset.label = label
    asset.aliases = aliases
    if updates.get("description") is not None:
        asset.description = updates["description"].strip()
    if updates.get("focus_x") is not None:
        asset.focus_x = updates["focus_x"]
    if updates.get("enabled") is not None:
        asset.enabled = updates["enabled"]
    if updates.get("forms") is not None:
        if asset.parent_id:
            raise HTTPException(400, "差分跟着构图,不能单独设")
        asset.forms = list(dict.fromkeys(f.strip() for f in updates["forms"] if f.strip()))
    db.flush()
    cg_sync.to_scene(db, [asset])
    db.commit()
    db.refresh(asset)
    return asset_out(asset)


@router.delete(PACKS + "/{pack_id}/assets/{asset_id}", status_code=204)
def delete_asset(pack_id: str, asset_id: str, db: Session = Depends(get_db)):
    asset = _load_asset(pack_id, asset_id, db)
    ids = [asset_id]
    if asset.parent_id is None:
        ids += list(db.scalars(select(CgAsset.id).where(CgAsset.parent_id == asset_id)).all())
    if db.get(CgPack, pack_id).source_scene_pack_id is not None:
        cg_sync.deleted_to_scene(db, ids)
    db.execute(delete(CgAsset).where(CgAsset.id.in_(ids)))
    db.commit()


@router.post(PACKS + "/{pack_id}/assets/reorder", response_model=list[SceneAssetOut])
def reorder_assets(pack_id: str, req: CgAssetReorder, db: Session = Depends(get_db)):
    _load_pack(pack_id, db)
    rows = {r.id: r for r in db.scalars(select(CgAsset).where(CgAsset.pack_id == pack_id, CgAsset.parent_id.is_(None)))}
    if sorted(req.ids) != sorted(rows):
        raise HTTPException(400, "排序列表必须正好包含这个包的全部构图")
    for i, aid in enumerate(req.ids):
        rows[aid].sort = i
    db.flush()
    cg_sync.to_scene(db, rows.values())
    db.commit()
    return [asset_out(rows[aid]) for aid in req.ids]


@router.put(PACKS + "/{pack_id}/assets/{asset_id}/file", response_model=SceneAssetOut)
async def upload_asset_file(pack_id: str, asset_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    asset = _load_asset(pack_id, asset_id, db)
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"文件太大了,上限 {MAX_IMAGE_BYTES // 1024 // 1024} MB")
    mime = sniff_image_mime(data)
    if mime is None:
        raise HTTPException(400, "只支持 PNG / JPEG / WebP / GIF 图片")
    refs.save(refs.CG_ASSET, asset, data, mime, db)
    asset.mime = mime
    asset.size = len(data)
    if db.get(CgPack, pack_id).source_scene_pack_id is not None:
        # 来源场景包那一行存原件(旧代码读它),CG 包这一行只记指纹
        asset.data = None
        db.flush()
        cg_sync.to_scene(db, [asset], data=data)
    db.commit()
    db.refresh(asset)
    return asset_out(asset)


@router.get(PACKS + "/{pack_id}/assets/{asset_id}/file")
def get_asset_file(
    pack_id: str,
    asset_id: str,
    w: int | None = Query(None, ge=MIN_WIDTH, le=MAX_WIDTH),
    db: Session = Depends(get_db),
):
    asset = db.scalar(select(CgAsset).where(CgAsset.id == asset_id, CgAsset.pack_id == pack_id))
    data = refs.read_bytes(refs.CG_ASSET, asset, db) if asset is not None and asset.mime is not None else None
    if data is None:
        raise HTTPException(404, "这张 CG 还没有图")
    small = shrink_image(data, w) if w else None
    return Response(
        content=small or data,
        media_type="image/webp" if small else asset.mime,
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )


# ── 卡绑哪些 CG 包 ──


@router.get("/api/tavern/cards/{card_id}/cg-packs", response_model=CardCgPacksOut)
def get_card_cg_packs(card_id: str, db: Session = Depends(get_db)):
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")
    return CardCgPacksOut(card_id=card_id, pack_ids=bindings.targets(db, card_id, bindings.CG))


@router.put("/api/tavern/cards/{card_id}/cg-packs", response_model=CardCgPacksOut)
def set_card_cg_packs(card_id: str, req: CardCgPacksIn, db: Session = Depends(get_db)):
    """整组替换,按顺序叠:几个包里构图重名时取排前面的"""
    if db.get(TavernCard, card_id) is None:
        raise HTTPException(404, "角色卡不存在")
    ids = list(dict.fromkeys(req.pack_ids))
    for pid in ids:
        _load_pack(pid, db)
    bindings.replace(db, card_id, bindings.CG, ids)
    db.commit()
    return CardCgPacksOut(card_id=card_id, pack_ids=ids)
