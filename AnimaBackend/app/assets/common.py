"""立绘、场景包、声音共用的校验:AI 要在标签里点名的名字,和上传的图片;还有给新包挑一个没用过的名字。

原来写在 app/api/sprites.py 里,场景包和声音从那里 import;现在放这里,三处都从这里取。
sprites.py 留着同名导出,外面的脚本 from app.api.sprites import ... 照旧能用。
"""

import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.contracts import LABEL_FORBIDDEN, LABEL_MAX

# 一张立绘 / 背景 / CG 撑死几 MB;nginx 那边的上限是 20m,这里再收紧一点
MAX_IMAGE_BYTES = 8 * 1024 * 1024
# 包名的长度上限(同各 router 的 _clean_pack_name)
PACK_NAME_MAX = 120

# 名字的长度上限 LABEL_MAX 和不许用的字符都在 app/contracts.py,前后端共用。
# 表情名会被塞进用户自定义的标签模板里(比如 <sprite:{表情}>、【{表情}】),
# 名字里带这些括号,解析器就分不清标签在哪里结束了
_FORBIDDEN = re.compile("[" + re.escape(LABEL_FORBIDDEN) + "]")


def clean_label(raw: str, noun: str = "表情名") -> str:
    """AI 要在标签里点名的名字:去空白,查长度和括号。立绘表情名、场景包的素材名、声音名、情绪名都走这里。"""
    name = raw.strip()
    if not name:
        raise HTTPException(400, f"{noun}不能为空")
    if len(name) > LABEL_MAX:
        raise HTTPException(400, f"{noun}最长 {LABEL_MAX} 个字")
    if _FORBIDDEN.search(name):
        raise HTTPException(400, f"{noun}「{name}」里不能有换行或 <>[]{{}}【】「」 这些括号")
    return name


def clean_aliases(raw: list[str], label: str, noun: str = "表情名") -> list[str]:
    out: list[str] = []
    seen = {label.casefold()}
    for a in raw:
        if not a.strip():
            continue
        name = clean_label(a, noun)
        if name.casefold() in seen:
            continue
        seen.add(name.casefold())
        out.append(name)
    return out


def sniff_image_mime(data: bytes) -> str | None:
    """按文件头认格式,不信任上传时声明的 content-type。

    这些图和页面同源,如果按客户端声明的类型原样返回,就有人能传一个 HTML
    当「图片」,借同源执行脚本。
    """
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def unique_pack_name(db: Session, model, base: str) -> str:
    """库里这一种包没用过的名字:X、X 2、X 3…(不分大小写;新建的包 flush 过才算)。
    导入建包(app/importer/apply.py)、复制包(「X 副本」)共用"""
    root = base.strip()[:PACK_NAME_MAX].strip() or "未命名"
    taken = {n.casefold() for n in db.scalars(select(model.name)).all()}
    name, n = root, 2
    while name.casefold() in taken:
        suffix = f" {n}"
        name = root[: PACK_NAME_MAX - len(suffix)].rstrip() + suffix
        n += 1
    return name
