"""导出角色包 / 单包(素材架构第 3 步;技术计划「接口」)。

- GET  /api/export/bundle/{card_id}/summary  导出面板:会带上什么、各多大、预览图候选、不带什么
- POST /api/export/bundle/{card_id}          {exclude, preset, note, preview} → .animavn 文件
- GET  /api/export/pack/{kind}/{pack_id}     kind = sprite / scene / cg / voice → .animapack 文件

带声音的(第 4 步):先把声音缺的文件从语音机拉进文件仓库(app/tts/files.py;同步等着拉完,拉不到的只带设置),再收。

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
from app.tts.files import prefetch_voice_files

router = APIRouter(prefix="/api/export", tags=["export"])
log = logging.getLogger(__name__)


class ExportBundleIn(BaseModel):
    exclude: list[str] = []
    preset: bool = True
    note: str = Field("", max_length=collect.NOTE_MAX)
    preview: dict | None = None


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


async def _prefetch_card(db: Session, card_id: str, exclude: list[str]) -> None:
    try:
        voices = collect.voice_ids_of_card(db, card_id, exclude)
    except collect.NotFound as e:
        raise HTTPException(404, str(e)) from e
    if voices:
        await prefetch_voice_files(db, voices)


@router.get("/bundle/{card_id}/summary")
async def bundle_summary(card_id: str, db: Session = Depends(get_db)):
    await _prefetch_card(db, card_id, [])
    try:
        return collect.summary(db, card_id)
    except collect.NotFound as e:
        raise HTTPException(404, str(e)) from e


@router.post("/bundle/{card_id}")
async def export_bundle(card_id: str, req: ExportBundleIn | None = None, db: Session = Depends(get_db)):
    req = req or ExportBundleIn()
    await _prefetch_card(db, card_id, req.exclude)
    try:
        bundle = collect.collect_card(db, card_id, req.exclude, req.preset, req.note, req.preview)
    except collect.NotFound as e:
        raise HTTPException(404, str(e)) from e
    return _send(bundle)


@router.get("/pack/{kind}/{pack_id}")
async def export_pack(kind: str, pack_id: str, db: Session = Depends(get_db)):
    if kind == "voice":
        await prefetch_voice_files(db, [pack_id])
    try:
        pack = collect.collect_pack(db, kind, pack_id)
    except collect.NotFound as e:
        raise HTTPException(404, str(e)) from e
    return _send(pack)
