"""导入记录(import_jobs):列出来、导完认领没认出来的文件、撤销(实施计划第 3 段 B5;设计稿 6.2「撤销这次导入」)。

撤销照记录做三件事,都在一个事务里(调用方提交):
1. 拿掉加到原有卡上的绑定(bound,倒着来);当前立绘包是这次换的,换回原来那套;
2. 删这次建的包(连同所有卡上的绑定,已经被别的卡用上的也照删 —— undo-preview 先列出来给确认框)和卡
   (和删卡接口一样:状态卡、绑定、按卡设置一起删,对话留着);删法和各 router 的删除接口是同一套函数;
3. 选了「更新这张卡」的,字段改回导入前的样子;
4. 角色包(第 3 步)多建的:预设(连同 app_settings 的 preset.bindings 里指着这次的卡、这次的预设的项;preset.bindings 是这次
   才建的、删完空了就整个删)、状态组、补进内置名单的认词记录;这次建的立绘包的认词记录、配对表,指着这次的 CG 的配对表也删
   (包删了它们就没有用了,删包接口本身不删它们)。按卡设置跟着卡删。
5. 声音(第 4 步):这次建的声音(连同情绪行、绑定、指着它的语音配对表);库里原来没有语音服务、这次新建的那个,
   没有别的声音在用就一起删。仓库里的文件不动,按清理的规矩处理(没人用了 24 小时后挪进回收区)。
"""

from __future__ import annotations

import shutil
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app import bindings
from app.api.cg_packs import delete_cg_pack
from app.api.scenes import delete_scene_pack
from app.api.sprites import _next_current, delete_sprite_pack
from app.api.tavern import delete_card_cascade
from app.api.voices import delete_profile_cascade
from app.importer import staging
from app.importer.apply import ImportContext, empty_created
from app.importer.audio import CONVERTED
from app.importer.staging import StagedTree
from app.models import (
    AppSetting,
    CardState,
    CardStateGroup,
    CgAsset,
    CgPack,
    DebugChat,
    ImportJob,
    Pairing,
    PairingRow,
    PromptPreset,
    SceneAsset,
    ScenePack,
    SpritePack,
    TavernCard,
    TtsConnection,
    VoiceProfile,
    WordRecord,
)

PRESET_BINDINGS = "preset.bindings"

LIST_LIMIT = 50
# 记录里的包类型 → (created 里的键, 模型, 绑定的 kind, 叫什么)
PACK_KINDS = (
    ("sprite", "sprite_packs", SpritePack, bindings.SPRITE, "立绘包"),
    ("scene", "scene_packs", ScenePack, bindings.SCENE, "场景包"),
    ("cg", "cg_packs", CgPack, bindings.CG, "CG 包"),
)
MODEL_OF_BINDING = {kind: (model, noun) for _, _, model, kind, noun in PACK_KINDS}


def load_job(db: Session, job_id: str) -> ImportJob:
    job = db.get(ImportJob, job_id)
    if job is None:
        raise HTTPException(404, "没有这条导入记录")
    return job


def must_be_live(job: ImportJob) -> None:
    if job.status != "done":
        raise HTTPException(409, "这次导入已经撤销了")


def _created(job: ImportJob) -> dict:
    return {**empty_created(), **(job.created or {})}


def counts_of(job: ImportJob) -> dict:
    c = _created(job)
    return {
        "cards": len(c["cards"]),
        "sprite_packs": len(c["sprite_packs"]),
        "scene_packs": len(c["scene_packs"]),
        "cg_packs": len(c["cg_packs"]),
        # 加到原有卡上的绑定(只换了当前立绘包的不算)
        "bound": sum(1 for e in job.bound or [] if e.get("added", True)),
        "updated_cards": len(job.replaced_cards or {}),
        "unknown": len(job.unknown or []),
    }


def list_jobs(db: Session, limit: int = LIST_LIMIT) -> list[dict]:
    """最近的导入记录,新的在前"""
    rows = db.scalars(select(ImportJob).order_by(ImportJob.created_at.desc()).limit(limit)).all()
    return [
        {
            "id": j.id,
            "created_at": j.created_at,
            "title": j.title,
            "status": j.status,
            "card_id": j.card_id,
            "counts": counts_of(j),
        }
        for j in rows
    ]


# ── 认领 ──


def classify_file(db: Session, tree: StagedTree, job: ImportJob, path: str, kind: str) -> None:
    """导完在提示条里给一个没认出来的文件选了类型:归进这次建的同类包(没有就新建「角色 · 补充」),报告接一句"""
    ctx = ImportContext.of_job(db, tree, job)
    ctx.classify(path, kind)
    ctx.save(job)
    job.report = list(job.report or []) + ctx.new_lines() + ctx.problems + ctx.faces
    db.flush()


def prune_staging(tree: StagedTree, keep: list[str]) -> None:
    """导完以后暂存目录只留还没认领的文件(以后在提示条里认领要用);一个都不剩就整个删掉。出错不管(过 7 天会清)"""
    try:
        if not keep:
            staging.discard(tree.plan_id, tree.dir.parent)
            return
        wanted = set(keep)
        for f in tree.files:
            if f.path not in wanted:
                tree.path(f.path).unlink(missing_ok=True)
        shutil.rmtree(tree.dir / CONVERTED, ignore_errors=True)
    except OSError:
        pass


# ── 撤销 ──


def _card_name(db: Session, card_id: str) -> str | None:
    card = db.get(TavernCard, card_id)
    return card.name if card is not None else None


def describe(db: Session, job: ImportJob) -> dict:
    """撤销会做什么(确认框用):删哪些卡和包(包还被别的卡用着的列出来)、从哪些原有的卡上拿掉什么、改回哪些卡"""
    created = _created(job)
    new_cards = set(created["cards"])
    cards = [{"id": cid, "name": name} for cid in created["cards"] if (name := _card_name(db, cid)) is not None]
    lines = [f"删掉这次新建的角色卡「{c['name']}」(和它聊过的对话留着)" for c in cards]

    packs = []
    made: set[str] = set()
    for kind, key, model, binding_kind, noun in PACK_KINDS:
        for pid in created[key]:
            made.add(pid)
            pack = db.get(model, pid)
            if pack is None:
                continue
            mine = new_cards | {e["card_id"] for e in job.bound or [] if e["target_id"] == pid}
            other = [
                {"id": cid, "name": name}
                for cid in bindings.cards_using(db, binding_kind, pid)
                if cid not in mine and (name := _card_name(db, cid)) is not None
            ]
            packs.append({"kind": kind, "id": pid, "name": pack.name, "other_cards": other})
            text = f"删掉{noun}「{pack.name}」"
            if other:
                text += f"({'、'.join('「' + c['name'] + '」' for c in other)}也在用,会一起拿掉)"
            lines.append(text)

    unbind = []
    for e in job.bound or []:
        card_name = _card_name(db, e["card_id"])
        model, noun = MODEL_OF_BINDING[e["kind"]]
        target = db.get(model, e["target_id"])
        if card_name is None or target is None:
            continue
        if e["kind"] == bindings.SPRITE and e.get("previous_primary"):
            if bindings.primary(db, e["card_id"], bindings.SPRITE) == e["target_id"]:
                prev = db.get(SpritePack, e["previous_primary"])
                if prev is not None:
                    lines.append(f"「{card_name}」的当前服装换回「{prev.name}」")
        if e["target_id"] in made or not e.get("added", True):
            continue  # 包会删掉,绑定跟着没;只换了当前立绘包的上面已经写了
        unbind.append(
            {
                "card_id": e["card_id"],
                "card_name": card_name,
                "kind": e["kind"],
                "target_id": e["target_id"],
                "target_name": target.name,
                "parts": e.get("parts"),
            }
        )
        side = {bindings.PART_BG: "(背景)", bindings.PART_BGM: "(BGM)"}.get(e.get("parts") or "", "")
        lines.append(f"从「{card_name}」上拿掉{noun}「{target.name}」{side}")

    voices = [{"id": v.id, "name": v.name} for vid in created["voices"] if (v := db.get(VoiceProfile, vid)) is not None]
    lines += [f"删掉这次新建的声音「{v['name']}」" for v in voices]
    presets = [{"id": p.id, "name": p.name} for pid in created["presets"] if (p := db.get(PromptPreset, pid)) is not None]
    lines += [f"删掉这次新建的预设「{p['name']}」" for p in presets]

    restore = [
        {"id": cid, "name": name} for cid in (job.replaced_cards or {}) if (name := _card_name(db, cid)) is not None
    ]
    lines += [f"把角色卡「{c['name']}」的资料改回导入前的样子" for c in restore]
    return {
        "job_id": job.id,
        "title": job.title,
        "status": job.status,
        "cards": cards,
        "packs": packs,
        "voices": voices,
        "presets": presets,
        "unbind": unbind,
        "restore_cards": restore,
        "lines": lines,
    }


def _unbind(db: Session, e: dict) -> None:
    card_id, target, kind = e["card_id"], e["target_id"], e["kind"]
    if db.get(TavernCard, card_id) is None:
        return
    if kind == bindings.SPRITE:
        ids = bindings.targets(db, card_id, bindings.SPRITE)
        cur = bindings.primary(db, card_id, bindings.SPRITE)
        keep = [p for p in ids if p != target] if e.get("added", True) else ids
        current = cur
        # 当前立绘包还是这次换上的(或者被拿掉了):换回导入前那套;之后自己换过的不动
        if cur == target or cur not in keep:
            prev = e.get("previous_primary")
            current = prev if prev in keep else _next_current(ids, cur, keep)
        bindings.replace(db, card_id, bindings.SPRITE, keep, current)
    elif kind == bindings.SCENE:
        parts = bindings.scene_parts(db, card_id)
        side = e.get("parts") or ""
        bg = [p for p in parts["bg"] if not (p == target and side in ("", bindings.PART_BG))]
        bgm = [p for p in parts["bgm"] if not (p == target and side in ("", bindings.PART_BGM))]
        bindings.replace_scene(db, card_id, bg, bgm)
    elif kind == bindings.CG:
        ids = bindings.targets(db, card_id, bindings.CG)
        bindings.replace(db, card_id, bindings.CG, [p for p in ids if p != target])


def undo(db: Session, job: ImportJob) -> dict:
    """撤销这次导入;不提交。返回做了什么(同 describe,status 是 undone)"""
    out = describe(db, job)
    created = _created(job)
    _forget_followers(db, created)
    for e in reversed(job.bound or []):
        _unbind(db, e)
    for pid in created["cg_packs"]:
        delete_cg_pack(db, pid)
    for pid in created["scene_packs"]:
        delete_scene_pack(db, pid)
    for pid in created["sprite_packs"]:
        delete_sprite_pack(db, pid)
    for cid in created["cards"]:
        delete_card_cascade(db, cid)
    for vid in created["voices"]:
        delete_profile_cascade(db, vid)
    for cid in created["tts_connections"]:
        conn = db.get(TtsConnection, cid)
        if conn is not None and db.scalar(select(VoiceProfile.id).where(VoiceProfile.connection_id == cid).limit(1)) is None:
            db.delete(conn)
    _forget_bundle_extras(db, created)
    for cid, fields in (job.replaced_cards or {}).items():
        card = db.get(TavernCard, cid)
        if card is not None:
            for name, value in fields.items():
                setattr(card, name, value)
    job.status = "undone"
    job.undone_at = datetime.now(timezone.utc)
    db.flush()
    return {**out, "status": job.status}


def _forget_followers(db: Session, created: dict) -> None:
    """包删掉以前:这次建的立绘包的认词记录、配对表,指着这次的 CG(CG 包、场景包里的)的配对表"""
    lists = [f"pack:{pid}" for pid in created["sprite_packs"]]
    cgs = list(db.scalars(select(CgAsset.id).where(CgAsset.pack_id.in_(created["cg_packs"]))).all())
    cgs += list(db.scalars(select(SceneAsset.id).where(SceneAsset.pack_id.in_(created["scene_packs"]), SceneAsset.kind == "cg")).all())
    if lists:
        db.execute(delete(WordRecord).where(WordRecord.list_ref.in_(lists)))
    pairings = list(
        db.scalars(
            select(Pairing.id).where(
                (Pairing.list_ref.in_(lists))
                | (Pairing.target.in_(cgs + list(created["voices"])))
                | (Pairing.card_id.in_(created["cards"]))
            )
        ).all()
    )
    if pairings:
        db.execute(delete(PairingRow).where(PairingRow.pairing_id.in_(pairings)))
        db.execute(delete(Pairing).where(Pairing.id.in_(pairings)))
    if created["word_records"]:
        db.execute(delete(WordRecord).where(WordRecord.id.in_(created["word_records"])))
    db.flush()


def _forget_bundle_extras(db: Session, created: dict) -> None:
    """卡和包删完以后:预设和它的绑定、状态组(主卡删了一般已经拆掉了)、这次新建的设置键"""
    presets = set(created["presets"])
    cards = set(created["cards"])
    for pid in presets:
        preset = db.get(PromptPreset, pid)
        if preset is not None:
            db.execute(update(DebugChat).where(DebugChat.preset_id == pid).values(preset_id=None))
            db.delete(preset)
    row = db.get(AppSetting, PRESET_BINDINGS)
    if row is not None and isinstance(row.value, dict) and (presets or cards):
        value = dict(row.value)
        bound = value.get("cards")
        if isinstance(bound, dict):
            value["cards"] = {c: p for c, p in bound.items() if c not in cards and p not in presets}
        if value.get("default") in presets:
            value["default"] = None
        if PRESET_BINDINGS in created["settings"] and not value.get("cards") and not value.get("default"):
            db.delete(row)
        elif value != row.value:
            row.value = value
    for gid in created["state_groups"]:
        db.execute(delete(CardState).where(CardState.group_id == gid))
        group = db.get(CardStateGroup, gid)
        if group is not None:
            db.delete(group)
    db.flush()
