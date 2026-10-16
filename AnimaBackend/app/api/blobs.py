"""文件仓库里的文件按指纹出(素材架构第 3 期):/api/blobs/<sha>。

立绘、背景、CG、曲子有了指纹以后,前端都用这个地址(lib/api.ts 的 spriteImageUrl / sceneFileUrl):
同一张图挂在几个包里也只下一次;内容不变地址就不变,可以放心缓存一年。
只出 blobs 表里登记过的(复制任务还没登记的,按引用它的那一行认类型);图片带 ?w= 时缩成 WebP(同 app/images.py);别的直接发文件,支持 Range(曲子能拖进度)。
文件不在(还没复制完、被误删)或者开关 storage_files 关着时,从库里那份出。
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.images import MAX_WIDTH, MIN_WIDTH, shrink_image
from app.storage import refs
from app.storage.blobs import SHA_RE, store

router = APIRouter(prefix="/api/blobs", tags=["blobs"])

_HEADERS = {"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}


@router.get("/{sha}")
def get_blob(
    sha: str,
    request: Request,
    w: int | None = Query(None, ge=MIN_WIDTH, le=MAX_WIDTH),
    db: Session = Depends(get_db),
):
    blobs = store()
    mime = (blobs.mime_of(db, sha) or refs.mime_of(db, sha)) if SHA_RE.match(sha) else None
    if mime is None:
        raise HTTPException(404, "没有这个文件")
    shrink = bool(w) and mime.startswith("image/")
    etag = f'"{sha}.w{w}"' if shrink else f'"{sha}"'
    headers = {**_HEADERS, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    path = blobs.path(sha, mime)
    on_disk = settings.storage_files and path.is_file()
    if on_disk and not shrink:
        return FileResponse(path, media_type=mime, headers=headers)
    data = blobs.read(sha, mime) if on_disk else refs.find_bytes(db, sha)
    if data is None:
        raise HTTPException(404, "文件不在仓库里,库里也没有")
    small = shrink_image(data, w) if shrink and w else None
    return Response(content=small or data, media_type="image/webp" if small else mime, headers=headers)
