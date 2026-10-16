"""生图卡带(BETA,设计 docs/superpowers/specs/2026-10-11-novelai-image-gen-design.md):
视觉小说里点「画」或者自动出图时,指导模型读剧情写画面,NovelAI 画出来,显示在 CG 层上。

nai.py 发 NovelAI 请求,assemble.py 把画面 + 画风 + 外貌拼成提示词,writer.py 是指导模型(说明书、解析它回的 JSON),
models.py 存画出来的图(文件在文件仓库里,这里登记引用),api.py 是 /api/imagegen。
前端在 frontend/src/debug/plugins/imagegen/。公开版带着这个卡带;只在私有版里的几段夹在 @private-begin / @private-end 之间,
生成公开版时由 publish/make_public.py 删掉。
"""

from __future__ import annotations

from app.plugins import Cartridge
from app.plugins.imagegen.api import router
from app.plugins.imagegen.models import IMAGE_REF, UPLOAD_REF
from app.storage import refs


def _load() -> None:
    refs.register(IMAGE_REF)
    refs.register(UPLOAD_REF)


CARTRIDGE = Cartridge(id="imagegen", routers=[router], on_load=_load)
