"""素材管理页的接口(素材架构第 1 步 B6;设计稿 6.7、12.1 10-15)。

- GET /api/library/{kind}             kind = sprite / bg / bgm / cg / voice。按包列,不按角色分组(一个角色可能绑别人的包):
                                      [{id, name, count, bytes, card_ids, cover_sha, content_key, import_job_id,
                                        created_at, updated_at, generated(只有 cg)}],按建的先后
- GET /api/library/{kind}/{id}/usage  删之前问一句用(10-15 定:列出还有哪些卡在用、删了它们会怎样,然后直接删,不进回收区):
                                      {cards: [{id, name, effect, parts(只有 bg / bgm)}], files, bytes, by_kind, other_kinds}

背景、BGM 不是两种包:都是场景包(包本身不拆,绑定行的 parts 记一张卡用它的哪一边)。背景页列有背景的场景包、BGM 页列有曲子的,
一个包可能两边都在;两边都空的场景包两边都列,免得在素材管理里找不到它。在哪一页删都是删整个包(other_kinds 提醒另一边也有东西)。
复制包、删包走各自的接口(/api/sprite-packs/{id}/duplicate 等;删包是各 router 的 DELETE)。

列表一次读完整个库(用户的库约 30 个立绘包、13 个场景包、32 个声音):包一条查询、素材行连 blobs 表一条、绑定三条、导入记录一条,
不随包的个数涨(tests/test_library_api.py 数着查询次数)。
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, literal, null, select
from sqlalchemy.orm import Session

from app import bindings, cg_sync
from app.api.sprites import _next_current
from app.db import get_db
from app.models import (
    Blob,
    CgAsset,
    CgPack,
    ImportJob,
    PackSprite,
    SceneAsset,
    ScenePack,
    SpritePack,
    TavernCard,
    VoiceEmotion,
    VoiceProfile,
)
from app.schemas import LibraryCardUseOut, LibraryFilesOut, LibraryItemOut, LibraryUsageOut

router = APIRouter(prefix="/api/library", tags=["library"])

KINDS = ("sprite", "bg", "bgm", "cg", "voice")
# 中文里夹的英文前后空一格
SIDE_WORD = {"bg": "背景", "bgm": " BGM "}
# 导入记录 created 里的键
CREATED_KEY = {"sprite": "sprite_packs", "bg": "scene_packs", "bgm": "scene_packs", "cg": "cg_packs"}


def _check_kind(kind: str) -> None:
    if kind not in KINDS:
        raise HTTPException(404, f"没有这一类素材:{kind}")


# ── 素材行 ──


@dataclass(frozen=True)
class _File:
    """包里的一行素材(只要列表用得到的几列)"""

    pack_id: str
    id: str
    sha: str | None
    has_file: bool
    size: int
    enabled: bool
    # 算进 count、能当封面(CG 的差分不算)
    main: bool
    updated_at: datetime
    kind: str


def _files(db: Session, kind: str, pack_id: str | None = None) -> list[_File]:
    """一类素材的行,按包、按游戏里的顺序;连 blobs 表取大小(没登记的:场景素材、CG 用行里记的大小,立绘用库里原件的长度)。
    kind:sprite / cg;bg、bgm 两边一起读(背景页要知道哪些包两边都空);scene 是场景包的全部(连 CG)。
    pack_id 给了就只读这个包。一条查询"""
    if kind == "sprite":
        # 立绘没有大小列:库里原件的长度(SQLite 的 length 不用把整张图读出来)
        m, sha, own_size = PackSprite, PackSprite.image_sha, func.length(PackSprite.image)
        parent, row_kind = null(), literal("sprite")
    elif kind == "cg":
        m, sha, own_size, parent, row_kind = CgAsset, CgAsset.data_sha, CgAsset.size, CgAsset.parent_id, literal("cg")
    else:
        m, sha, own_size, parent, row_kind = SceneAsset, SceneAsset.data_sha, SceneAsset.size, SceneAsset.parent_id, SceneAsset.kind
    stmt = select(m.pack_id, m.id, sha, m.mime, m.enabled, m.updated_at, Blob.size, own_size, parent, row_kind)
    stmt = stmt.outerjoin(Blob, Blob.sha == sha)
    if kind in ("bg", "bgm"):
        stmt = stmt.where(SceneAsset.kind.in_(("bg", "bgm")))
    if pack_id is not None:
        stmt = stmt.where(m.pack_id == pack_id)
    out = []
    for pid, rid, file_sha, mime, enabled, updated, blob_size, row_size, parent_id, k in db.execute(
        stmt.order_by(m.pack_id, m.sort, m.created_at)
    ):
        has_file = mime is not None
        out.append(
            _File(
                pack_id=pid,
                id=rid,
                sha=file_sha if has_file else None,
                has_file=has_file,
                size=(blob_size if blob_size is not None else row_size or 0) if has_file else 0,
                enabled=bool(enabled),
                main=parent_id is None,
                updated_at=updated,
                kind=k,
            )
        )
    return out


def _bytes(files: list[_File]) -> int:
    """同一个文件(同一个指纹)只算一次;还没进文件仓库的按行算"""
    seen: dict[str, int] = {}
    for f in files:
        if f.has_file:
            seen.setdefault(f.sha or f"row:{f.id}", f.size)
    return sum(seen.values())


def _content_key(tokens: list[str]) -> str | None:
    return hashlib.sha256("\n".join(sorted(tokens)).encode()).hexdigest() if tokens else None


def _file_key(files: list[_File]) -> str | None:
    """这一类文件的指纹排好序的哈希(重复的文件照算几次,和导入找重复一样按整份比);
    还没进文件仓库(没指纹)的行用它自己的编号顶上 —— 这种包不和别的包算重复"""
    return _content_key([f.sha or f"row:{f.id}" for f in files if f.has_file])


def _cover(files: list[_File]) -> str | None:
    return next((f.sha for f in files if f.main and f.enabled and f.sha), None)


def _updated(pack_updated: datetime, files: list[_File]) -> datetime:
    return max([pack_updated, *(f.updated_at for f in files)])


# ── 列表 ──


def _import_jobs(db: Session, kind: str) -> dict[str, str]:
    """包 → 建它的那次导入(还没撤销的里最新的一条)。一条查询"""
    key = CREATED_KEY.get(kind)
    if key is None:
        return {}
    out: dict[str, str] = {}
    rows = db.execute(select(ImportJob.id, ImportJob.created).where(ImportJob.status == "done").order_by(ImportJob.created_at))
    for job_id, created in rows:
        for pid in (created or {}).get(key) or []:
            out[pid] = job_id
    return out


BINDING_KIND = {"sprite": bindings.SPRITE, "bg": bindings.SCENE, "bgm": bindings.SCENE, "cg": bindings.CG, "voice": bindings.VOICE}


def _card_ids(db: Session, kind: str) -> dict[str, list[str]]:
    """目标 → 绑了它的卡。背景页只算出背景的绑定(parts 是 '' 或 bg),BGM 页只算出曲子的"""
    other_side = {"bg": bindings.PART_BGM, "bgm": bindings.PART_BG}.get(kind)
    return {
        target: [u.card_id for u in uses if other_side is None or u.parts != other_side]
        for target, uses in bindings.uses_by_target(db, BINDING_KIND[kind]).items()
    }


def _item(pack, kind: str, files: list[_File], count: int, cards: dict, jobs: dict, **extra) -> LibraryItemOut:
    return LibraryItemOut(
        id=pack.id,
        name=pack.name,
        count=count,
        bytes=_bytes(files),
        card_ids=cards.get(pack.id, []),
        cover_sha=_cover(files) if kind != "bgm" else None,
        content_key=_file_key(files),
        import_job_id=jobs.get(pack.id),
        created_at=pack.created_at,
        updated_at=_updated(pack.updated_at, files),
        **extra,
    )


def _group(files: list[_File]) -> dict[str, list[_File]]:
    out: dict[str, list[_File]] = defaultdict(list)
    for f in files:
        out[f.pack_id].append(f)
    return out


def _voice_key(p: VoiceProfile, refs: list[str]) -> str | None:
    """声音没有文件在这边:按语音服务、两份权重、音色参考和各情绪的参考音频路径算;什么都没填的空声音是 null"""
    if not (p.gpt_weights or p.sovits_weights or p.ref_path or any(refs)):
        return None
    return hashlib.sha256(
        json.dumps([p.connection_id, p.gpt_weights, p.sovits_weights, p.ref_path, sorted(refs)], ensure_ascii=False).encode()
    ).hexdigest()


def list_items(db: Session, kind: str) -> list[LibraryItemOut]:
    cards = _card_ids(db, kind)
    jobs = _import_jobs(db, kind)
    if kind == "voice":
        emotions: dict[str, list] = defaultdict(list)
        for pid, ref, updated in db.execute(
            select(VoiceEmotion.profile_id, VoiceEmotion.ref_path, VoiceEmotion.updated_at).order_by(VoiceEmotion.sort)
        ):
            emotions[pid].append((ref, updated))
        out = []
        for p in db.scalars(select(VoiceProfile).order_by(VoiceProfile.created_at)).all():
            rows = emotions.get(p.id, [])
            out.append(
                LibraryItemOut(
                    id=p.id,
                    name=p.name,
                    count=len(rows),
                    bytes=0,
                    card_ids=cards.get(p.id, []),
                    cover_sha=None,
                    content_key=_voice_key(p, [ref for ref, _ in rows]),
                    import_job_id=None,
                    created_at=p.created_at,
                    updated_at=max([p.updated_at, *(u for _, u in rows)]),
                )
            )
        return out
    if kind == "sprite":
        by_pack = _group(_files(db, kind))
        packs = db.scalars(select(SpritePack).order_by(SpritePack.created_at)).all()
        return [_item(p, kind, by_pack.get(p.id, []), len(by_pack.get(p.id, [])), cards, jobs) for p in packs]
    if kind == "cg":
        by_pack = _group(_files(db, kind))
        packs = db.scalars(select(CgPack).order_by(CgPack.created_at)).all()
        out = []
        for p in packs:
            files = by_pack.get(p.id, [])
            out.append(_item(p, kind, files, sum(f.main for f in files), cards, jobs, generated=bool(p.generated)))
        return out
    # 背景 / BGM:场景包的一边;两边都空的两边都列
    by_pack = _group(_files(db, kind))
    out = []
    for p in db.scalars(select(ScenePack).order_by(ScenePack.created_at)).all():
        both = by_pack.get(p.id, [])
        files = [f for f in both if f.kind == kind]
        if files or not both:
            out.append(_item(p, kind, files, len(files), cards, jobs))
    return out


@router.get("/{kind}", response_model=list[LibraryItemOut], response_model_exclude_unset=True)
def get_items(kind: str, db: Session = Depends(get_db)):
    _check_kind(kind)
    return list_items(db, kind)


# ── 删之前问一句 ──


def _names(db: Session, ids: list[str]) -> dict[str, str]:
    return dict(db.execute(select(TavernCard.id, TavernCard.name).where(TavernCard.id.in_(ids))).all()) if ids else {}


def _cards_out(db: Session, effects: dict[str, tuple[str, list[str] | None]]) -> list[LibraryCardUseOut]:
    """{卡: (一句话, 用哪几边)} → 按卡名排的列表(卡已经不在的不列)"""
    names = _names(db, list(effects))
    out = []
    for cid in sorted(names, key=lambda c: (names[c], c)):
        effect, parts = effects[cid]
        fields = {"parts": parts} if parts is not None else {}
        out.append(LibraryCardUseOut(id=cid, name=names[cid], effect=effect, **fields))
    return out


def _files_out(files: list[_File]) -> LibraryFilesOut:
    return LibraryFilesOut(files=sum(f.has_file for f in files), bytes=_bytes(files))


def _sprite_usage(db: Session, pack_id: str) -> LibraryUsageOut:
    if db.get(SpritePack, pack_id) is None:
        raise HTTPException(404, "立绘包不存在")
    effects = {}
    for cid in bindings.cards_using(db, bindings.SPRITE, pack_id):
        if bindings.primary(db, cid, bindings.SPRITE) != pack_id:
            effects[cid] = ("挂着没在用;删了就少一套可换", None)
            continue
        # 和删包时一样换:原来排在它后面、还挂着的下一个
        old = bindings.targets(db, cid, bindings.SPRITE)
        nxt = _next_current(old, pack_id, [p for p in old if p != pack_id])
        nxt_pack = db.get(SpritePack, nxt) if nxt else None
        effects[cid] = (f"正在用这套;删了会换成「{nxt_pack.name}」" if nxt_pack else "正在用这套;删了就没有立绘了", None)
    total = _files_out(_files(db, "sprite", pack_id))
    return LibraryUsageOut(
        cards=_cards_out(db, effects), files=total.files, bytes=total.bytes, by_kind={"sprite": total}, other_kinds=[]
    )


def _side_phrase(side: str, rest: list[str], names: dict[str, str]) -> str:
    """删了以后这一边怎样:rest 是这张卡这一边剩下的、有东西的包"""
    word = SIDE_WORD[side]
    if not rest:
        return f"删了这张卡就没有{word}了"
    more = f"等 {len(rest)} 个包" if len(rest) > 1 else ""
    return f"还有「{names.get(rest[0], '')}」{more}的{word.rstrip()}"


def _scene_usage(db: Session, pack_id: str, kind: str) -> LibraryUsageOut:
    if db.get(ScenePack, pack_id) is None:
        raise HTTPException(404, "场景包不存在")
    files = _files(db, "scene", pack_id)
    split = cg_sync.cg_pack_of_scene(db, pack_id) is not None
    # 删场景包删的是整个包;拆出去的 CG 包留着(它自己的行还在),所以那些 CG 不算
    files = [f for f in files if f.kind != "cg" or not split]
    by_kind = {k: [f for f in files if f.kind == k] for k in ("bg", "bgm", "cg")}
    has = {"bg": bool(by_kind["bg"]), "bgm": bool(by_kind["bgm"])}
    other = "bgm" if kind == "bg" else "bg"
    other_kinds = [k for k in (other, "cg") if by_kind[k]]

    # 每张卡别的场景包里有没有背景 / 曲子(一条查询)
    content = defaultdict(set)
    for pid, k in db.execute(
        select(SceneAsset.pack_id, SceneAsset.kind).where(SceneAsset.kind.in_(("bg", "bgm"))).distinct()
    ):
        content[k].add(pid)
    users = bindings.cards_using(db, bindings.SCENE, pack_id)
    parts_of = {cid: bindings.scene_parts(db, cid) for cid in users}
    names = dict(db.execute(select(ScenePack.id, ScenePack.name)).all())
    effects = {}
    for cid in users:
        parts = parts_of[cid]
        sides = [s for s in (kind, other) if pack_id in parts[s]]
        # 这张卡用到的那几边,删了以后还剩哪些包有东西
        rest = {s: [p for p in parts[s] if p != pack_id and p in content[s]] for s in sides if has[s]}
        if len(rest) == 2 and not any(rest.values()):
            effect = "删了这张卡就没有背景和 BGM 了"
        elif rest:
            effect = ";".join(_side_phrase(s, r, names) for s, r in rest.items())
        else:
            effect = "绑着,但没用到这个包里的东西;删了没影响"
        effects[cid] = (effect, [s for s in ("bg", "bgm") if s in sides])
    total = _files_out(files)
    return LibraryUsageOut(
        cards=_cards_out(db, effects),
        files=total.files,
        bytes=total.bytes,
        by_kind={k: _files_out(v) for k, v in by_kind.items() if v},
        other_kinds=other_kinds,
    )


def _cg_usage(db: Session, pack_id: str) -> LibraryUsageOut:
    if db.get(CgPack, pack_id) is None:
        raise HTTPException(404, "CG 包不存在")
    effects = {}
    for cid in bindings.cards_using(db, bindings.CG, pack_id):
        others = [p for p in bindings.targets(db, cid, bindings.CG) if p != pack_id]
        effects[cid] = ("删了就少这些 CG" if others else "删了这张卡就没有 CG 了", None)
    total = _files_out(_files(db, "cg", pack_id))
    return LibraryUsageOut(
        cards=_cards_out(db, effects), files=total.files, bytes=total.bytes, by_kind={"cg": total}, other_kinds=[]
    )


def _voice_usage(db: Session, profile_id: str) -> LibraryUsageOut:
    if db.get(VoiceProfile, profile_id) is None:
        raise HTTPException(404, "声音不存在")
    effects = {}
    for cid in bindings.cards_using(db, bindings.VOICE, profile_id):
        main = bindings.primary(db, cid, bindings.VOICE) == profile_id
        effects[cid] = ("主声音;删了就不念台词" if main else "备用声音", None)
    # 参考音频在语音机上,删声音不删它们:files 是情绪的行数,bytes 是 0
    n = db.scalar(select(func.count()).select_from(VoiceEmotion).where(VoiceEmotion.profile_id == profile_id)) or 0
    return LibraryUsageOut(
        cards=_cards_out(db, effects), files=n, bytes=0, by_kind={"voice": LibraryFilesOut(files=n, bytes=0)}, other_kinds=[]
    )


@router.get("/{kind}/{item_id}/usage", response_model=LibraryUsageOut, response_model_exclude_unset=True)
def get_usage(kind: str, item_id: str, db: Session = Depends(get_db)):
    _check_kind(kind)
    if kind == "sprite":
        return _sprite_usage(db, item_id)
    if kind in ("bg", "bgm"):
        return _scene_usage(db, item_id, kind)
    if kind == "cg":
        return _cg_usage(db, item_id)
    return _voice_usage(db, item_id)
