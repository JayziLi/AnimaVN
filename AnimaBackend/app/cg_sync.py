"""CG 包和它拆出来的那个场景包两边都写(素材架构设计 3.4 的转接层,清理期以前)。

迁移时拆出来的 CG 包(CgPack.source_scene_pack_id 不是空的)和原来场景包里的 CG 行编号一样,内容保持一致:
- 旧的场景素材接口(还有仓库外按场景包名往里写 CG 的脚本)改了场景包里的 CG,同一行同步进 CG 包;
- 新的 CG 包接口改了 CG 包,同一行同步回场景包。换回旧代码时场景包里的 CG 还是最新的。
新建的 CG 包(没有来源场景包)不同步。原件:CG 包那一行只记指纹(文件在仓库里);场景包那一行照 refs.save 的规矩写
(开关 storage_files 开着时也只记指纹;关着时存一份原件,旧代码读它)。
往一个还没拆过的场景包里加 CG 时,先照迁移的做法把它拆了(core.2026_10_cg_packs):建 CG 包、搬已有的 CG、
绑给绑着这个场景包的卡。
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import bindings
from app.models import CgAsset, CgPack, SceneAsset, ScenePack
from app.storage import refs

# 两边都有、要一样的字段(文件另算)
FIELDS = ("parent_id", "label", "aliases", "description", "sort", "focus_x", "forms", "enabled", "mime", "size", "data_sha")


def cg_pack_of_scene(db: Session, scene_pack_id: str) -> CgPack | None:
    """这个场景包拆出来的 CG 包;没拆过是 None"""
    return db.scalar(select(CgPack).where(CgPack.source_scene_pack_id == scene_pack_id).limit(1))


def split(db: Session, scene_pack_id: str) -> CgPack:
    """把场景包里的 CG 拆成一个 CG 包,绑给绑着这个场景包的卡(和迁移一样);拆过就直接返回那个包"""
    pack = cg_pack_of_scene(db, scene_pack_id)
    if pack is not None:
        return pack
    scene = db.get(ScenePack, scene_pack_id)
    base = f"{(scene.name if scene else '').strip() or '未命名'} · CG"
    taken = {n.casefold() for n in db.scalars(select(CgPack.name)).all()}
    name, n = base, 2
    while name.casefold() in taken:
        name, n = f"{base} ({n})", n + 1
    pack = CgPack(name=name, source_scene_pack_id=scene_pack_id)
    db.add(pack)
    db.flush()
    existing = db.scalars(select(SceneAsset).where(SceneAsset.pack_id == scene_pack_id, SceneAsset.kind == "cg")).all()
    for a in existing:
        row = CgAsset(id=a.id, pack_id=pack.id, label=a.label)
        _copy(a, row)
        if a.data_sha is None and a.mime is not None:
            row.data = a.data
        db.add(row)
    for card in bindings.cards_using(db, bindings.SCENE, scene_pack_id):
        bindings.replace(db, card, bindings.CG, [*bindings.targets(db, card, bindings.CG), pack.id])
    db.flush()
    return pack


def _copy(src, dst) -> None:
    for f in FIELDS:
        value = getattr(src, f)
        setattr(dst, f, list(value) if isinstance(value, list) else value)


def from_scene(db: Session, assets: Iterable[SceneAsset]) -> None:
    """场景包里的 CG 改了:同步进拆出来的 CG 包(没拆过的先拆)。不提交"""
    for a in assets:
        if a.kind != "cg":
            continue
        pack = split(db, a.pack_id)
        row = db.get(CgAsset, a.id)
        if row is None:
            row = CgAsset(id=a.id, pack_id=pack.id, label=a.label)
            db.add(row)
        _copy(a, row)
        # 有指纹时原件按指纹找(文件仓库,或者场景包那一行);还没指纹才不得不另存一份
        if a.data_sha is None and a.mime is not None:
            row.data = a.data
    db.flush()


def deleted_from_scene(db: Session, ids: Iterable[str]) -> None:
    ids = list(ids)
    if ids:
        db.execute(delete(CgAsset).where(CgAsset.id.in_(ids)))
        db.flush()


def to_scene(db: Session, assets: Iterable[CgAsset], data: bytes | None = None) -> None:
    """CG 包改了:同步回它的来源场景包(新建的 CG 包没有来源,不管)。data:这次上传的原件,照 refs.save 写进场景包那一行"""
    for a in assets:
        pack = db.get(CgPack, a.pack_id)
        if pack is None or pack.source_scene_pack_id is None:
            continue
        row = db.get(SceneAsset, a.id)
        if row is None:
            row = SceneAsset(id=a.id, pack_id=pack.source_scene_pack_id, kind="cg", label=a.label)
            db.add(row)
        _copy(a, row)
        if data is not None:
            refs.save(refs.SCENE_ASSET, row, data, a.mime, db)
    db.flush()


def deleted_to_scene(db: Session, ids: Iterable[str]) -> None:
    ids = list(ids)
    if ids:
        db.execute(delete(SceneAsset).where(SceneAsset.id.in_(ids), SceneAsset.kind == "cg"))
        db.flush()
