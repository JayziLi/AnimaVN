"""从一张卡出发,收齐角色包(.animavn)要带的行和文件;单个包(.animapack)同理。只读库。

    bundle = collect_card(db, card_id, exclude=["sprite:<id>"], with_preset=True, note="…", preview={"kind": "avatar"})
    pack = collect_pack(db, "sprite", pack_id)
    summary(db, card_id)   # 导出面板用的那份(接口 GET /api/export/bundle/{card_id}/summary)

收的是纯数据:要写进 zip 的 JSON(jsons:zip 里的路径 → 对象)和要放的文件(files:assets/<sha>.<ext> → FileSrc,
按指纹只放一份;原件到写 zip 时才读)。格式见技术计划「格式(版本 1)」:
- key 就是库里原来的编号;行里存指纹的列换成 "file": "assets/<sha>.<ext>"(没有图的行是 null)。
- 包内、包间的引用(背景的默认曲、封面曲、CG 差分的构图)指向这次没导出的东西时写 null。
- 整组状态卡一起走(app/states.py 的 group_of);绑定读 app/bindings.py。
- 声音(第 4 步)也是一种包(kind = voice):设置、每行情绪的参考音频和原文、两个模型;文件要先在文件仓库里
  (导出接口先调 app/tts/files.py 的 prefetch_voice_files 从语音机拉),拿不到的写 null(模型只写名字和大小)。
  不写语音服务连接(导入时选);卡带登记的情绪行(声线分档)不带。
- 按卡设置只带 plugin.* 的键;生图卡带的 ref.id 指着导出的立绘就留着(导入时换编号),指着别的就去掉 ref。
- 配对表:CG 的(名单是导出的立绘包、target 是导出的 CG 构图)和声音的(名单是导出的立绘包,一套立绘都不带时是内置名单;
  target 是导出的声音),只给导出的卡(或共用)的。
- 认词记录:导出的立绘包的;一套立绘都不带时带内置名单(builtin)的。
- 预设:app_settings 的 preset.bindings 里主卡绑的那一套;同组绑了同一套的卡记进 preset.cards。
"""

from __future__ import annotations

import base64
import binascii
import copy
import json
import re
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings, cg_sync, states
from app.models import (
    AppSetting,
    Blob,
    CardPref,
    CardRole,
    CgAsset,
    CgPack,
    PackSprite,
    Pairing,
    PairingRow,
    PromptPreset,
    SceneAsset,
    ScenePack,
    SpritePack,
    SpritePackLayout,
    TavernCard,
    TtsConnection,
    VoiceProfile,
    WordRecord,
)
from app.storage import refs
from app.storage.blobs import ext_of, sha_of, store
from app.tts import files as voice_files

FORMAT_BUNDLE, FORMAT_PACK, VERSION = "animavn", "animapack", 1
MANIFEST, PACK_MANIFEST = "animavn.json", "pack.json"
PACK_KINDS = ("sprite", "scene", "cg", "voice")
PACK_PREFIX = "pack:"
BUILTIN = "builtin"
PLUGIN_PREFIX = "plugin."
IMAGEGEN_KEY = "plugin.imagegen"
PRESET_BINDINGS = "preset.bindings"
NOTE_MAX = 2000
THUMB_W = 256
MAX_SPRITE_PREVIEWS = 12
NOT_INCLUDED = ["人设", "对话记录", "你的 API key 和设置"]
# 声音的授权说明里写了这些才算能再分发;没写(以前的声音都没写)、写了别的都提醒「只给自己用」
SHARE_OK = re.compile(r"可以?再分发|可以?分享|可以?转发|redistribut|CC0|CC[- ]BY|MIT|Apache", re.I)
SHARE_NOT = re.compile(r"不可|不能|不许|禁止|勿|no[nt]?[- ]?redistribut|not? (?:be )?redistribut", re.I)
VOICE_WARN = "只给自己用,别发给别人"
# 卡 JSON 里 data 下的字段(CCv3;头像单独放 assets/,spec 写在外面)
CARD_FIELDS = (
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
    "system_prompt",
    "post_history_instructions",
    "creator_notes",
    "alternate_greetings",
    "tags",
    "creator",
    "character_version",
    "character_book",
    "extensions",
)
PRESET_FIELDS = ("name", "prompts", "prompt_order", "formats", "params", "squash_system_messages")
# 包里每一行都不带的列(编号换成 key、指纹换成 file、时间不带)
_SKIP = {"id", "pack_id", "created_at", "updated_at"}
_DATA_URL = re.compile(r"^data:([\w.+-]+/[\w.+-]+)(?:;[^,;]*)*;base64,(.*)$", re.S)
_UNSAFE_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class NotFound(LookupError):
    """卡、包不在;消息是给人看的中文"""


@dataclass
class FileSrc:
    """要放进 zip 的一个文件:按指纹放在 assets/ 下,原件到写的时候才读(load)"""

    sha: str
    mime: str
    size: int
    load: Callable[[], bytes | None]
    # 仓库里的文件(声音的模型几百 MB):写 zip 时直接从硬盘按块拷,不整个读进内存
    disk: Path | None = None

    @property
    def path(self) -> str:
        return f"assets/{self.sha}.{ext_of(self.mime)}"


@dataclass
class PackInfo:
    kind: str
    id: str
    name: str
    data: dict  # pack.json 的内容
    paths: list[str]  # 这个包用到的文件(去重)
    detail: str
    missing: int = 0  # 声音:现在拿不到的文件数(语音机连不上、路径不让读)
    warn: str | None = None  # 声音:授权不让再分发时的提醒


@dataclass
class Archive:
    """一个要写的 zip:jsons 按顺序写(清单在最前),files 按指纹去重"""

    file_name: str
    jsons: dict[str, Any] = field(default_factory=dict)
    files: dict[str, FileSrc] = field(default_factory=dict)


@dataclass
class Bundle(Archive):
    manifest: dict = field(default_factory=dict)
    packs: list[PackInfo] = field(default_factory=list)
    card_bytes: int = 0
    preset_bytes: int = 0
    preset_id: str | None = None
    current_sprite_packs: set = field(default_factory=set)
    previews: list[dict] = field(default_factory=list)
    avatar_url: str | None = None


@dataclass
class PackFile(Archive):
    pack: PackInfo | None = None


def file_name(title: str, ext: str) -> str:
    """下载的文件名:Windows 不能用的字符换成 _,太长的截掉"""
    name = _UNSAFE_NAME.sub("_", title).strip(" .") or "角色"
    return name[:100].rstrip(" .") + ext


def parse_data_url(url: str | None) -> tuple[bytes, str] | None:
    """卡头像的 data URL → (原件, 类型);不是 base64 的 data URL 当没有"""
    m = _DATA_URL.match(url or "")
    if not m:
        return None
    try:
        return base64.b64decode(m.group(2), validate=False), m.group(1).lower()
    except (binascii.Error, ValueError):
        return None


def _cols(row, skip: Iterable[str]) -> dict:
    """一行的列(不读 deferred 的原件列):编号、包、时间和 skip 里的不要"""
    out = {}
    drop = _SKIP | set(skip)
    for col in row.__table__.columns:
        if col.key not in drop:
            out[col.key] = copy.deepcopy(getattr(row, col.key))
    return out


class _Collector:
    """收文件、记 key;包之间的引用最后按「这次导出了哪些 key」统一收口(fix_refs)"""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.files: dict[str, FileSrc] = {}
        self.item_keys: set[str] = set()
        self._blob_sizes: dict[str, int | None] = {}

    # ── 文件 ──

    def _size(self, sha: str, mime: str, row_size: int | None) -> int:
        if sha not in self._blob_sizes:
            self._blob_sizes[sha] = self.db.scalar(select(Blob.size).where(Blob.sha == sha))
        size = self._blob_sizes[sha]
        if size is not None:
            return size
        if row_size:
            return row_size
        path = store().path(sha, mime)
        return path.stat().st_size if path.is_file() else 0

    def file_of(self, ref: refs.BlobRef, row) -> FileSrc | None:
        mime = ref.mime_of(row)
        if mime is None:
            return None
        sha = getattr(row, ref.sha)
        db = self.db
        if sha:
            model, row_id = type(row), row.id

            def load() -> bytes | None:
                r = db.get(model, row_id)
                return refs.read_bytes(ref, r, db) if r is not None else None

            return FileSrc(sha, mime, self._size(sha, mime, getattr(row, "size", None)), load)
        data = refs.read_bytes(ref, row, db)
        if data is None:
            return None
        return FileSrc(sha_of(data), mime, len(data), lambda: data)

    def add(self, src: FileSrc | None) -> str | None:
        if src is None:
            return None
        self.files.setdefault(src.path, src)
        return src.path

    def add_bytes(self, data: bytes, mime: str) -> str:
        return self.add(FileSrc(sha_of(data), mime, len(data), lambda: data))

    # ── 包 ──

    def _items(self, ref: refs.BlobRef, rows, skip: set[str]) -> tuple[list[dict], list[str]]:
        items, paths = [], []
        for r in rows:
            item = {"key": r.id, **_cols(r, skip | {ref.data, ref.sha})}
            item["file"] = self.add(self.file_of(ref, r))
            if item["file"] and item["file"] not in paths:
                paths.append(item["file"])
            items.append(item)
            self.item_keys.add(r.id)
        return items, paths

    def pack(self, kind: str, pack_id: str) -> PackInfo:
        db = self.db
        if kind == "sprite":
            pack = db.get(SpritePack, pack_id)
            if pack is None:
                raise NotFound("立绘包不存在")
            rows = db.scalars(
                select(PackSprite).where(PackSprite.pack_id == pack_id).order_by(PackSprite.sort, PackSprite.created_at)
            ).all()
            items, paths = self._items(refs.SPRITE, rows, set())
            layout = db.get(SpritePackLayout, pack_id)
            data = {
                "pack": _cols(pack, ()),
                "items": items,
                "layouts": [_cols(layout, ())] if layout is not None else [],
            }
            detail = f"{len(items)} 张"
        elif kind == "scene":
            pack = db.get(ScenePack, pack_id)
            if pack is None:
                raise NotFound("场景包不存在")
            rows = db.scalars(
                select(SceneAsset)
                .where(SceneAsset.pack_id == pack_id)
                .order_by(SceneAsset.kind, SceneAsset.sort, SceneAsset.created_at)
            ).all()
            # 已经拆成 CG 包的 CG 不带(同 duplicate_scene_pack):游戏里出的是那个 CG 包
            if cg_sync.cg_pack_of_scene(db, pack_id) is not None:
                rows = [r for r in rows if r.kind != "cg"]
            items, paths = self._items(refs.SCENE_ASSET, rows, set())
            data = {"pack": _cols(pack, ()), "items": items, "layouts": []}
            bg = sum(1 for r in rows if r.kind == "bg")
            bgm = sum(1 for r in rows if r.kind == "bgm")
            cg = sum(1 for r in rows if r.kind == "cg" and r.parent_id is None)
            parts = [f"{bg} 张背景" if bg else "", f"{bgm} 首 BGM" if bgm else "", f"{cg} 张 CG" if cg else ""]
            detail = "、".join(p for p in parts if p) or "空的"
        elif kind == "cg":
            pack = db.get(CgPack, pack_id)
            if pack is None:
                raise NotFound("CG 包不存在")
            rows = db.scalars(select(CgAsset).where(CgAsset.pack_id == pack_id).order_by(CgAsset.sort, CgAsset.created_at)).all()
            items, paths = self._items(refs.CG_ASSET, rows, set())
            # 来源场景包是本机迁移时的事,带到别的库里没有意义(同 duplicate_cg_pack:副本不连到来源场景包)
            data = {"pack": _cols(pack, {"source_scene_pack_id"}), "items": items, "layouts": []}
            comps = sum(1 for r in rows if r.parent_id is None)
            variants = len(rows) - comps
            detail = f"{comps} 张 CG" + (f"、{variants} 张差分" if variants else "")
        elif kind == "voice":
            return self.voice(pack_id)
        else:
            raise NotFound(f"没有这一类包:{kind}")
        body = {"format": FORMAT_PACK, "version": VERSION, "kind": kind, "key": pack_id, **data}
        return PackInfo(kind, pack_id, pack.name, body, paths, detail)

    def _voice_file(self, slot: voice_files.Slot) -> FileSrc | None:
        disk = voice_files.file_of(self.db, slot)
        if disk is None:
            return None
        return FileSrc(slot.sha, voice_files.mime_of(self.db, slot), disk.stat().st_size, disk.read_bytes, disk)

    def voice(self, voice_id: str) -> PackInfo:
        """一个声音 → pack.json(格式见技术计划第 4 步「格式」)。文件只认仓库里已经有的(先 prefetch)"""
        db = self.db
        profile = db.get(VoiceProfile, voice_id)
        if profile is None:
            raise NotFound("声音不存在")
        conn = db.get(TtsConnection, profile.connection_id)
        emotions = voice_files.exported_emotions(db, voice_id)
        slots = voice_files.slots_of(db, profile, emotions)
        paths: list[str] = []

        def put(slot: voice_files.Slot | None) -> str | None:
            path = self.add(self._voice_file(slot)) if slot is not None else None
            if path and path not in paths:
                paths.append(path)
            return path

        by_row: dict[str, list[voice_files.Slot]] = {}
        for slot in slots:
            by_row.setdefault(slot.row.id, []).append(slot)
        items = []
        for e in emotions:
            mine = by_row.get(e.id, [])
            ref = next((x for x in mine if x.kind == "ref"), None)
            aux = [put(x) for x in mine if x.kind == "aux"]
            items.append(
                {
                    "key": e.id,
                    "label": e.label,
                    "aliases": list(e.aliases or []),
                    "prompt_text": e.prompt_text,
                    "sort": e.sort,
                    "emo_vector": copy.deepcopy(e.emo_vector),
                    "file": put(ref),
                    "aux": [a for a in aux if a],
                }
            )
            if items[-1]["file"] is None and ref is not None and ref.path:
                # 文件没带来:记下原文件名,导入时认得出「两行用的是同一段参考」
                items[-1]["ref_name"] = voice_files.basename(ref.path)
            self.item_keys.add(e.id)
        own = {x.kind: x for x in slots if x.row is profile}
        models: dict[str, dict | None] = {}
        for kind in ("gpt", "sovits"):
            slot = own.get(kind)
            name = getattr(profile, f"{kind}_name") or (voice_files.basename(slot.path) if slot is not None else "")
            size = getattr(profile, f"{kind}_size")
            src = self._voice_file(slot) if slot is not None else None
            if src is not None:
                path = put(slot)
                models[kind] = {"file": path, "sha256": src.sha, "size": src.size, "name": name}
            elif slot is not None or name:
                models[kind] = {"name": name, "size": size}
            else:
                models[kind] = None
        head = {
            "name": profile.name,
            "aliases": list(profile.aliases or []),
            "engine": conn.api_type if conn is not None else "gpt_sovits",
            "text_lang": profile.text_lang,
            "speed": profile.speed,
            "params": copy.deepcopy(profile.params or {}),
            "source": profile.source or "",
            "license": profile.license or "",
            "models": models,
            "speaker_ref": put(own.get("speaker")),
        }
        body = {"format": FORMAT_PACK, "version": VERSION, "kind": "voice", "key": voice_id, "pack": head, "items": items}
        refs_n = len({voice_files.file_key(x) for x in slots if x.kind in ("ref", "aux", "speaker")})
        models_n = sum(1 for k in ("gpt", "sovits") if models[k] is not None)
        missing = len({voice_files.file_key(x) for x in slots} - {voice_files.file_key(x) for x in slots if voice_files.file_of(db, x) is not None})
        return PackInfo("voice", voice_id, profile.name, body, paths, voice_detail(refs_n, models_n), missing, voice_warn(profile.license))

    def fix_refs(self, info: PackInfo) -> None:
        """包里指向这次没导出的东西的引用写 null:背景的默认曲(可以是别的导出的包里的曲子)、封面曲和差分的构图(只能是本包的)"""
        own = {i["key"] for i in info.data["items"]}
        for item in info.data["items"]:
            if item.get("bgm_id") and item["bgm_id"] not in self.item_keys:
                item["bgm_id"] = None
            if item.get("parent_id") and item["parent_id"] not in own:
                item["parent_id"] = None
        pack = info.data["pack"]
        if pack.get("title_bgm_id") and pack["title_bgm_id"] not in own:
            pack["title_bgm_id"] = None

    def word_records(self, list_ref: str, items: set[str] | None) -> list[dict]:
        """这份名单的认词记录;items 给了就只要记的那一项在里面的(立绘被删了的不带)"""
        out = []
        rows = self.db.scalars(select(WordRecord).where(WordRecord.list_ref == list_ref).order_by(WordRecord.id)).all()
        for w in rows:
            if items is not None and w.item not in items:
                continue
            out.append(
                {
                    "list": list_ref,
                    "word": w.word,
                    "item": w.item,
                    "source": w.source,
                    "guessed": w.guessed,
                    "unstable": w.unstable,
                    "score": w.score,
                }
            )
        return out


def voice_detail(refs_n: int, models_n: int) -> str:
    """「12 段参考 + 2 个模型」"""
    parts = [f"{refs_n} 段参考" if refs_n else "", f"{models_n} 个模型" if models_n else ""]
    return " + ".join(x for x in parts if x) or "空的"


def voice_warn(license_text: str | None) -> str | None:
    """授权说明明说能再分发才不提醒;没写的(以前的声音都没写)一律提醒:游戏原声练的模型本来就不能再分发"""
    text = (license_text or "").strip()
    if text and SHARE_OK.search(text) and not SHARE_NOT.search(text):
        return None
    return VOICE_WARN


def _pack_word_records(c: _Collector, info: PackInfo) -> list[dict]:
    return c.word_records(PACK_PREFIX + info.id, {i["key"] for i in info.data["items"]})


def _thumb(sha: str | None) -> str | None:
    return f"/api/blobs/{sha}?w={THUMB_W}" if sha else None


def _first_image(info: PackInfo) -> str | None:
    """包的缩略图:立绘第一张(默认差分)、背景第一张、CG 第一张构图;启用的优先"""
    items = info.data["items"]
    if info.kind == "scene":
        items = [i for i in items if i.get("kind") == "bg"] or [i for i in items if i.get("kind") == "cg"]
    candidates = [i for i in items if i.get("file") and i.get("parent_id") is None]
    pick = next((i for i in candidates if i.get("enabled", True)), candidates[0] if candidates else None)
    return pick["file"].split("/", 1)[1].split(".", 1)[0] if pick else None


# ── 单包 ──


def collect_pack(db: Session, kind: str, pack_id: str) -> PackFile:
    """一个包 → .animapack:pack.json 在根目录,认词记录也在 pack.json 里(立绘包才有)。
    声音的文件要先在仓库里(导出接口先 prefetch)"""
    if kind not in PACK_KINDS:
        raise NotFound(f"没有这一类包:{kind}")
    c = _Collector(db)
    info = c.pack(kind, pack_id)
    c.item_keys = {i["key"] for i in info.data["items"]}
    c.fix_refs(info)
    if kind == "sprite":
        info.data["word_records"] = _pack_word_records(c, info)
    out = PackFile(file_name=file_name(info.name, ".animapack"), pack=info)
    out.jsons[PACK_MANIFEST] = info.data
    out.files = c.files
    return out


# ── 整角色 ──


def _group_cards(db: Session, card_id: str) -> tuple[list[TavernCard], TavernCard, dict]:
    card = db.get(TavernCard, card_id)
    if card is None:
        raise NotFound("角色卡不存在")
    group = states.group_of(db, card_id)
    if group["group_id"] is None:
        return [card], card, group
    cards = [c for s in group["states"] if (c := db.get(TavernCard, s["card_id"])) is not None]
    main = db.get(TavernCard, group["main_card_id"]) if group["main_card_id"] else None
    if main is None or main not in cards:
        main = cards[0]
    return cards, main, group


def _bindings_of(db: Session, card: TavernCard, excluded: set[str]) -> list[dict]:
    """这张卡的立绘包、场景包、CG 包、声音的绑定;包已经不在的、勾掉的不要"""
    role = bindings.main_role(db, card.id)
    out = []
    sprites = [(t, p) for t, p in bindings.bound(db, card.id, bindings.SPRITE) if db.get(SpritePack, t) is not None]
    sprites = [(t, p) for t, p in sprites if f"sprite:{t}" not in excluded]
    for i, (t, p) in enumerate(sprites):
        out.append({"card": card.id, "kind": "sprite", "pack": t, "role": role.id if role else None, "parts": "", "is_primary": p, "sort": i})
    parts = bindings.scene_parts(db, card.id)
    scenes = [t for t in bindings.targets(db, card.id, bindings.SCENE) if db.get(ScenePack, t) is not None]
    scenes = [t for t in scenes if f"scene:{t}" not in excluded]
    for i, t in enumerate(scenes):
        bg, bgm = t in parts["bg"], t in parts["bgm"]
        side = "" if bg == bgm else (bindings.PART_BG if bg else bindings.PART_BGM)
        out.append({"card": card.id, "kind": "scene", "pack": t, "role": None, "parts": side, "is_primary": False, "sort": i})
    cgs = [t for t in bindings.targets(db, card.id, bindings.CG) if db.get(CgPack, t) is not None]
    cgs = [t for t in cgs if f"cg:{t}" not in excluded]
    for i, t in enumerate(cgs):
        out.append({"card": card.id, "kind": "cg", "pack": t, "role": None, "parts": "", "is_primary": False, "sort": i})
    voices = [(t, p) for t, p in bindings.bound(db, card.id, bindings.VOICE) if db.get(VoiceProfile, t) is not None]
    voices = [(t, p) for t, p in voices if f"voice:{t}" not in excluded]
    for i, (t, p) in enumerate(voices):
        out.append({"card": card.id, "kind": "voice", "pack": t, "role": role.id if role else None, "parts": "", "is_primary": p, "sort": i})
    return out


def voice_ids_of_card(db: Session, card_id: str, exclude: Iterable[str] = ()) -> list[str]:
    """导出这张卡(整组)会带的声音(导出接口先把它们的文件拉进仓库)"""
    excluded = set(exclude)
    cards, _, _ = _group_cards(db, card_id)
    out: list[str] = []
    for card in cards:
        for b in _bindings_of(db, card, excluded):
            if b["kind"] == "voice" and b["pack"] not in out:
                out.append(b["pack"])
    return out


def _imagegen_pref(value: Any, sprite_keys: set[str]) -> Any:
    """生图卡带的按卡设置:ref.id 指着导出的立绘就留着;指着别的(没导出的立绘、上传的图)去掉 ref。没选(null)的照旧"""
    if not isinstance(value, dict) or not isinstance(value.get("ref"), dict):
        return value
    ref_id = value["ref"].get("id")
    if ref_id is None or ref_id in sprite_keys:
        return value
    return {k: v for k, v in value.items() if k != "ref"}


def _pairings(
    db: Session,
    sprite_packs: list[PackInfo],
    cg_comps: set[str],
    cg_keys: set[str],
    cards: set[str],
    voices: list[PackInfo] = (),
) -> list[dict]:
    return _cg_pairings(db, sprite_packs, cg_comps, cg_keys, cards) + _voice_pairings(db, sprite_packs, voices, cards)


def _voice_pairings(db: Session, sprite_packs: list[PackInfo], voices: list[PackInfo], cards: set[str]) -> list[dict]:
    """声音的配对表:名单是导出的立绘包(一套立绘都不带时是内置名单),target 是导出的声音;格子的值是这个声音的情绪行"""
    if not voices:
        return []
    lists: dict[str, set[str] | None] = {PACK_PREFIX + p.id: {i["key"] for i in p.data["items"]} for p in sprite_packs}
    if not lists:
        lists = {BUILTIN: None}
    rows_of = {v.id: {i["key"] for i in v.data["items"]} for v in voices}
    out = []
    rows = db.scalars(
        select(Pairing)
        .where(Pairing.follower == "voice", Pairing.list_ref.in_(list(lists)), Pairing.target.in_(list(rows_of)))
        .order_by(Pairing.list_ref, Pairing.target, Pairing.card_id)
    ).all()
    for p in rows:
        if p.card_id and p.card_id not in cards:
            continue
        items = lists[p.list_ref]
        cells = db.scalars(select(PairingRow).where(PairingRow.pairing_id == p.id).order_by(PairingRow.item)).all()
        out.append(
            {
                "follower": "voice",
                "list": p.list_ref,
                "target": p.target,
                "card": p.card_id or None,
                "rows": [
                    {
                        "item": r.item,
                        "value": r.value if r.value in rows_of[p.target] else None,
                        "source": r.source,
                        "guessed": r.guessed,
                        "pending": r.pending,
                        "unstable": r.unstable,
                    }
                    for r in cells
                    if items is None or r.item in items
                ],
            }
        )
    return out


def _cg_pairings(db: Session, sprite_packs: list[PackInfo], cg_comps: set[str], cg_keys: set[str], cards: set[str]) -> list[dict]:
    out = []
    lists = {PACK_PREFIX + p.id: {i["key"] for i in p.data["items"]} for p in sprite_packs}
    if not lists or not cg_comps:
        return out
    rows = db.scalars(
        select(Pairing)
        .where(Pairing.follower == "cg", Pairing.list_ref.in_(list(lists)), Pairing.target.in_(list(cg_comps)))
        .order_by(Pairing.list_ref, Pairing.target, Pairing.card_id)
    ).all()
    for p in rows:
        if p.card_id and p.card_id not in cards:
            continue
        cells = db.scalars(select(PairingRow).where(PairingRow.pairing_id == p.id).order_by(PairingRow.item)).all()
        out.append(
            {
                "follower": p.follower,
                "list": p.list_ref,
                "target": p.target,
                "card": p.card_id or None,
                "rows": [
                    {
                        "item": r.item,
                        "value": r.value if r.value in cg_keys else None,
                        "source": r.source,
                        "guessed": r.guessed,
                        "pending": r.pending,
                        "unstable": r.unstable,
                    }
                    for r in cells
                    if r.item in lists[p.list_ref]
                ],
            }
        )
    return out


def _preset_of(db: Session, main_id: str) -> PromptPreset | None:
    row = db.get(AppSetting, PRESET_BINDINGS)
    value = row.value if row is not None else None
    cards = value.get("cards") if isinstance(value, dict) else None
    pid = cards.get(main_id) if isinstance(cards, dict) else None
    return db.get(PromptPreset, pid) if isinstance(pid, str) else None


def _preset_cards(db: Session, preset_id: str, card_ids: list[str]) -> list[str]:
    row = db.get(AppSetting, PRESET_BINDINGS)
    cards = (row.value or {}).get("cards") if row is not None and isinstance(row.value, dict) else None
    return [c for c in card_ids if isinstance(cards, dict) and cards.get(c) == preset_id]


def _dumps(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def collect_card(
    db: Session,
    card_id: str,
    exclude: Iterable[str] = (),
    with_preset: bool = True,
    note: str = "",
    preview: dict | None = None,
) -> Bundle:
    """一张卡(连同整组状态)→ .animavn。exclude:不带的包,写成 "sprite:<id>" / "scene:<id>" / "cg:<id>"。
    preview:{"kind": "avatar"} 或 {"kind": "sprite", "id": 立绘编号};不给 / 用不了时用主卡头像"""
    excluded = set(exclude)
    cards, main, group = _group_cards(db, card_id)
    card_ids = [c.id for c in cards]
    bundle_id = uuid.uuid4().hex
    c = _Collector(db)
    out = Bundle(file_name=file_name(main.name.strip() or "角色", ".animavn"))

    # 卡
    entries, card_bytes = [], 0
    for card in cards:
        data = {f: copy.deepcopy(getattr(card, f)) for f in CARD_FIELDS}
        ext = data["extensions"] if isinstance(data["extensions"], dict) else {}
        data["extensions"] = {**ext, "animavn": {"bundle": bundle_id, "card": card.id}}
        body = {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}
        path = f"cards/{card.id}.json"
        out.jsons[path] = body
        card_bytes += len(_dumps(body))
        avatar = parse_data_url(card.avatar)
        avatar_path = c.add_bytes(*avatar) if avatar else None
        if avatar:
            card_bytes += len(avatar[0])
        entries.append({"key": card.id, "file": path, "avatar": avatar_path})
    out.card_bytes = card_bytes
    out.avatar_url = main.avatar if parse_data_url(main.avatar) else None

    # 绑定和包
    binding_rows = [b for card in cards for b in _bindings_of(db, card, excluded)]
    order: list[tuple[str, str]] = []
    for kind in PACK_KINDS:
        for b in binding_rows:
            if b["kind"] == kind and (kind, b["pack"]) not in order:
                order.append((kind, b["pack"]))
    infos = [c.pack(kind, pid) for kind, pid in order]
    for info in infos:
        c.fix_refs(info)
    out.packs = infos
    out.current_sprite_packs = {b["pack"] for b in binding_rows if b["kind"] == "sprite" and b["is_primary"]}
    sprite_infos = [i for i in infos if i.kind == "sprite"]
    sprite_keys = {it["key"] for i in sprite_infos for it in i.data["items"]}
    cg_items = [
        it
        for i in infos
        if i.kind == "cg" or i.kind == "scene"
        for it in i.data["items"]
        if i.kind == "cg" or it.get("kind") == "cg"
    ]
    cg_keys = {it["key"] for it in cg_items}
    cg_comps = {it["key"] for it in cg_items if it.get("parent_id") is None}

    roles = db.scalars(select(CardRole).where(CardRole.card_id.in_(card_ids)).order_by(CardRole.sort)).all()
    role_rows = [
        {"card": r.card_id, "key": r.id, **_cols(r, {"card_id"})}
        for r in sorted(roles, key=lambda r: (card_ids.index(r.card_id), r.sort))
    ]

    prefs = db.scalars(select(CardPref).where(CardPref.card_id.in_(card_ids)).order_by(CardPref.key)).all()
    pref_rows = []
    for p in sorted(prefs, key=lambda p: (card_ids.index(p.card_id), p.key)):
        if not p.key.startswith(PLUGIN_PREFIX):
            continue
        value = copy.deepcopy(p.value)
        if p.key == IMAGEGEN_KEY:
            value = _imagegen_pref(value, sprite_keys)
        pref_rows.append({"card": p.card_id, "key": p.key, "value": value})

    words = [w for i in sprite_infos for w in _pack_word_records(c, i)]
    if not sprite_infos:
        words = c.word_records(BUILTIN, None)
    pairings = _pairings(db, sprite_infos, cg_comps, cg_keys, set(card_ids), [i for i in infos if i.kind == "voice"])

    # 预设
    preset_entry = None
    preset = _preset_of(db, main.id)
    if preset is not None:
        out.preset_id = preset.id
        body = {f: copy.deepcopy(getattr(preset, f)) for f in PRESET_FIELDS}
        out.preset_bytes = len(_dumps(body))
        if with_preset:
            path = f"presets/{preset.id}.json"
            out.jsons[path] = body
            preset_entry = {"file": path, "name": preset.name, "cards": _preset_cards(db, preset.id, card_ids)}

    # 预览图
    sprite_previews = []
    for info in sorted(sprite_infos, key=lambda i: i.id not in out.current_sprite_packs):
        for it in info.data["items"]:
            if it.get("file") and it.get("enabled", True) and len(sprite_previews) < MAX_SPRITE_PREVIEWS:
                sha = it["file"].split("/", 1)[1].split(".", 1)[0]
                sprite_previews.append({"kind": "sprite", "id": it["key"], "thumb": _thumb(sha)})
    main_avatar = entries[card_ids.index(main.id)]["avatar"]
    out.previews = ([{"kind": "avatar"}] if main_avatar else []) + sprite_previews
    preview_path = main_avatar
    if isinstance(preview, dict) and preview.get("kind") == "sprite" and isinstance(preview.get("id"), str):
        sprite = db.get(PackSprite, preview["id"])
        if sprite is not None:
            preview_path = c.add(c.file_of(refs.SPRITE, sprite)) or preview_path
    if preview_path is None and sprite_previews:
        preview_path = c.add(c.file_of(refs.SPRITE, db.get(PackSprite, sprite_previews[0]["id"])))

    state_group = None
    if group["group_id"] is not None:
        state_group = {
            "row": {"key": group["group_id"], "main_card_id": main.id},
            "states": [
                {"card": s["card_id"], "name": s["name"], "sort": s["sort"], "show_in_pick": s["show_in_pick"]}
                for s in group["states"]
                if s["card_id"] in card_ids
            ],
        }

    out.manifest = {
        "format": FORMAT_BUNDLE,
        "version": VERSION,
        "bundle": bundle_id,
        "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "title": main.name,
        "note": (note or "")[:NOTE_MAX],
        "preview": preview_path,
        "main_card": main.id,
        "cards": entries,
        "state_group": state_group,
        "roles": role_rows,
        "packs": [{"key": i.id, "kind": i.kind, "file": f"packs/{i.id}/{PACK_MANIFEST}"} for i in infos],
        "bindings": binding_rows,
        "card_prefs": pref_rows,
        "word_records": words,
        "pairings": pairings,
        "preset": preset_entry,
    }
    out.jsons = {MANIFEST: out.manifest, **out.jsons}
    for info in infos:
        out.jsons[f"packs/{info.id}/{PACK_MANIFEST}"] = info.data
    out.files = c.files
    return out


def summary(db: Session, card_id: str) -> dict:
    """导出面板:会带上什么、各多大(接口 GET /api/export/bundle/{card_id}/summary 的样子)"""
    b = collect_card(db, card_id, exclude=(), with_preset=True)
    m = b.manifest
    group = {s["card"]: s["name"] for s in (m["state_group"] or {}).get("states", [])}
    names = {c.id: c.name for c in db.scalars(select(TavernCard).where(TavernCard.id.in_([e["key"] for e in m["cards"]])))}
    items = []
    for info in b.packs:
        sha = _first_image(info) if info.kind != "voice" else None
        item = {
            "key": f"{info.kind}:{info.id}",
            "kind": info.kind,
            "name": info.name,
            "detail": info.detail,
            "bytes": sum(b.files[p].size for p in info.paths),
            "current": info.kind == "sprite" and info.id in b.current_sprite_packs,
            "thumb": _thumb(sha),
        }
        if info.kind == "voice":
            item.update(missing=info.missing, warn=info.warn)
        items.append(item)
    follows = []
    if m["word_records"]:
        follows.append(f"认词记录 {len(m['word_records'])} 条")
    if m["pairings"]:
        follows.append(f"配对表 {len(m['pairings'])} 张")
    sprite_infos = [i for i in b.packs if i.kind == "sprite"]
    if any(i.data["layouts"] or any(it.get("effect") for it in i.data["items"]) for i in sprite_infos):
        follows.append("立绘位置和特效")
    if m["card_prefs"]:
        follows.append(f"按卡的插件设置 {len(m['card_prefs'])} 项")
    preset = None
    if b.preset_id is not None and m["preset"] is not None:
        preset = {"id": b.preset_id, "name": m["preset"]["name"], "bytes": b.preset_bytes}
    return {
        "title": m["title"],
        "file_name": b.file_name,
        "avatar": b.avatar_url,
        "cards": [
            {"id": e["key"], "name": names.get(e["key"], ""), "state": group.get(e["key"]), "main": e["key"] == m["main_card"]}
            for e in m["cards"]
        ],
        "card_bytes": b.card_bytes,
        "items": items,
        "follows": follows,
        "preset": preset,
        "previews": b.previews,
        "not_included": list(NOT_INCLUDED),
    }
