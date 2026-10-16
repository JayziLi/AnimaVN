"""生图卡带的表。卡带被加载(import)时定义好,启动时的 create_all 才看得见;公开版删了卡带,这张表就不建。"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models import _now, _uuid
from app.storage.refs import BlobRef


class GeneratedImage(Base):
    """画出来的一张图(包括「换一张」换掉的):图本身在文件仓库里(data_sha),库里不存原件,data 列一直是空的。
    显示在哪一句记在消息上(swipe_info[分支].vn.images),这里的 chat_id / entry_id / swipe / line 只记当时是在哪画的,
    相册和排查用。kept_asset_id:收藏进 CG 包以后那张 CG 的编号"""

    __tablename__ = "generated_images"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    card_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    chat_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    entry_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    swipe: Mapped[int | None] = mapped_column(Integer, nullable=True)
    line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # manual 玩家点按钮 / auto 自动出图 / reroll 换一张
    trigger: Mapped[str] = mapped_column(String(16), default="manual")
    # 四到八个字的短名字(指导模型起的,收藏进 CG 包时当 CG 的名字)和一句中文说明
    title: Mapped[str] = mapped_column(String(40), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    # 指导模型回的那份(场景、每个人的动作表情);换一张时照它再拼一遍
    plan: Mapped[dict] = mapped_column(JSON, default=dict)
    # 最后发给 NovelAI 的:主提示词、反向、分角色提示词 [{prompt, negative, x, y}]
    prompt: Mapped[str] = mapped_column(Text, default="")
    negative: Mapped[str] = mapped_column(Text, default="")
    chars: Mapped[list] = mapped_column(JSON, default=list)
    # model / width / height / steps / scale / sampler / seed
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    mime: Mapped[str] = mapped_column(String(40), default="image/png")
    size: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    data_sha: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    kept_asset_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # NovelAI 往返几毫秒(不含指导模型)
    ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ImagegenRef(Base):
    """玩家上传的参考图(插件页「这张卡」→ 参考图 → 上传):图在文件仓库里,data 列一直是空的。
    卡的设置里只记它的编号;换掉以后前端删这一行"""

    __tablename__ = "imagegen_refs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    card_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    mime: Mapped[str] = mapped_column(String(40), default="image/png")
    size: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    data_sha: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# 文件清理只认登记过的列:不登记,只挂在消息上的图 24 小时后会被当成没人要的删掉
IMAGE_REF = BlobRef("生成的图", GeneratedImage, "data", "data_sha", mime="mime")
UPLOAD_REF = BlobRef("生图参考图", ImagegenRef, "data", "data_sha", mime="mime")
