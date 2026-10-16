"""卡 → 角色位 → 素材的绑定(素材架构设计 3.2,第 4 期)。全后端只有这里读写绑定。

- 角色位级:立绘包(sprite;is_primary = 当前包)、声音(voice;is_primary = 主声音,其余是备用声音);
  这一期每张卡只有主角色位,绑在它上面。
- 卡级:场景包(scene)、CG 包(cg),按 sort 叠。场景包分背景、BGM 两栏绑(第 1 步):绑定行的 parts 记这个包
  给这张卡出什么('' 两样都出、bg 只出背景、bgm 只出曲子),包本身不拆。CG 不分:没拆过的场景包,不管出哪一样,
  包里的 CG 照旧跟着出。

旧表 card_sprite_packs / card_voices / card_scene_packs 在清理期以前照旧写一份:每次改完一种,按新表把这张卡
这一种的旧表行整个重写(场景包旧表只能存一个,写排第一的那个)。这样换回旧代码,绑定还在。
卡还没迁过(没有主角色位:迁移器关着、或者升级没做完)时,读旧表;第一次写的时候先把它迁过来。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import delete, false, select
from sqlalchemy.orm import Session

from app.models import AssetBinding, CardRole, CardScenePack, CardSpritePack, CardVoice, TavernCard

SPRITE, VOICE, SCENE, CG = "sprite", "voice", "scene", "cg"
ROLE_KINDS = (SPRITE, VOICE)
KINDS = (SPRITE, VOICE, SCENE, CG)
# 场景包绑定行的 parts;空串 = 两样都出
PART_BG, PART_BGM = "bg", "bgm"


# ── 旧表 ──


def _old_rows(db: Session, card_id: str, kind: str) -> list[tuple[str, bool]]:
    """旧表里这张卡这一种的绑定:(目标, 是不是 primary),按今天接口的顺序"""
    if kind == SPRITE:
        rows = db.scalars(
            select(CardSpritePack).where(CardSpritePack.card_id == card_id).order_by(CardSpritePack.sort)
        ).all()
        return [(r.pack_id, r.is_current) for r in rows]
    if kind == VOICE:
        rows = db.scalars(select(CardVoice).where(CardVoice.card_id == card_id)).all()
        return sorted(((r.profile_id, r.is_main) for r in rows), key=lambda it: not it[1])
    if kind == SCENE:
        row = db.get(CardScenePack, card_id)
        return [(row.pack_id, False)] if row else []
    return []


def _mirror(db: Session, card_id: str, kind: str) -> None:
    """按新表重写这张卡这一种的旧表行"""
    rows = _rows(db, card_id, kind)
    if kind == SPRITE:
        db.execute(delete(CardSpritePack).where(CardSpritePack.card_id == card_id))
        db.flush()
        for r in rows:
            db.add(CardSpritePack(card_id=card_id, pack_id=r.target_id, sort=r.sort, is_current=r.is_primary))
    elif kind == VOICE:
        db.execute(delete(CardVoice).where(CardVoice.card_id == card_id))
        db.flush()
        for r in rows:
            db.add(CardVoice(card_id=card_id, profile_id=r.target_id, is_main=r.is_primary))
    elif kind == SCENE:
        db.execute(delete(CardScenePack).where(CardScenePack.card_id == card_id))
        db.flush()
        if rows:
            db.add(CardScenePack(card_id=card_id, pack_id=rows[0].target_id))
    db.flush()


# ── 角色位 ──


def main_role(db: Session, card_id: str) -> CardRole | None:
    return db.scalar(select(CardRole).where(CardRole.card_id == card_id, CardRole.is_main.is_(True)))


def ensure_main_role(db: Session, card_id: str) -> CardRole:
    """这张卡的主角色位;还没迁过就建一个,把旧表里它的绑定一起搬过来(和迁移步骤做的一样)"""
    role = main_role(db, card_id)
    if role is not None:
        return role
    card = db.get(TavernCard, card_id)
    role = CardRole(card_id=card_id, name=card.name if card else "", aliases=[], sort=0, is_main=True)
    db.add(role)
    db.flush()
    for kind in (SPRITE, VOICE, SCENE):
        for i, (target, primary) in enumerate(_old_rows(db, card_id, kind)):
            db.add(
                AssetBinding(
                    card_id=card_id,
                    role_id=role.id if kind in ROLE_KINDS else "",
                    kind=kind,
                    target_id=target,
                    sort=i,
                    is_primary=primary,
                )
            )
    db.flush()
    return role


# ── 读 ──


def _rows(db: Session, card_id: str, kind: str) -> list[AssetBinding]:
    """这一期角色位级的都在主角色位上,所以不用按角色位分"""
    return list(
        db.scalars(
            select(AssetBinding)
            .where(AssetBinding.card_id == card_id, AssetBinding.kind == kind)
            .order_by(AssetBinding.sort, AssetBinding.created_at)
        ).all()
    )


def _migrated(db: Session, card_id: str) -> bool:
    return main_role(db, card_id) is not None


def bound(db: Session, card_id: str, kind: str) -> list[tuple[str, bool]]:
    """这张卡这一种绑了哪些:(目标, 是不是 primary),按顺序"""
    if not _migrated(db, card_id):
        return _old_rows(db, card_id, kind)
    return [(r.target_id, r.is_primary) for r in _rows(db, card_id, kind)]


def targets(db: Session, card_id: str, kind: str) -> list[str]:
    return [t for t, _ in bound(db, card_id, kind)]


def primary(db: Session, card_id: str, kind: str) -> str | None:
    """当前立绘包 / 主声音;没有是 None"""
    return next((t for t, p in bound(db, card_id, kind) if p), None)


def scene_parts(db: Session, card_id: str) -> dict[str, list[str]]:
    """这张卡的背景包、BGM 包:{"bg": [...], "bgm": [...]},各按 sort。parts 为空的两边都列;
    没迁过的卡读旧表,唯一那个包两边都列"""
    if not _migrated(db, card_id):
        ids = [t for t, _ in _old_rows(db, card_id, SCENE)]
        return {"bg": ids, "bgm": list(ids)}
    rows = _rows(db, card_id, SCENE)
    return {
        "bg": [r.target_id for r in rows if r.parts != PART_BGM],
        "bgm": [r.target_id for r in rows if r.parts != PART_BG],
    }


def cards_using(db: Session, kind: str, target_id: str) -> list[str]:
    """绑了这个目标的卡(没迁过的卡按旧表算)"""
    cards = set(
        db.scalars(
            select(AssetBinding.card_id).where(AssetBinding.kind == kind, AssetBinding.target_id == target_id)
        ).all()
    )
    migrated = set(db.scalars(select(CardRole.card_id).where(CardRole.is_main.is_(True))).all())
    old = {
        SPRITE: select(CardSpritePack.card_id).where(CardSpritePack.pack_id == target_id),
        VOICE: select(CardVoice.card_id).where(CardVoice.profile_id == target_id),
        SCENE: select(CardScenePack.card_id).where(CardScenePack.pack_id == target_id),
    }.get(kind)
    if old is not None:
        cards |= {c for c in db.scalars(old).all() if c not in migrated}
    return sorted(cards)


def count_cards(db: Session, kind: str, target_id: str) -> int:
    return len(cards_using(db, kind, target_id))


@dataclass(frozen=True)
class Use:
    """一张卡对一个目标的绑定:primary 同 bound;parts 只对场景包有意义('' 两边、bg、bgm),别的种类是 ''"""

    card_id: str
    primary: bool
    parts: str = ""


def uses_by_target(db: Session, kind: str) -> dict[str, list[Use]]:
    """这一种的全部绑定按目标分组,每组按卡的编号排(和 cards_using 算的是同一批卡;没迁过的卡按旧表,场景包两边都出)。
    素材管理页一次读完整个库用:固定三条查询,不随包和卡的个数涨"""
    out: dict[str, dict[str, Use]] = {}
    rows = db.execute(
        select(AssetBinding.target_id, AssetBinding.card_id, AssetBinding.is_primary, AssetBinding.parts).where(
            AssetBinding.kind == kind
        )
    )
    for target, card, is_primary, parts in rows:
        out.setdefault(target, {})[card] = Use(card, bool(is_primary), (parts or "") if kind == SCENE else "")
    old = {
        SPRITE: select(CardSpritePack.pack_id, CardSpritePack.card_id, CardSpritePack.is_current),
        VOICE: select(CardVoice.profile_id, CardVoice.card_id, CardVoice.is_main),
        SCENE: select(CardScenePack.pack_id, CardScenePack.card_id, false()),
    }.get(kind)
    if old is not None:
        migrated = set(db.scalars(select(CardRole.card_id).where(CardRole.is_main.is_(True))).all())
        for target, card, is_primary in db.execute(old):
            if card not in migrated:
                out.setdefault(target, {}).setdefault(card, Use(card, bool(is_primary)))
    return {target: [cards[c] for c in sorted(cards)] for target, cards in out.items()}


# ── 写 ──


def replace(db: Session, card_id: str, kind: str, ids: Sequence[str], primary: str | None = None) -> None:
    """整组替换这张卡这一种的绑定:ids 按顺序,primary 是其中哪一个(没有就 None)。不提交"""
    role = ensure_main_role(db, card_id)
    ids = list(dict.fromkeys(ids))
    rows = {r.target_id: r for r in _rows(db, card_id, kind)}
    for target, row in rows.items():
        if target not in ids:
            db.delete(row)
    db.flush()
    for i, target in enumerate(ids):
        row = rows.get(target)
        if row is None:
            row = AssetBinding(card_id=card_id, role_id=role.id if kind in ROLE_KINDS else "", kind=kind, target_id=target)
            db.add(row)
        row.sort = i
        row.is_primary = target == primary
    db.flush()
    _mirror(db, card_id, kind)


def replace_scene(db: Session, card_id: str, bg_ids: Sequence[str], bgm_ids: Sequence[str]) -> None:
    """整组替换这张卡的场景包:bg_ids 出背景、bgm_ids 出曲子。不提交。

    两份各自去重;排序用两份的并集:bg_ids 在前,只在 bgm_ids 里的按 bgm_ids 的顺序接在后面。每行的 parts 按它在不在
    两边定;旧表 card_scene_packs 镜像并集里第一个。
    已知限制:绑定行只有一个 sort,背景和 BGM 的先后共用这个并集顺序,不能各排各的
    (比如 bg [A]、bgm [B, A],读回来 bgm 是 [A, B])。"""
    bg = list(dict.fromkeys(bg_ids))
    bgm = list(dict.fromkeys(bgm_ids))
    union = bg + [p for p in bgm if p not in bg]
    replace(db, card_id, SCENE, union)
    for row in _rows(db, card_id, SCENE):
        both = row.target_id in bg and row.target_id in bgm
        row.parts = "" if both else (PART_BG if row.target_id in bg else PART_BGM)
    db.flush()


def replace_first_scene(db: Session, card_id: str, pack_id: str | None) -> None:
    """旧接口(一张卡一个场景包)的写法:换掉排第一的那个,换上的背景和 BGM 都出;后面叠着的和它们的 parts 不动。
    pack_id 为 None = 拿掉排第一的那个。不提交"""
    rest = targets(db, card_id, SCENE)[1:]
    ids = ([pack_id] if pack_id else []) + [p for p in rest if p != pack_id]
    replace(db, card_id, SCENE, ids)
    if pack_id:
        for row in _rows(db, card_id, SCENE):
            if row.target_id == pack_id:
                row.parts = ""
        db.flush()


def remove_target(db: Session, kind: str, target_id: str) -> list[str]:
    """包、声音被删了:拿掉所有卡上指向它的绑定,返回受影响的卡。primary 被拿掉以后换成谁由调用方决定"""
    affected = cards_using(db, kind, target_id)
    for card_id in affected:
        ensure_main_role(db, card_id)
    db.execute(delete(AssetBinding).where(AssetBinding.kind == kind, AssetBinding.target_id == target_id))
    db.flush()
    for card_id in affected:
        _mirror(db, card_id, kind)
    return affected


def delete_card(db: Session, card_id: str) -> None:
    """删卡时:绑定、角色位、旧表行都删。包和声音本身是共用的,不跟着删"""
    db.execute(delete(AssetBinding).where(AssetBinding.card_id == card_id))
    db.execute(delete(CardRole).where(CardRole.card_id == card_id))
    db.execute(delete(CardSpritePack).where(CardSpritePack.card_id == card_id))
    db.execute(delete(CardVoice).where(CardVoice.card_id == card_id))
    db.execute(delete(CardScenePack).where(CardScenePack.card_id == card_id))
    db.flush()


def copy_card(db: Session, src_id: str, dst_id: str) -> None:
    """复制卡时:同样的角色位、同样的绑定(指向同一些包和声音,不复制它们本身;场景包连同出背景还是 BGM)"""
    for kind in KINDS:
        if kind == SCENE:
            parts = scene_parts(db, src_id)
            replace_scene(db, dst_id, parts["bg"], parts["bgm"])
            continue
        items = bound(db, src_id, kind)
        replace(db, dst_id, kind, [t for t, _ in items], next((t for t, p in items if p), None))


def roster(db: Session, card_id: str) -> dict:
    """名册:角色位和各自绑的东西(给绑定面板;只读,没迁过的卡按旧表现算)"""
    role = main_role(db, card_id)
    sprites = bound(db, card_id, SPRITE)
    voices = bound(db, card_id, VOICE)
    roles = [
        {
            "id": role.id if role else None,
            "name": role.name if role else (db.scalar(select(TavernCard.name).where(TavernCard.id == card_id)) or ""),
            "aliases": list(role.aliases or []) if role else [],
            "is_main": True,
            "sprite_packs": [t for t, _ in sprites],
            "current_sprite_pack": next((t for t, p in sprites if p), None),
            "voices": {"main": next((t for t, p in voices if p), None), "backups": [t for t, p in voices if not p]},
        }
    ]
    return {
        "card_id": card_id,
        "roles": roles,
        "scene_packs": targets(db, card_id, SCENE),
        # 同一批场景包,分成出背景的、出曲子的(一个包可能两边都在)
        "scene_parts": scene_parts(db, card_id),
        "cg_packs": targets(db, card_id, CG),
    }

