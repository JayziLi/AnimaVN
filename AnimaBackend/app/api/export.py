"""导出角色包 / 单包(素材架构第 3 步;技术计划「接口」)。

- GET  /api/export/bundle/{card_id}/summary  导出面板:会带上什么、各多大、预览图候选、不带什么
- POST /api/export/bundle/{card_id}          {exclude, preset, note, preview, compress_images} → .animavn 文件
- GET  /api/export/pack/{kind}/{pack_id}[?compress=1]  kind = sprite / scene / cg / voice → .animapack 文件(compress=1:图片转 WebP)

- POST /api/export/voice/{voice_id}/pull    把声音还在语音机上的文件拉回文件仓库(导出框里点「拉回来」)

带声音的:导出不去语音机,仓库里没有的文件只带设置;要带文件先点「拉回来」。

文件先写进 data/export-tmp/,发完删。文件名用卡名 / 包名(Content-Disposition 带 filename*=UTF-8''…)。
"""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.bundle import collect, write
from app.db import get_db
from app.models import VoiceProfile
from app.tts.files import prefetch_voice_files

router = APIRouter(prefix="/api/export", tags=["export"])
log = logging.getLogger(__name__)


class ExportBundleIn(BaseModel):
    exclude: list[str] = []
    preset: bool = True
    note: str = Field("", max_length=collect.NOTE_MAX)
    preview: dict | None = None
    compress_images: bool = True


def _disposition(name: str) -> str:
    ascii_name = name.encode("ascii", "replace").decode("ascii").replace("?", "_").replace('"', "_")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"


def _send(archive: collect.Archive) -> FileResponse:
    try:
        path = write.write_temp(archive)
    except write.MissingFile as e:
        log.exception("导出失败")
        raise HTTPException(500, f"导出失败:{e}") from e
    return FileResponse(
        path,
        media_type="application/zip",
        headers={"Content-Disposition": _disposition(archive.file_name)},
        background=BackgroundTask(Path.unlink, path, missing_ok=True),
    )


@router.get("/bundle/{card_id}/summary")
def bundle_summary(card_id: str, db: Session = Depends(get_db)):
    try:
        return collect.summary(db, card_id)
    except collect.NotFound as e:
        raise HTTPException(404, str(e)) from e


@router.post("/bundle/{card_id}")
def export_bundle(card_id: str, req: ExportBundleIn | None = None, db: Session = Depends(get_db)):
    req = req or ExportBundleIn()
    try:
        bundle = collect.collect_card(db, card_id, req.exclude, req.preset, req.note, req.preview, req.compress_images)
    except collect.NotFound as e:
        raise HTTPException(404, str(e)) from e
    return _send(bundle)


@router.get("/pack/{kind}/{pack_id}")
def export_pack(kind: str, pack_id: str, compress: int = 0, db: Session = Depends(get_db)):
    try:
        pack = collect.collect_pack(db, kind, pack_id, compress_images=bool(compress))
    except collect.NotFound as e:
        raise HTTPException(404, str(e)) from e
    return _send(pack)


@router.post("/voice/{voice_id}/pull")
async def pull_voice(voice_id: str, db: Session = Depends(get_db)):
    """把这个声音还在语音机上的文件拉回文件仓库(导出框里点「拉回来」,要等一会儿)"""
    if db.get(VoiceProfile, voice_id) is None:
        raise HTTPException(404, "声音不存在")
    missing = await prefetch_voice_files(db, [voice_id])
    return {"missing": missing[voice_id]}
