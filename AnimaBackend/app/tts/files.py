"""声音的文件(素材架构第 4 步「声音包」):每个声音用到哪些文件、哪些已经在文件仓库里,导出前把缺的拉回来。

一个声音的文件:每行情绪的参考音频、辅助参考、音色参考(IndexTTS)、GPT / SoVITS 两个模型。库里存的是语音机上的路径
(以前的声音都是手填的),指纹列记「现在这个路径上的文件」在仓库里的指纹(路径改了就清掉,app/api/voices.py)。

    missing = await prefetch_voice_files(db, ["<声音编号>"])   # {声音编号: 拿不到的文件数}

- 仓库里按指纹已经有的不再拉;没有的经语音机上的只读口(/anima/ref,engine.download)拉回来,流式写进仓库,存成带扩展名的
  文件(.wav / .ckpt / .pth),记下指纹(模型再记大小和原文件名)。同一个路径只拉一次,同时最多 4 个,单个 60 秒。
- 拉不到的(语音机关着、旧版脚本没有只读口、路径不让读)算缺的:不报错,导出时那个文件写 null。
- 导出不带的情绪行(由卡带登记过滤)不拉。
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Blob, TtsConnection, VoiceEmotion, VoiceProfile
from app.storage.blobs import BlobStore, mime_for_name, store
from app.tts.base import TTSError

log = logging.getLogger(__name__)

CONCURRENCY = 4
INCOMING = ".incoming"

# ── 导出不带的情绪行(卡带登记;内核不认识它们) ──

_row_filters: list[Callable[[VoiceEmotion], bool]] = []


def register_row_filter(fn: Callable[[VoiceEmotion], bool]) -> None:
    """卡带加载时登记:fn(行) 为 True 的情绪行不进声音包(也不为它拉文件)。同一个函数登记几次也只算一次"""
    if fn not in _row_filters:
        _row_filters.append(fn)


def exported_emotions(db: Session, profile_id: str) -> list[VoiceEmotion]:
    """这个声音要进声音包的情绪行,按情绪表的顺序(排第一的是默认)"""
    rows = db.scalars(
        select(VoiceEmotion).where(VoiceEmotion.profile_id == profile_id).order_by(VoiceEmotion.sort, VoiceEmotion.created_at)
    ).all()
    return [e for e in rows if not any(f(e) for f in _row_filters)]


# ── 一个声音的文件 ──


def basename(path: str) -> str:
    return path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]


@dataclass
class Slot:
    """声音用到的一个文件。kind:ref 参考 / aux 辅助参考 / speaker 音色参考 / gpt / sovits"""

    kind: str
    row: VoiceProfile | VoiceEmotion
    path: str
    sha: str | None
    index: int = 0  # aux 的第几条

    @property
    def name(self) -> str:
        """原文件名:模型用记下的名字,没记过的取路径的最后一段"""
        if self.kind in ("gpt", "sovits"):
            return getattr(self.row, f"{self.kind}_name") or basename(self.path)
        return basename(self.path)

    def set_sha(self, sha: str, size: int) -> None:
        if self.kind == "ref":
            self.row.ref_sha = sha
        elif self.kind == "aux":
            shas = list(self.row.aux_shas or [])
            shas += [None] * (self.index + 1 - len(shas))
            shas[self.index] = sha
            self.row.aux_shas = shas  # JSON 列要整个换掉
        elif self.kind == "speaker":
            self.row.speaker_sha = sha
        else:
            setattr(self.row, f"{self.kind}_sha", sha)
            setattr(self.row, f"{self.kind}_size", size)
            if not getattr(self.row, f"{self.kind}_name"):
                setattr(self.row, f"{self.kind}_name", basename(self.path))


def slots_of(db: Session, profile: VoiceProfile, emotions: list[VoiceEmotion] | None = None) -> list[Slot]:
    """这个声音用到的文件(要进包的情绪行;路径和指纹都空的不算)"""
    out: list[Slot] = []
    for kind, path_attr in (("gpt", "gpt_weights"), ("sovits", "sovits_weights"), ("speaker", "ref_path")):
        path = getattr(profile, path_attr) or ""
        sha = getattr(profile, f"{kind}_sha")
        if path or sha:
            out.append(Slot(kind, profile, path, sha))
    for e in exported_emotions(db, profile.id) if emotions is None else emotions:
        if e.ref_path or e.ref_sha:
            out.append(Slot("ref", e, e.ref_path or "", e.ref_sha))
        # 导进来、还没放到语音机上的声音(pending)辅助参考只有指纹、没有路径
        paths, shas = list(e.aux_refs or []), list(e.aux_shas or [])
        for i in range(max(len(paths), len(shas))):
            path = paths[i] if i < len(paths) else ""
            sha = shas[i] if i < len(shas) else None
            if path or sha:
                out.append(Slot("aux", e, path, sha, i))
    return out


def mime_of(db: Session, slot: Slot) -> str:
    """存进仓库时的类型:仓库里登记过就照登记的,不然按扩展名(模型按种类,GSV 认扩展名)"""
    if slot.sha:
        mime = db.scalar(select(Blob.mime).where(Blob.sha == slot.sha))
        if mime:
            return mime
    if slot.kind in ("gpt", "sovits") and not slot.path:
        return mime_for_name(slot.name or (".ckpt" if slot.kind == "gpt" else ".pth"))
    guess = mime_for_name(slot.path or slot.name)
    if guess == "application/octet-stream" and slot.kind in ("gpt", "sovits"):
        return mime_for_name(".ckpt" if slot.kind == "gpt" else ".pth")
    return guess


def file_of(db: Session, slot: Slot, blobs: BlobStore | None = None) -> Path | None:
    """这个文件在仓库里的位置;不在仓库里是 None"""
    if not slot.sha:
        return None
    path = (blobs or store()).path(slot.sha, mime_of(db, slot))
    return path if path.is_file() else None


def file_key(slot: Slot) -> str:
    """一个声音里「同一个文件」的认法:有路径按路径,没有按指纹(导入的声音放到别的电脑以前没有路径)"""
    return slot.path or f"sha:{slot.sha}"


def missing_count(db: Session, profile: VoiceProfile, blobs: BlobStore | None = None) -> int:
    """这个声音有几个文件(同一个路径算一个)现在仓库里没有"""
    blobs = blobs or store()
    have, want = set(), set()
    for s in slots_of(db, profile):
        want.add(file_key(s))
        if file_of(db, s, blobs) is not None:
            have.add(file_key(s))
    return len(want - have)


# ── 放到另一台电脑(files.zip、placed)──

_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
PROMPT_IN_NAME = 60


def _safe(name: str) -> str:
    return _UNSAFE.sub("_", name).strip(" .")


def placement(db: Session, profile: VoiceProfile) -> list[tuple[Slot, str, Path]]:
    """仓库里有的那几个文件放到语音机上叫什么:[(文件, zip 里 / 目录里的相对路径, 仓库里的文件)]。
    模型 models/<原文件名>;参考 refs/【情绪】原文.<扩展名>(和语音机上的命名一样);辅助参考、音色参考 refs/aux_<指纹前 12 位>。
    同一个文件只放一份,名字撞了接指纹前 8 位"""
    blobs = store()
    out: list[tuple[Slot, str, Path]] = []
    by_sha: dict[str, str] = {}
    taken: set[str] = set()
    for slot in slots_of(db, profile):
        disk = file_of(db, slot, blobs)
        if disk is None:
            continue
        if slot.sha in by_sha:
            out.append((slot, by_sha[slot.sha], disk))
            continue
        ext = disk.suffix
        if slot.kind in ("gpt", "sovits"):
            name = "models/" + (_safe(slot.name) or f"{slot.kind}{ext}")
        elif slot.kind == "ref":
            text = _safe(slot.row.prompt_text)[:PROMPT_IN_NAME]
            name = f"refs/【{_safe(slot.row.label)}】{text}{ext}"
        else:
            name = f"refs/{'aux' if slot.kind == 'aux' else 'speaker'}_{slot.sha[:12]}{ext}"
        if name.casefold() in taken:
            stem, dot, tail = name.rpartition(".")
            name = f"{stem}_{slot.sha[:8]}{dot}{tail}" if dot else f"{name}_{slot.sha[:8]}"
        taken.add(name.casefold())
        by_sha[slot.sha] = name
        out.append((slot, name, disk))
    return out


def place(db: Session, profile: VoiceProfile, folder: str) -> None:
    """文件已经照 placement 放到语音机上的 folder 里了:把这些文件的路径改成那边的,声音算手填的(manual)。指纹留着"""
    for slot, name, _ in placement(db, profile):
        path = f"{folder}/{name}"
        if slot.kind == "ref":
            slot.row.ref_path = path
        elif slot.kind == "aux":
            paths = list(slot.row.aux_refs or [])
            paths += [""] * (slot.index + 1 - len(paths))
            paths[slot.index] = path
            slot.row.aux_refs = paths
        elif slot.kind == "speaker":
            slot.row.ref_path = path
        else:
            setattr(slot.row, "gpt_weights" if slot.kind == "gpt" else "sovits_weights", path)
    profile.files_at = "manual"


# ── 拉文件 ──


async def prefetch_voice_files(db: Session, voice_ids: list[str], *, concurrency: int = CONCURRENCY) -> dict[str, int]:
    """把这几个声音缺的文件拉进仓库,记下指纹(提交);返回 {声音编号: 还拿不到的文件数}。不在的声音不出现在结果里"""
    from app.tts.registry import engine_for  # registry 引了引擎,引擎引了这里没有;放这里免得以后绕成圈

    blobs = store()
    profiles = [p for vid in dict.fromkeys(voice_ids) if (p := db.get(VoiceProfile, vid)) is not None]
    # (连接, 路径) → 要这个文件的几处
    wanted: dict[tuple[str, str], list[Slot]] = {}
    conns: dict[str, TtsConnection] = {}
    for p in profiles:
        conn = db.get(TtsConnection, p.connection_id)
        for s in slots_of(db, p):
            if file_of(db, s, blobs) is not None or not s.path or conn is None:
                continue
            conns[conn.id] = conn
            wanted.setdefault((conn.id, s.path), []).append(s)

    dead: set[str] = set()
    for cid, conn in conns.items():
        try:
            await engine_for(conn).ping()
        except TTSError as e:
            log.info("拉声音文件:语音服务「%s」连不上(%s),这次只带设置", conn.name, e.message)
            dead.add(cid)

    sem = asyncio.Semaphore(max(1, concurrency))
    incoming = blobs.root / INCOMING
    incoming.mkdir(parents=True, exist_ok=True)

    async def one(cid: str, path: str, mime: str) -> tuple[str, str, int] | None:
        async with sem:
            if cid in dead:
                return None
            tmp = incoming / f"{uuid.uuid4().hex}.part"
            try:
                size = await engine_for(conns[cid]).download(path, tmp)
            except TTSError as e:
                if e.status in (501, 503, 504):  # 旧版脚本没有只读口、连不上:这台的别的文件也别试了
                    dead.add(cid)
                log.info("拉声音文件失败:%s(%s)", path, e.message)
                tmp.unlink(missing_ok=True)
                return None
            try:
                sha = await asyncio.to_thread(blobs.put_path, tmp, mime, None, move=True)
            except OSError:
                log.exception("拉回来的声音文件放不进仓库:%s", path)
                tmp.unlink(missing_ok=True)
                return None
            return sha, mime, size

    keys = list(wanted)
    results = await asyncio.gather(*(one(cid, path, mime_of(db, wanted[(cid, path)][0])) for cid, path in keys))
    for key, got in zip(keys, results):
        if got is None:
            continue
        sha, mime, size = got
        if db.get(Blob, sha) is None and not any(isinstance(o, Blob) and o.sha == sha for o in db.new):
            db.add(Blob(sha=sha, mime=mime, size=size))
        for s in wanted[key]:
            s.set_sha(sha, size)
    db.commit()
    return {p.id: missing_count(db, p, blobs) for p in profiles}
