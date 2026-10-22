"""照角色包 / 单包的清单在库里建新行(导入时用)。不提交:调用方在一个事务里提交,出错整体回滚。

    created = restore_bundle(db, folder, manifest, with_preset=True)
    created = restore_pack(db, folder, pack)

- 全部换新编号:包、包里的每一行、卡、角色位、状态组、配对表;包内包间的引用(默认曲、封面曲、差分的构图、认词记录的那一项、
  配对表的 target 和格子)按 key 换掉,指不到的写 null(配对表的格子、认词记录指不到就不建)。
- 重复导入一律另存一份:卡、包、预设重名时名字后面接「 2」「 3」。同一组的几张卡按导入前的库算名字,原来同名的还是同名。
- 卡里的小记号 extensions.animavn 不存进库。
- 绑定走 app/bindings.py(旧表照样写一份);状态组、按卡设置(只收 plugin.*)、认词记录、配对表、预设和它的绑定
  (app_settings 的 preset.bindings)都建上。内置名单(builtin)的认词记录只补库里还没有的词,不改你自己的。
- 声音(第 4 步):参考音频和模型原样放进文件仓库(按指纹,存成带扩展名的文件;wav 不转码)。挂到哪个语音服务:
  给了 connection_id 就用它(引擎对得上的声音),不然用第一个同引擎的;一个都没有就新建「本机 GPT-SoVITS」
  (127.0.0.1:9880;IndexTTS 是 9890)。语音服务是本机(127.0.0.1 / localhost / ::1)时,声音的路径直接写成仓库里那几个文件的
  绝对路径(files_at = local,导完就能念);不是本机时路径先空着(files_at = pending,在声音编辑器里导出这些文件、放好再填目录)。
  语音的配对表(名单是立绘包或内置名单、target 是声音、格子是情绪行)一起建。
- 返回 Created:建了什么(撤销用,app/importer/jobs.py)和一句一句的报告。
"""

from __future__ import annotations

import base64
import copy
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings
from app.assets.common import sniff_image_mime, unique_pack_name
from app.bundle.collect import BUILTIN, IMAGEGEN_KEY, PACK_PREFIX, PLUGIN_PREFIX, PRESET_BINDINGS, PRESET_FIELDS, voice_detail
from app.bundle.read import BundleError, Manifest, check_refs, safe_path
from app.config import settings
from app.importer.cards import normalize
from app.models import (
    AppSetting,
    AssetBinding,
    CardPref,
    CardRole,
    CardState,
    CardStateGroup,
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
    VoiceEmotion,
    VoiceProfile,
    WordRecord,
)
from app.storage import refs
from app.storage.blobs import mime_for_name, store

PACK_MODELS = {
    "sprite": (SpritePack, PackSprite, refs.SPRITE, "sprite_packs", "立绘包"),
    "scene": (ScenePack, SceneAsset, refs.SCENE_ASSET, "scene_packs", "场景包"),
    "cg": (CgPack, CgAsset, refs.CG_ASSET, "cg_packs", "CG 包"),
}
# 行里不从清单抄的列
_NEVER = {"id", "pack_id", "created_at", "updated_at"}
# 库里一个语音服务都没有时新建的那个(引擎 → 名字、地址;GSV api_v2 默认 9880,我们的 IndexTTS 小服务 9890)
DEFAULT_CONNECTIONS = {
    "gpt_sovits": ("本机 GPT-SoVITS", "http://127.0.0.1:9880"),
    "indextts": ("本机 IndexTTS", "http://127.0.0.1:9890"),
}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def is_local(base_url: str | None) -> bool:
    """语音服务是不是就在这台电脑上(地址的主机是 127.0.0.1 / localhost / ::1)"""
    return (urlsplit(base_url or "").hostname or "").strip("[]").lower() in LOCAL_HOSTS


def default_connection(db: Session, engine: str) -> TtsConnection | None:
    """这个引擎默认挂的语音服务:第一个同引擎的连接"""
    return db.scalars(select(TtsConnection).where(TtsConnection.api_type == engine).order_by(TtsConnection.created_at)).first()


def voice_engine(pack: dict) -> str:
    engine = (pack.get("pack") or {}).get("engine")
    return engine if engine in DEFAULT_CONNECTIONS else "gpt_sovits"


def voice_counts(pack: dict) -> tuple[int, int, int]:
    """包里一个声音:(参考段数, 模型个数, 没带来的文件数),和导出面板的算法一样(同一个文件算一个)"""
    head = pack.get("pack") or {}
    items = [i for i in pack.get("items") or [] if isinstance(i, dict)]
    engine = voice_engine(pack)
    refs_seen: set[str] = set()
    # 没带来的参考:同一个原文件名算一个(老包没有 ref_name 时一行算一个)
    lost: set[str] = set()
    for i in items:
        if i.get("file"):
            refs_seen.add(i["file"])
        elif engine == "gpt_sovits":
            lost.add(str(i.get("ref_name") or f"row:{i.get('key')}"))
        refs_seen.update(a for a in i.get("aux") or [] if isinstance(a, str))
    missing = len(lost)
    if head.get("speaker_ref"):
        refs_seen.add(head["speaker_ref"])
    elif engine == "indextts":
        missing += 1
    models = head.get("models") or {}
    n_models = sum(1 for k in ("gpt", "sovits") if isinstance(models.get(k), dict))
    missing += sum(1 for k in ("gpt", "sovits") if isinstance(models.get(k), dict) and not models[k].get("file"))
    n_refs = len(refs_seen) + len(lost)
    return n_refs, n_models, missing


def voice_pack_detail(pack: dict) -> str:
    n_refs, n_models, _ = voice_counts(pack)
    return voice_detail(n_refs, n_models)


@dataclass
class Created:
    cards: list[str] = field(default_factory=list)
    sprite_packs: list[str] = field(default_factory=list)
    scene_packs: list[str] = field(default_factory=list)
    cg_packs: list[str] = field(default_factory=list)
    voices: list[str] = field(default_factory=list)
    tts_connections: list[str] = field(default_factory=list)  # 库里没有语音服务时新建的那个
    presets: list[str] = field(default_factory=list)
    state_groups: list[str] = field(default_factory=list)
    word_records: list[int] = field(default_factory=list)  # 补进内置名单的(立绘包的跟着包删)
    settings: list[str] = field(default_factory=list)  # 这次新建的 app_settings 键(原来没有 preset.bindings 时)
    main_card: str | None = None
    lines: list[str] = field(default_factory=list)
    kinds: list[str] = field(default_factory=list)  # 绑上了哪几样:sprite / bg / bgm / cg

    def as_dict(self) -> dict:
        """记进 ImportJob.created 的那些"""
        return {
            "cards": list(self.cards),
            "sprite_packs": list(self.sprite_packs),
            "scene_packs": list(self.scene_packs),
            "cg_packs": list(self.cg_packs),
            "voices": list(self.voices),
            "tts_connections": list(self.tts_connections),
            "presets": list(self.presets),
            "state_groups": list(self.state_groups),
            "word_records": list(self.word_records),
            "settings": list(self.settings),
        }


def _new_id() -> str:
    return uuid.uuid4().hex


def _columns(model, data: dict, skip: set[str]) -> dict:
    """清单里这一行的值,只取模型有的列(以后的版本多写的字段不管)"""
    cols = {c.key for c in model.__table__.columns}
    return {k: copy.deepcopy(v) for k, v in data.items() if k in cols and k not in _NEVER and k not in skip}


def pack_detail(kind: str, pack: dict) -> str:
    """「14 张」「16 张背景、7 首 BGM」「6 张 CG、12 张差分」(同 collect.py 给导出面板的)"""
    items = [i for i in pack.get("items") or [] if isinstance(i, dict)]
    if kind == "voice":
        return voice_pack_detail(pack)
    if kind == "sprite":
        return f"{len(items)} 张"
    if kind == "scene":
        bg = sum(1 for i in items if i.get("kind") == "bg")
        bgm = sum(1 for i in items if i.get("kind") == "bgm")
        cg = sum(1 for i in items if i.get("kind") == "cg" and not i.get("parent_id"))
        parts = (f"{bg} 张背景" if bg else "", f"{bgm} 首 BGM" if bgm else "", f"{cg} 张 CG" if cg else "")
        return "、".join(x for x in parts if x) or "空的"
    comps = sum(1 for i in items if not i.get("parent_id"))
    return f"{comps} 张 CG" + (f"、{len(items) - comps} 张差分" if len(items) > comps else "")


def follows(data: dict, packs: list[dict]) -> list[str]:
    """跟着走的东西(导入确认里那一行;同 collect.summary 的 follows)"""
    out = []
    if data.get("word_records"):
        out.append(f"认词记录 {len(data['word_records'])} 条")
    if data.get("pairings"):
        out.append(f"配对表 {len(data['pairings'])} 张")
    sprites = [p for p in packs if p.get("kind") == "sprite"]
    if any(p.get("layouts") or any(isinstance(i, dict) and i.get("effect") for i in p.get("items") or []) for p in sprites):
        out.append("立绘位置和特效")
    if data.get("card_prefs"):
        out.append(f"按卡的插件设置 {len(data['card_prefs'])} 项")
    return out


class _Files:
    """把包里的文件放进文件仓库;同一个文件只读一次(开关 storage_files 开着时库里只记指纹)"""

    def __init__(self, db: Session, folder: Path) -> None:
        self.db, self.folder = db, Path(folder)
        self._sha: dict[str, str] = {}
        self._mime: dict[str, str] = {}

    def read(self, rel: str) -> bytes:
        return safe_path(self.folder, rel).read_bytes()

    def put(self, ref: refs.BlobRef, row, rel: str | None, mime: str | None) -> None:
        if not rel or not mime:
            return
        if settings.storage_files and rel in self._sha:
            setattr(row, ref.sha, self._sha[rel])
            setattr(row, ref.data, None)
            return
        refs.save(ref, row, self.read(rel), mime, self.db)
        self._sha[rel] = getattr(row, ref.sha)

    def put_file(self, rel: str | None) -> tuple[str, str] | None:
        """声音的文件(参考音频、模型):原样放进仓库(大文件按块拷;wav 不转码),返回 (指纹, 类型)"""
        if not rel:
            return None
        if rel not in self._sha:
            mime = mime_for_name(rel)
            self._sha[rel] = store().put_path(safe_path(self.folder, rel), mime, self.db)
            self._mime[rel] = mime
        return self._sha[rel], self._mime[rel]


def _unique_name(name: str, taken: set[str]) -> str:
    """X、X 2、X 3…(不分大小写);不往 taken 里记"""
    base = name.strip()
    cand, n = base, 2
    while cand.casefold() in taken:
        cand, n = f"{base} {n}", n + 1
    return cand


class _Restorer:
    def __init__(self, db: Session, folder: Path, connection_id: str | None = None) -> None:
        self.db = db
        self.connection_id = connection_id
        self._conns: dict[str, TtsConnection] = {}
        self.files = _Files(db, folder)
        self.created = Created()
        self.items: dict[str, str] = {}  # 素材 key → 新编号(所有包一起)
        self.packs: dict[str, str] = {}  # 包 key → 新编号
        self.pack_kind: dict[str, str] = {}
        self.cards: dict[str, str] = {}  # 卡 key → 新编号

    # ── 包 ──

    def plan_items(self, packs: list[dict]) -> None:
        """先给所有包的所有行分好新编号:背景的默认曲可以指着另一个包里的曲子"""
        for pack in packs:
            self.packs[pack["key"]] = _new_id()
            self.pack_kind[pack["key"]] = pack["kind"]
            for item in pack.get("items") or []:
                self.items[item["key"]] = _new_id()

    def _ref(self, key) -> str | None:
        return self.items.get(key) if isinstance(key, str) else None

    # ── 声音 ──

    def connection(self, engine: str) -> TtsConnection:
        """这个引擎的声音挂到哪个语音服务(见文件头)"""
        if engine in self._conns:
            return self._conns[engine]
        db = self.db
        conn = None
        if self.connection_id:
            chosen = db.get(TtsConnection, self.connection_id)
            if chosen is None:
                raise BundleError("选的语音服务不在了")
            if chosen.api_type == engine:
                conn = chosen
        conn = conn or default_connection(db, engine)
        if conn is None:
            name, url = DEFAULT_CONNECTIONS[engine]
            conn = TtsConnection(id=_new_id(), name=name, api_type=engine, base_url=url)
            if engine == "indextts":
                conn.options = {"emo_alpha": 1.0}
            db.add(conn)
            db.flush()
            self.created.tts_connections.append(conn.id)
            self.created.lines.append(f"新建语音服务「{name}」({url})")
        self._conns[engine] = conn
        return conn

    def voice(self, pack: dict) -> str:
        db = self.db
        head = pack["pack"]
        engine = voice_engine(pack)
        conn = self.connection(engine)
        local = is_local(conn.base_url)
        blobs = store()

        def where(got: tuple[str, str] | None) -> str:
            return str(blobs.path(*got).resolve()) if got and local else ""

        vid = self.packs[pack["key"]]
        taken = {n.casefold() for n in db.scalars(select(VoiceProfile.name)).all()}
        profile = VoiceProfile(
            id=vid,
            name=_unique_name(str(head.get("name") or "声音")[:80] or "声音", taken),
            aliases=[a for a in head.get("aliases") or [] if isinstance(a, str)],
            connection_id=conn.id,
            text_lang=str(head.get("text_lang") or "zh")[:12],
            speed=float(head["speed"]) if isinstance(head.get("speed"), (int, float)) else 1.0,
            params=copy.deepcopy(head["params"]) if isinstance(head.get("params"), dict) else {},
            source=str(head.get("source") or ""),
            license=str(head.get("license") or ""),
            files_at="local" if local else "pending",
        )
        models = head.get("models") if isinstance(head.get("models"), dict) else {}
        for kind, path_attr in (("gpt", "gpt_weights"), ("sovits", "sovits_weights")):
            m = models.get(kind)
            if not isinstance(m, dict):
                continue
            got = self.files.put_file(m.get("file"))
            setattr(profile, f"{kind}_name", str(m.get("name") or "")[:255])
            size = m.get("size") if isinstance(m.get("size"), int) else None
            if got:
                setattr(profile, f"{kind}_sha", got[0])
                size = blobs.path(*got).stat().st_size
            setattr(profile, f"{kind}_size", size)
            setattr(profile, path_attr, where(got))
        speaker = self.files.put_file(head.get("speaker_ref"))
        if speaker:
            profile.speaker_sha = speaker[0]
            profile.ref_path = where(speaker)
        db.add(profile)
        db.flush()
        for item in pack.get("items") or []:
            got = self.files.put_file(item.get("file"))
            aux = [g for a in item.get("aux") or [] if isinstance(a, str) and (g := self.files.put_file(a))]
            vector = item.get("emo_vector")
            db.add(
                VoiceEmotion(
                    id=self.items[item["key"]],
                    profile_id=vid,
                    label=str(item.get("label") or "默认")[:80],
                    aliases=[a for a in item.get("aliases") or [] if isinstance(a, str)],
                    prompt_text=str(item.get("prompt_text") or ""),
                    sort=int(item["sort"]) if isinstance(item.get("sort"), int) else 0,
                    emo_vector=list(vector) if isinstance(vector, list) else None,
                    ref_sha=got[0] if got else None,
                    ref_path=where(got),
                    aux_shas=[g[0] for g in aux],
                    aux_refs=[where(g) for g in aux] if local else [],
                )
            )
        db.flush()
        self.created.voices.append(vid)
        _, _, missing = voice_counts(pack)
        line = f"新建声音「{profile.name}」({voice_pack_detail(pack)})→ 语音服务「{conn.name}」"
        if missing:
            line += f";{missing} 个文件包里没带(导出时语音机连不上),这个声音缺文件"
        if not local:
            line += ";语音服务在另一台电脑,要在声音编辑器里把文件导出来放过去"
        self.created.lines.append(line)
        return vid

    def pack(self, pack: dict) -> str:
        db = self.db
        kind = pack["kind"]
        if kind == "voice":
            return self.voice(pack)
        pack_model, row_model, ref, created_key, noun = PACK_MODELS[kind]
        pid = self.packs[pack["key"]]
        own = {i["key"] for i in pack.get("items") or []}
        head = pack["pack"]
        row = pack_model(id=pid, **_columns(pack_model, head, {"name", "title_bgm_id", "source_scene_pack_id"}))
        row.name = unique_pack_name(db, pack_model, str(head.get("name") or noun))
        if kind == "scene":
            title = head.get("title_bgm_id")
            row.title_bgm_id = self._ref(title) if title in own else None
        db.add(row)
        db.flush()
        for item in pack.get("items") or []:
            values = _columns(row_model, item, {ref.data, ref.sha, "bgm_id", "parent_id", "file"})
            new = row_model(id=self.items[item["key"]], pack_id=pid, **values)
            if hasattr(row_model, "bgm_id"):
                new.bgm_id = self._ref(item.get("bgm_id"))
            if hasattr(row_model, "parent_id"):
                parent = item.get("parent_id")
                new.parent_id = self._ref(parent) if parent in own else None
            self.files.put(ref, new, item.get("file"), item.get("mime"))
            db.add(new)
        if kind == "sprite":
            for layout in (pack.get("layouts") or [])[:1]:
                db.add(SpritePackLayout(pack_id=pid, **_columns(SpritePackLayout, layout, {"pack_id"})))
        db.flush()
        getattr(self.created, created_key).append(pid)
        self.created.lines.append(f"新建{noun}「{row.name}」({pack_detail(kind, pack)})")
        return pid

    # ── 认词记录、配对表 ──

    def word_records(self, records: list) -> int:
        db = self.db
        n = 0
        seen: set[tuple[str, str]] = set()
        for rec in records or []:
            if not isinstance(rec, dict) or not isinstance(rec.get("word"), str) or not isinstance(rec.get("item"), str):
                continue
            src = rec.get("list")
            if src == BUILTIN:
                list_ref, item = BUILTIN, rec["item"]
                exists = db.scalar(select(WordRecord.id).where(WordRecord.list_ref == BUILTIN, WordRecord.word == rec["word"]))
                if exists is not None:
                    continue
            elif isinstance(src, str) and src.startswith(PACK_PREFIX) and self.pack_kind.get(src[len(PACK_PREFIX) :]) == "sprite":
                list_ref, item = PACK_PREFIX + self.packs[src[len(PACK_PREFIX) :]], self.items.get(rec["item"])
                if item is None:
                    continue
            else:
                continue
            if (list_ref, rec["word"]) in seen:
                continue
            seen.add((list_ref, rec["word"]))
            row = WordRecord(
                list_ref=list_ref,
                word=rec["word"],
                item=item,
                source=str(rec.get("source") or "migrated"),
                guessed=bool(rec.get("guessed")),
                unstable=bool(rec.get("unstable")),
                score=rec.get("score") if isinstance(rec.get("score"), (int, float)) else None,
            )
            db.add(row)
            if list_ref == BUILTIN:
                db.flush()
                self.created.word_records.append(row.id)
            n += 1
        db.flush()
        return n

    def voice_pairing(self, p: dict, seen: set[tuple]) -> bool:
        """语音的配对表:名单是立绘包(换新编号)或内置名单(照旧),target 是声音,格子的值是这个声音的情绪行"""
        db = self.db
        target_key = p.get("target")
        if self.pack_kind.get(target_key) != "voice":
            return False
        src = p.get("list")
        if src == BUILTIN:
            list_ref = BUILTIN
        elif isinstance(src, str) and src.startswith(PACK_PREFIX) and self.pack_kind.get(src[len(PACK_PREFIX) :]) == "sprite":
            list_ref = PACK_PREFIX + self.packs[src[len(PACK_PREFIX) :]]
        else:
            return False
        card = self.cards.get(p["card"]) if p.get("card") else ""
        if card is None:
            return False
        target = self.packs[target_key]
        scope = ("voice", list_ref, target, card)
        if scope in seen:
            return False
        seen.add(scope)
        row = Pairing(id=_new_id(), follower="voice", list_ref=list_ref, target=target, card_id=card)
        db.add(row)
        cells: set[str] = set()
        for r in p.get("rows") or []:
            if not isinstance(r, dict) or not isinstance(r.get("item"), str):
                continue
            item = r["item"] if list_ref == BUILTIN else self._ref(r["item"])
            if item is None or item in cells:
                continue
            cells.add(item)
            db.add(
                PairingRow(
                    pairing_id=row.id,
                    item=item,
                    value=self._ref(r.get("value")),
                    source=str(r.get("source") or "migrated"),
                    guessed=bool(r.get("guessed")),
                    pending=bool(r.get("pending")),
                    unstable=bool(r.get("unstable")),
                )
            )
        return True

    def pairings(self, pairings: list) -> int:
        db = self.db
        n = 0
        seen: set[tuple] = set()
        for p in pairings or []:
            if isinstance(p, dict) and p.get("follower") == "voice":
                n += self.voice_pairing(p, seen)
                continue
            if not isinstance(p, dict) or p.get("follower") != "cg":
                continue
            src = p.get("list")
            if not isinstance(src, str) or not src.startswith(PACK_PREFIX):
                continue
            pack = self.packs.get(src[len(PACK_PREFIX) :])
            target = self._ref(p.get("target"))
            card = self.cards.get(p["card"]) if p.get("card") else ""
            if pack is None or target is None or card is None:
                continue
            scope = ("cg", PACK_PREFIX + pack, target, card)
            if scope in seen:
                continue
            seen.add(scope)
            row = Pairing(id=_new_id(), follower="cg", list_ref=PACK_PREFIX + pack, target=target, card_id=card)
            db.add(row)
            cells: set[str] = set()
            for r in p.get("rows") or []:
                item = self._ref(r.get("item")) if isinstance(r, dict) else None
                if item is None or item in cells:
                    continue
                cells.add(item)
                db.add(
                    PairingRow(
                        pairing_id=row.id,
                        item=item,
                        value=self._ref(r.get("value")),
                        source=str(r.get("source") or "migrated"),
                        guessed=bool(r.get("guessed")),
                        pending=bool(r.get("pending")),
                        unstable=bool(r.get("unstable")),
                    )
                )
            n += 1
        db.flush()
        return n

    # ── 卡 ──

    def card(self, key: str, body: dict, avatar_rel: str | None, taken: set[str]) -> str:
        db = self.db
        avatar = None
        if avatar_rel:
            data = self.files.read(avatar_rel)
            mime = sniff_image_mime(data) or "image/png"
            avatar = f"data:{mime};base64," + base64.b64encode(data).decode("ascii")
        payload = normalize(body, avatar)
        ext = dict(payload.get("extensions") or {})
        ext.pop("animavn", None)
        payload["extensions"] = ext
        payload["name"] = _unique_name(payload["name"] or "角色", taken)
        card = TavernCard(id=_new_id(), **payload)
        db.add(card)
        db.flush()
        self.cards[key] = card.id
        self.created.cards.append(card.id)
        return card.id


def _kinds_of(binding_rows: list[dict]) -> list[str]:
    out = []
    for b in binding_rows:
        if b["kind"] == "sprite":
            out.append("sprite")
        elif b["kind"] == "scene":
            out += {"": ["bg", "bgm"], "bg": ["bg"], "bgm": ["bgm"]}.get(b.get("parts") or "", [])
        elif b["kind"] == "cg":
            out.append("cg")
    return [k for k in ("sprite", "bg", "bgm", "cg") if k in out]


def _bind(db: Session, r: _Restorer, data: dict) -> None:
    rows = [b for b in data.get("bindings") or [] if b.get("pack") in r.packs and b.get("card") in r.cards]
    for key, card_id in r.cards.items():
        mine = sorted((b for b in rows if b["card"] == key), key=lambda b: (b["kind"], b.get("sort") or 0))
        sprites = [b for b in mine if b["kind"] == "sprite"]
        if sprites:
            primary = next((r.packs[b["pack"]] for b in sprites if b.get("is_primary")), None)
            bindings.replace(db, card_id, bindings.SPRITE, [r.packs[b["pack"]] for b in sprites], primary)
        scenes = [b for b in mine if b["kind"] == "scene"]
        if scenes:
            # 不用 replace_scene:它按「先背景后曲子」重排,背景、BGM 两栏原来的先后会变
            bindings.replace(db, card_id, bindings.SCENE, [r.packs[b["pack"]] for b in scenes])
            parts = {r.packs[b["pack"]]: (b.get("parts") or "") for b in scenes}
            for row in db.scalars(
                select(AssetBinding).where(AssetBinding.card_id == card_id, AssetBinding.kind == bindings.SCENE)
            ).all():
                part = parts.get(row.target_id, "")
                row.parts = part if part in ("", bindings.PART_BG, bindings.PART_BGM) else ""
            db.flush()
        cgs = [b for b in mine if b["kind"] == "cg"]
        if cgs:
            bindings.replace(db, card_id, bindings.CG, [r.packs[b["pack"]] for b in cgs])
        voices = [b for b in mine if b["kind"] == "voice"]
        if voices:
            primary = next((r.packs[b["pack"]] for b in voices if b.get("is_primary")), None)
            bindings.replace(db, card_id, bindings.VOICE, [r.packs[b["pack"]] for b in voices], primary)
    r.created.kinds = _kinds_of(rows)


def _roles(db: Session, r: _Restorer, data: dict) -> None:
    by_card: dict[str, list[dict]] = {}
    for role in data.get("roles") or []:
        by_card.setdefault(role["card"], []).append(role)
    for key, card_id in r.cards.items():
        main = bindings.ensure_main_role(db, card_id)
        for role in by_card.get(key, []):
            fields = _columns(CardRole, role, {"card_id", "is_main", "key", "card"})
            if role.get("is_main"):
                for name, value in fields.items():
                    setattr(main, name, value)
            else:
                db.add(CardRole(id=_new_id(), card_id=card_id, is_main=False, **fields))
    db.flush()


def _state_group(db: Session, r: _Restorer, data: dict) -> None:
    group = data.get("state_group")
    if not group:
        return
    main = r.cards.get(group["row"].get("main_card_id"))
    states = group.get("states") or []
    if main is None or any(s.get("card") not in r.cards for s in states):
        raise BundleError("状态组里有不在角色包里的卡")
    row = CardStateGroup(id=_new_id(), main_card_id=main)
    db.add(row)
    db.flush()
    for s in states:
        db.add(
            CardState(
                card_id=r.cards[s["card"]],
                group_id=row.id,
                name=str(s.get("name") or "")[:40] or "状态",
                sort=int(s.get("sort") or 0),
                show_in_pick=bool(s.get("show_in_pick")),
            )
        )
    db.flush()
    r.created.state_groups.append(row.id)


def _card_prefs(db: Session, r: _Restorer, data: dict) -> int:
    from app.api.app_settings import _KEY_RE  # 同一套键名规则

    n = 0
    for p in data.get("card_prefs") or []:
        key, value = p.get("key"), p.get("value")
        card = r.cards.get(p.get("card"))
        if card is None or not isinstance(key, str) or not key.startswith(PLUGIN_PREFIX) or not _KEY_RE.match(key):
            continue
        if not isinstance(value, dict):
            continue
        value = copy.deepcopy(value)
        if key == IMAGEGEN_KEY and isinstance(value.get("ref"), dict) and value["ref"].get("id") is not None:
            new = r.items.get(value["ref"]["id"])
            if new is None:
                value.pop("ref")
            else:
                value["ref"]["id"] = new
        if db.get(CardPref, (card, key)) is None:
            db.add(CardPref(card_id=card, key=key, value=value))
            n += 1
    db.flush()
    return n


def _preset(db: Session, r: _Restorer, m: Manifest) -> None:
    entry, body = m.data.get("preset"), m.preset
    if not entry or not isinstance(body, dict):
        return
    taken = {n.casefold() for n in db.scalars(select(PromptPreset.name)).all()}
    values = {f: copy.deepcopy(body[f]) for f in PRESET_FIELDS if f in body and f != "name"}
    name = _unique_name(str(body.get("name") or entry.get("name") or "预设")[:200], taken)
    preset = PromptPreset(id=_new_id(), name=name, **values)
    db.add(preset)
    db.flush()
    r.created.presets.append(preset.id)
    cards = [r.cards[c] for c in entry.get("cards") or [] if c in r.cards]
    if cards:
        row = db.get(AppSetting, PRESET_BINDINGS)
        if row is None:
            row = AppSetting(key=PRESET_BINDINGS, value={"cards": {}, "default": None})
            db.add(row)
            r.created.settings.append(PRESET_BINDINGS)
        value = copy.deepcopy(row.value) if isinstance(row.value, dict) else {"cards": {}, "default": None}
        if not isinstance(value.get("cards"), dict):
            value["cards"] = {}
        for c in cards:
            value["cards"][c] = preset.id
        row.value = value
        db.flush()
    names = "、".join(f"「{db.get(TavernCard, c).name}」" for c in cards[:1])
    r.created.lines.append(f"新建预设「{name}」" + (f",绑到了{names}" if names else ""))


def restore_bundle(
    db: Session, folder: Path, manifest: Manifest, *, with_preset: bool, connection_id: str | None = None
) -> Created:
    """照角色包的清单建卡、包、绑定和跟着走的东西;不提交。connection_id:声音挂到哪个语音服务(不给用默认,见文件头)"""
    check_refs(manifest)
    data = manifest.data
    r = _Restorer(db, folder, connection_id)
    packs = [manifest.packs[p["key"]] for p in data.get("packs") or [] if p.get("key") in manifest.packs]
    r.plan_items(packs)
    for pack in packs:
        r.pack(pack)

    taken = {n.casefold() for n in db.scalars(select(TavernCard.name)).all()}
    entries = {e["key"]: e for e in data.get("cards") or []}
    order = [data["main_card"], *[k for k in entries if k != data["main_card"]]]
    for key in order:
        r.card(key, manifest.cards[key], entries[key].get("avatar"), taken)
    # 主卡排第一(撤销时先删主卡,状态卡跟着删);报告里卡写在包前面
    r.created.main_card = r.cards[data["main_card"]]
    states = {s["card"]: s.get("name") for s in (data.get("state_group") or {}).get("states") or []}
    card_lines = []
    for key in order:
        card = db.get(TavernCard, r.cards[key])
        state = f"(状态:{states[key]})" if states.get(key) else ""
        card_lines.append(f"新建角色卡「{card.name}」{state}")
    r.created.lines = card_lines + r.created.lines

    _roles(db, r, data)
    _bind(db, r, data)
    _state_group(db, r, data)
    prefs = _card_prefs(db, r, data)
    words = r.word_records(data.get("word_records") or [])
    pairs = r.pairings(data.get("pairings") or [])
    follows = [f"认词记录 {words} 条" if words else "", f"配对表 {pairs} 张" if pairs else "", f"按卡设置 {prefs} 项" if prefs else ""]
    if any(follows):
        r.created.lines.append("带上了" + "、".join(x for x in follows if x))
    if with_preset:
        _preset(db, r, manifest)
    db.flush()
    return r.created


def restore_pack(db: Session, folder: Path, pack: dict, connection_id: str | None = None) -> Created:
    """照单包的 pack.json 建一个新包(不绑到任何卡);立绘包带认词记录。不提交"""
    r = _Restorer(db, folder, connection_id)
    r.plan_items([pack])
    r.pack(pack)
    if pack["kind"] == "sprite":
        own = PACK_PREFIX + pack["key"]
        words = r.word_records([w for w in pack.get("word_records") or [] if isinstance(w, dict) and w.get("list") == own])
        if words:
            r.created.lines.append(f"带上了认词记录 {words} 条")
    db.flush()
    return r.created
