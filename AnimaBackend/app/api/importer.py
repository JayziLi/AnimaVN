"""拖进来就认的导入(素材架构第 1 步第 3 段 B5;设计稿 6.2、6.6):出计划、执行、认领没认出来的文件、导入记录、撤销。

- POST /api/import/plan               multipart:files、paths(JSON,和 files 一一对应的相对路径;没给用文件名)、
                                      target_card_id(拖到的卡)、kind(拖到素材页的哪一栏:sprite / bg / bgm / cg)
                                      → {plan_id, groups, unknown, skipped, needs_confirm}
- POST /api/import/{plan_id}/apply    {decisions, classify, make_current, options} → {job_id, card_id, notice, report, created}
                                      (created = 这次新建的卡和包的编号 {cards, sprite_packs, scene_packs, cg_packs},
                                      角色包另有 presets、state_groups、word_records、settings);
                                      options = {组的 key: {"preset": true | false}}(角色包组要不要另建建议的预设,默认要)
- GET  /api/import/{plan_id}/file?path=&w=  暂存目录里的一个文件(导入确认里角色包的预览图、缩略图;只许取暂存目录里的;
                                      图片带 w 时缩成 WebP)
- DELETE /api/import/{plan_id}        确认框点了取消:删掉暂存(执行过的回 409)
- POST /api/import/jobs/{id}/classify {path, kind} → 同 apply 的返回(notice 是认领以后的)
- GET  /api/import/jobs               最近 50 条 {id, created_at, title, status, card_id, counts}
- GET  /api/import/jobs/{id}/undo-preview → 撤销会删 / 拿掉 / 改回什么(确认框用)
- POST /api/import/jobs/{id}/undo     → 同 undo-preview,status 是 undone

计划出来时整份存在暂存目录的 plan.json(执行时照它建,不重新认),拖进来的最上面一层记在 upload.json(导入记录的摘要用)。
执行在一个事务里:中途出错整体回滚、回 500,暂存的文件留着,能再点一次;已经写进文件仓库的文件没人引用,清理时收走。
"""

import json
import logging
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.assets.common import sniff_image_mime
from app.db import get_db
from app.images import MAX_WIDTH, MIN_WIDTH, shrink_image
from app.importer import jobs, staging
from app.importer.apply import CLASSIFY_KINDS, apply_plan, result_of
from app.importer.classify import BUNDLE_TYPES, FORCED_KINDS, ImportPlan, build_plan
from app.models import ImportJob, TavernCard

router = APIRouter(prefix="/api/import", tags=["import"])
log = logging.getLogger(__name__)

PLAN_FILE = "plan.json"
UPLOAD_FILE = "upload.json"
# 素材页有这两栏,但不能拖文件进来导入
NOT_DROPPABLE = {"voice": "声音", "ai": "AI 生成"}


class ImportApplyIn(BaseModel):
    decisions: dict[str, str] = {}
    classify: dict[str, str] = {}
    make_current: bool = False
    options: dict[str, dict] = {}


class ImportClassifyIn(BaseModel):
    path: str
    kind: str


def _paths(raw: str | None, files: list[UploadFile]) -> list[str]:
    if not raw:
        return [f.filename or f"file{i}" for i, f in enumerate(files)]
    try:
        paths = json.loads(raw)
    except ValueError as e:
        raise HTTPException(400, "paths 不是合法的 JSON") from e
    if not isinstance(paths, list) or len(paths) != len(files) or not all(isinstance(p, str) for p in paths):
        raise HTTPException(400, "paths 要是和 files 一一对应的路径列表")
    return paths


def _tops(paths: list[str]) -> list[list]:
    """拖进来的最上面一层:[[名字, 是不是文件夹], …],按出现的先后"""
    out: dict[str, bool] = {}
    for p in paths:
        parts = [x for x in re.split(r"[\\/]+", p) if x not in ("", ".")]
        if parts:
            out[parts[0]] = out.get(parts[0], False) or len(parts) > 1
    return [[name, is_dir] for name, is_dir in out.items()]


def _group_out(g) -> dict:
    d = g.detail
    if g.type in BUNDLE_TYPES:
        # 角色包 / 单包:导入确认照 detail 画(技术计划「接口」);count = 几张卡 / 包里几行
        count = len(d.get("cards", [])) if g.type == "bundle" else int(d.get("count") or 0)
        return {"key": g.key, "type": g.type, "name": g.name, "count": count, "owner": None, "duplicate_of": None, "detail": d}
    count = {
        "card": 1,
        "sprite_pack": len(g.files),
        "scene_pack": len(d.get("bg", [])) + len(d.get("bgm", [])),
        "cg_pack": len(d.get("compositions", [])),
    }[g.type]
    out = {"key": g.key, "type": g.type, "name": g.name, "count": count, "owner": g.owner, "duplicate_of": g.duplicate_of}
    if g.type == "scene_pack":
        out["bg_count"] = len(d.get("bg", []))
        out["bgm_count"] = len(d.get("bgm", []))
    if g.type == "cg_pack":
        out["variant_count"] = sum(len(c.get("variants") or []) for c in d.get("compositions", []))
    return out


@router.post("/plan")
def make_plan(
    files: list[UploadFile] = File(...),
    paths: str | None = Form(None),
    target_card_id: str | None = Form(None),
    kind: str | None = Form(None),
    db: Session = Depends(get_db),
):
    kind = (kind or "").strip() or None
    if kind in NOT_DROPPABLE:
        raise HTTPException(400, f"「{NOT_DROPPABLE[kind]}」这一栏不能拖文件进来导入")
    if kind is not None and kind not in FORCED_KINDS:
        raise HTTPException(400, f"不认识的素材类型:{kind}")
    target = (target_card_id or "").strip() or None
    if target and db.get(TavernCard, target) is None:
        raise HTTPException(404, "角色卡不存在")
    names = _paths(paths, files)
    try:
        tree = staging.stage([(name, f.file) for name, f in zip(names, files)])
    except staging.TooLarge as e:
        raise HTTPException(413, str(e)) from e
    except staging.StagingError as e:
        raise HTTPException(400, str(e)) from e
    try:
        plan = build_plan(tree, db, target, kind)
        (tree.dir / PLAN_FILE).write_text(json.dumps(plan.to_dict(), ensure_ascii=False), "utf-8")
        (tree.dir / UPLOAD_FILE).write_text(json.dumps({"tops": _tops(names)}, ensure_ascii=False), "utf-8")
    except ValueError as e:
        staging.discard(tree.plan_id)
        raise HTTPException(400, str(e)) from e
    except BaseException:
        staging.discard(tree.plan_id)
        raise
    return {
        "plan_id": plan.id,
        "groups": [_group_out(g) for g in plan.groups],
        "unknown": plan.unknown,
        "skipped": plan.skipped,
        # 拖到某张卡上、或者有和库里一样的,先弹确认框
        # 角色包要给人看作者的说明、选要不要预设,也先弹
        "needs_confirm": bool(plan.target_card_id)
        or any(g.duplicate_of for g in plan.groups)
        or any(g.type == "bundle" for g in plan.groups)
        # 声音包要选挂到哪个语音服务、看「模型会执行代码」的提醒
        or any(g.type == "pack_file" and g.detail.get("kind") == "voice" for g in plan.groups),
    }


@router.delete("/{plan_id}", status_code=204)
def discard_plan(plan_id: str, db: Session = Depends(get_db)):
    """确认框点了「取消」:暂存的文件马上删掉,不等 7 天(一整个角色文件夹能有几百 MB)。执行过的计划不能这样删,
    它的暂存里还留着没认出来的文件,要撤销请走导入记录"""
    if not staging.PLAN_ID.match(plan_id):
        raise HTTPException(404, "没有这个导入计划")
    if db.get(ImportJob, plan_id) is not None:
        raise HTTPException(409, "这次导入已经执行过了;要撤销,请在素材管理的导入记录里撤销")
    _open(plan_id)
    staging.discard(plan_id)


def _open(plan_id: str) -> staging.StagedTree:
    try:
        return staging.open_tree(plan_id)
    except staging.StagingError as e:
        raise HTTPException(404, str(e)) from e


def _failed(db: Session, e: Exception) -> HTTPException:
    db.rollback()
    log.exception("导入失败")
    return HTTPException(500, f"导入失败,库里什么都没改(拖进来的文件还在,可以再试一次):{e}")


@router.post("/{plan_id}/apply")
def apply_import(plan_id: str, req: ImportApplyIn | None = None, db: Session = Depends(get_db)):
    req = req or ImportApplyIn()
    if not staging.PLAN_ID.match(plan_id):
        raise HTTPException(404, "没有这个导入计划")
    if db.get(ImportJob, plan_id) is not None:
        raise HTTPException(409, "这次导入已经执行过了;要再导一次,请重新拖进来")
    tree = _open(plan_id)
    try:
        plan = ImportPlan.from_dict(json.loads((tree.dir / PLAN_FILE).read_text("utf-8")))
    except (OSError, ValueError, TypeError, KeyError) as e:
        raise HTTPException(404, "这次导入的计划不在了,请重新拖进来") from e
    try:
        tops = json.loads((tree.dir / UPLOAD_FILE).read_text("utf-8")).get("tops", [])
    except (OSError, ValueError, AttributeError):
        tops = []
    try:
        job = apply_plan(db, tree, plan, tops, req.decisions, req.classify, req.make_current, req.options)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        raise _failed(db, e) from e
    db.refresh(job)
    jobs.prune_staging(tree, list(job.unknown or []))
    return result_of(job)


@router.get("/{plan_id}/file")
def staged_file(plan_id: str, path: str, w: int | None = Query(None, ge=MIN_WIDTH, le=MAX_WIDTH)):
    """暂存目录里的一个文件(角色包的预览图、包的缩略图)。只许取这次导入暂存目录里的;路径不安全、不在都是 404"""
    tree = _open(plan_id)
    try:
        file = tree.path(path)
    except staging.StagingError as e:
        raise HTTPException(404, "没有这个文件") from e
    if not file.is_file():
        raise HTTPException(404, "没有这个文件")
    with open(file, "rb") as f:
        mime = sniff_image_mime(f.read(64))
    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"}
    if w and mime:
        small = shrink_image(file.read_bytes(), w)
        if small:
            return Response(content=small, media_type="image/webp", headers=headers)
    return FileResponse(file, media_type=mime or "application/octet-stream", headers=headers)


@router.get("/jobs")
def list_import_jobs(db: Session = Depends(get_db)):
    return jobs.list_jobs(db)


@router.post("/jobs/{job_id}/classify")
def classify_leftover(job_id: str, req: ImportClassifyIn, db: Session = Depends(get_db)):
    job = jobs.load_job(db, job_id)
    jobs.must_be_live(job)
    if req.path not in (job.unknown or []):
        raise HTTPException(400, f"「{req.path}」不在没认出来的文件里")
    if req.kind not in CLASSIFY_KINDS:
        raise HTTPException(400, f"不认识的类型:{req.kind}(只能是立绘 / 背景 / BGM / CG,或者不要)")
    try:
        tree = staging.open_tree(job_id)
    except staging.StagingError as e:
        raise HTTPException(404, "这个文件的暂存已经清掉了(超过 7 天),请重新拖进来") from e
    try:
        jobs.classify_file(db, tree, job, req.path, req.kind)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        raise _failed(db, e) from e
    db.refresh(job)
    jobs.prune_staging(tree, list(job.unknown or []))
    return result_of(job)


@router.get("/jobs/{job_id}/undo-preview")
def undo_preview(job_id: str, db: Session = Depends(get_db)):
    job = jobs.load_job(db, job_id)
    jobs.must_be_live(job)
    return jobs.describe(db, job)


@router.post("/jobs/{job_id}/undo")
def undo_import(job_id: str, db: Session = Depends(get_db)):
    job = jobs.load_job(db, job_id)
    jobs.must_be_live(job)
    try:
        out = jobs.undo(db, job)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log.exception("撤销导入失败")
        raise HTTPException(500, f"撤销失败,库里什么都没改:{e}") from e
    try:
        staging.discard(job_id)
    except Exception:  # 暂存删不掉也无妨,过 7 天会清
        pass
    return out
