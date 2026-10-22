"""哪些表的哪一列存着素材原件、对应的指纹记在哪一列。

复制(copy.py)、出文件(read_bytes)、清理时找「谁还引用着」(clean.py)都照这张单子走。
内核登记立绘和场景素材;卡带在加载时(on_load)用 register() 登记自己存素材的表。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session, object_session

from app.config import settings
from app.models import CgAsset, PackSprite, SceneAsset
from app.storage.blobs import BlobStore, store


@dataclass(frozen=True)
class BlobRef:
    """model 这张表的 data 列存原件,sha 列记指纹;类型在 mime 列(没有这一列的用 fixed_mime)"""

    name: str
    model: type
    data: str
    sha: str
    mime: str | None = None
    fixed_mime: str | None = None

    @property
    def data_col(self) -> InstrumentedAttribute:
        return getattr(self.model, self.data)

    @property
    def sha_col(self) -> InstrumentedAttribute:
        return getattr(self.model, self.sha)

    def mime_of(self, row) -> str | None:
        return getattr(row, self.mime) if self.mime else self.fixed_mime


SPRITE = BlobRef("立绘", PackSprite, "image", "image_sha", mime="mime")
SCENE_ASSET = BlobRef("场景素材", SceneAsset, "data", "data_sha", mime="mime")
# 迁过来的 CG 库里不存原件(还在 scene_assets 那一行),按指纹找;排在场景素材后面,复制任务先把那边的文件放好
CG_ASSET = BlobRef("CG", CgAsset, "data", "data_sha", mime="mime")
CORE_REFS: tuple[BlobRef, ...] = (SPRITE, SCENE_ASSET, CG_ASSET)

_extra: list[BlobRef] = []


def register(ref: BlobRef) -> None:
    """卡带加载时登记自己的表;同名的登记一次就够"""
    if all(r.name != ref.name for r in _extra):
        _extra.append(ref)


def all_refs() -> tuple[BlobRef, ...]:
    return (*CORE_REFS, *_extra)


@dataclass(frozen=True)
class ShaCol:
    """只记指纹、库里从来不存原件的一列(声音包的参考音频和模型,第 4 步):清理时照样算「有人用」
    (app/storage/maintenance.py 的 shas_in)。many = 这一列是指纹的 JSON 列表(辅助参考),里面的 null 不算"""

    name: str
    table: str
    column: str
    many: bool = False


# 声音的文件:参考音频、辅助参考、音色参考、两个模型(app/models.py 的 voice_emotions / voice_profiles)
VOICE_SHAS: tuple[ShaCol, ...] = (
    ShaCol("声音参考", "voice_emotions", "ref_sha"),
    ShaCol("声音辅助参考", "voice_emotions", "aux_shas", many=True),
    ShaCol("声音音色参考", "voice_profiles", "speaker_sha"),
    ShaCol("声音 GPT 模型", "voice_profiles", "gpt_sha"),
    ShaCol("声音 SoVITS 模型", "voice_profiles", "sovits_sha"),
)


def sha_cols() -> tuple[ShaCol, ...]:
    return VOICE_SHAS


def has_content(ref: BlobRef):
    """查询条件:这一行有原件(库里有,或者已经在仓库里)"""
    return or_(ref.data_col.is_not(None), ref.sha_col.is_not(None))


def find_bytes(db: Session, sha: str) -> bytes | None:
    """按指纹在库里找一份原件(/api/blobs 文件不在时用):随便哪张表、哪一行,内容都一样"""
    for ref in all_refs():
        data = db.scalar(select(ref.data_col).where(ref.sha_col == sha, ref.data_col.is_not(None)).limit(1))
        if data is not None:
            return data
    return None


def mime_of(db: Session, sha: str) -> str | None:
    """按指纹找到引用它的一行,用它的类型(复制任务还没登记进 blobs 表时 /api/blobs 用)"""
    for ref in all_refs():
        if ref.mime:
            mime = db.scalar(select(getattr(ref.model, ref.mime)).where(ref.sha_col == sha).limit(1))
        else:
            mime = ref.fixed_mime if db.scalar(select(ref.model.id).where(ref.sha_col == sha).limit(1)) else None
        if mime:
            return mime
    return None


def read_bytes(ref: BlobRef, row, db: Session | None = None, blobs: BlobStore | None = None) -> bytes | None:
    """这一行的原件:有指纹、文件也在时从仓库读(开关 storage_files 关着时不读);不然读库里的那份。
    库里那列是 deferred 的,只有退回读库时才真去取"""
    sha = getattr(row, ref.sha)
    mime = ref.mime_of(row)
    if settings.storage_files and sha and mime:
        data = (blobs or store()).read(sha, mime)
        if data is not None:
            return data
    data = getattr(row, ref.data)
    if data is None and sha:
        # 这一行库里没存原件(比如迁到 CG 包的 CG):同一个指纹在别的表里有一份
        session = db or object_session(row)
        if session is not None:
            data = find_bytes(session, sha)
    return data


def save(ref: BlobRef, row, data: bytes, mime: str, db: Session, blobs: BlobStore | None = None) -> None:
    """写进新的原件:仓库里放一份、记下指纹。
    开关 storage_files 开着时库里的原件列置空(瘦身以后库里全是空的,新上传再写进去库又会变大;
    换图时也顺手清掉这一行瘦身前留着的旧原件,免得指纹和原件对不上);关着时照旧库里也存一份"""
    setattr(row, ref.sha, (blobs or store()).put(data, mime, db))
    setattr(row, ref.data, None if settings.storage_files else data)


def copy_content(ref: BlobRef, src, dst, db: Session, blobs: BlobStore | None = None) -> None:
    """复制一行素材时带上它的原件(复制包用):有指纹就只抄指纹 —— 文件按内容存,几个包共用一份,不多占地方;
    还没复制进仓库(指纹空着、原件只在库里)的照 save 放进仓库、记上指纹。没有原件的什么都不做。类型列由调用方抄"""
    sha = getattr(src, ref.sha)
    if sha:
        setattr(dst, ref.sha, sha)
        return
    data = getattr(src, ref.data)
    mime = ref.mime_of(src)
    if data is not None and mime:
        save(ref, dst, data, mime, db, blobs)
