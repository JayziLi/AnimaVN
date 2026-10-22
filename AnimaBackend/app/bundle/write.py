"""把 collect.py 收好的东西写成 zip(.animavn / .animapack)。

JSON 按收的顺序写(清单在最前)、压缩;图片音频本来就压过,原样存(ZIP_STORED)。原件一个一个读、写完就放掉,
不把整个包攒在内存里。接口写到临时目录(data/export-tmp/),发完删(app/api/export.py)。
"""

from __future__ import annotations

import json
import uuid
import zipfile
from pathlib import Path

from sqlalchemy.engine import make_url

from app.bundle.collect import Archive
from app.config import settings

# 测试里换成临时目录;None = 库文件旁边的 export-tmp/(同 import-staging/)
TMP_DIR: Path | None = None


class MissingFile(RuntimeError):
    """要放的文件读不出来(仓库里没有、库里也没有)"""


def tmp_dir() -> Path:
    if TMP_DIR is not None:
        return Path(TMP_DIR)
    url = make_url(settings.database_url)
    if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
        return Path(url.database).parent / "export-tmp"
    return Path(__file__).resolve().parents[2] / "data" / "export-tmp"


def write_zip(archive: Archive, path: Path) -> int:
    """写到 path,返回文件大小。读不出某个文件时抛 MissingFile,写了一半的文件删掉"""
    path = Path(path)
    try:
        with zipfile.ZipFile(path, "w", allowZip64=True) as zf:
            for name, obj in archive.jsons.items():
                data = json.dumps(obj, ensure_ascii=False, indent=1).encode("utf-8")
                zf.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
            for name, src in archive.files.items():
                if src.disk is not None and Path(src.disk).is_file():
                    # 仓库里的大文件(声音的模型):按块从硬盘拷进 zip
                    zf.write(src.disk, name, compress_type=zipfile.ZIP_STORED)
                    continue
                data = src.load()
                if data is None:
                    raise MissingFile(f"文件 {src.sha} 读不出来(仓库里没有,库里也没有)")
                zf.writestr(name, data, compress_type=zipfile.ZIP_STORED)
                del data
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path.stat().st_size


def write_temp(archive: Archive) -> Path:
    """写到临时目录里的一个新文件,返回路径(调用方发完删)"""
    folder = tmp_dir()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex}.zip"
    write_zip(archive, path)
    return path
