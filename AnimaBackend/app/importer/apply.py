"""执行导入计划(实施计划第 3 段 B5;设计稿 6.2、6.6):照 classify.py 出的计划,在一个事务里建卡、建包、绑定,
记一条能撤销的导入记录(import_jobs)。

    job = apply_plan(db, tree, plan, tops, decisions, classify, make_current)   # 不提交:调用方提交,出错回滚

- 计划是出计划时存下的那份(暂存目录里的 plan.json),这里不重新认。
- decisions:{组的 key: "new" | "share" | "update"}。重复的包默认 new(另存一份,文件按指纹共用、不多占地方);
  share = 不建、直接绑库里那个。重复的卡默认 new(另存一张);update = 覆盖字段,对话和绑定都留着(改之前的字段
  记进 replaced_cards,撤销时改回去);share = 用库里那张、不改它。没重复的组 share / update 都当 new。
- 绑定:新卡的第一套立绘设为当前;原有的卡只「再挂一套」,make_current 才换成这次的第一套(原来一套都没有的,
  第一套就是当前)。场景包按内容绑 parts(只有背景 → bg、只有曲子 → bgm、都有 → 两边),接在已有的后面;
  CG 包接在后面。加到原有卡上的绑定记进 bound,撤销时拿掉。
- 包名撞了库里的加「 2」「 3」(三种包的名字各自不许重复,同各 router 的 _clean_pack_name)。
- 图超过 8 MB、曲子(转码以后)超过 16 MB 的跳过,报告里写一句;一个包里的文件全跳过就不建这个包。
- 立绘逐张找脸(线程池);曲子按 audio.py 存(要转码的出计划时已经转好)。
- classify:{暂存路径: sprite / bg / bgm / cg / skip}:确认框里就给认不出的文件选了类型的,导完照 ImportContext.classify
  归进这次建的同类包(没有就新建「角色 · 补充」绑到这次的卡);导完再在提示条里认领的也走它(jobs.py)。

报告(report)一句一句的中文:建了什么(张数、别名个数、默认差分……)、绑到了哪张卡、计划里跳过的(classify.py 的
skipped)、太大 / 坏掉没导的文件、找脸的结果。「N 个文件没认出来」那句不存,取的时候按还剩几个现算(report_of)。
"""

from __future__ import annotations

import copy
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import bindings
from app.api.scenes import MAX_AUDIO_BYTES
from app.assets.common import MAX_IMAGE_BYTES, clean_aliases, clean_label, sniff_image_mime, unique_pack_name
from app.importer import aliases as alias_dict
from app.importer import audio
from app.importer.classify import ImportPlan, PlanGroup, file_label
from app.importer.sniff import kind_of
from app.importer.staging import StagedTree, _safe_part
from app.models import CgAsset, CgPack, ImportJob, PackSprite, SceneAsset, ScenePack, SpritePack, TavernCard
from app.schemas import TavernCardCreate
from app.sprite_faces import scan
from app.storage import refs

DECISIONS = ("new", "share", "update")
CLASSIFY_KINDS = ("sprite", "bg", "bgm", "cg", "skip")
CARD_FIELDS = tuple(TavernCardCreate.model_fields)
FACE_WORKERS = 4
# 提示条里「已自动绑定配套的……」按这个顺序列
SPRITE_WORD, BG_WORD, BGM_WORD, CG_WORD = KINDS_SHOWN = ("立绘", "背景", "BGM", "CG")
KIND_WORD = {"sprite": SPRITE_WORD, "bg": BG_WORD, "bgm": BGM_WORD, "cg": CG_WORD}
SCENE_NOUN = {"bg": "场景名", "bgm": "音乐名"}
PACK_NOUN = {"sprite": "立绘包", "scene": "场景包", "cg": "CG 包"}


def empty_created() -> dict:
    return {"cards": [], "sprite_packs": [], "scene_packs": [], "cg_packs": []}


def _mb(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


def _name(path: str) -> str:
    return PurePosixPath(path).name


def _unique_label(base: str, taken: set[str]) -> str:
    """包里没被名字 / 别名占掉的名字:X、X 2…;用了就记进 taken"""
    name, n = base, 2
    while name.casefold() in taken:
        name, n = f"{base} {n}", n + 1
    taken.add(name.casefold())
    return name


def _taken(rows) -> set[str]:
    return {w.casefold() for r in rows for w in [r.label, *(r.aliases or [])]}


@dataclass
class _Touched:
    """一张卡这次被绑了什么(报告里「绑到……」那句)"""

    sprites: int = 0
    bg: bool = False
    bgm: bool = False
    cg: int = 0
    was: str | None = None  # 原来的当前立绘包
    now: str | None = None  # 这次换成的当前立绘包(没换是 None)


@dataclass
class ImportContext:
    """一次导入建了什么、要记进 import_jobs 的那些;执行计划(apply_plan)和导完认领文件(jobs.classify_file)共用"""

    db: Session
    tree: StagedTree
    card_id: str | None = None
    created: dict = field(default_factory=empty_created)
    bound: list = field(default_factory=list)
    replaced: dict = field(default_factory=dict)
    unknown: list = field(default_factory=list)
    meta: dict = field(default_factory=lambda: {"main": "", "kinds": [], "has_packs": False})
    make_current: bool = False
    lines: list = field(default_factory=list)  # 建了什么
    problems: list = field(default_factory=list)  # 太大 / 坏掉没导的
    faces: list = field(default_factory=list)  # 找脸
    unbound: list = field(default_factory=list)  # 没绑到卡的包
    touched: dict = field(default_factory=dict)  # 卡 → _Touched
    _current_set: set = field(default_factory=set)
    _no_face_tool: bool = False
    _skipped: int = 0

    @classmethod
    def of_job(cls, db: Session, tree: StagedTree, job: ImportJob) -> ImportContext:
        return cls(
            db=db,
            tree=tree,
            card_id=job.card_id,
            created={**empty_created(), **copy.deepcopy(job.created or {})},
            bound=copy.deepcopy(job.bound or []),
            replaced=copy.deepcopy(job.replaced_cards or {}),
            unknown=list(job.unknown or []),
            meta={"main": "", "kinds": [], "has_packs": False, **copy.deepcopy(job.meta or {})},
        )

    def save(self, job: ImportJob) -> None:
        """写回导入记录(JSON 列整个换新的,SQLAlchemy 才认得出改了)"""
        job.card_id = self.card_id
        job.created = copy.deepcopy(self.created)
        job.bound = copy.deepcopy(self.bound)
        job.replaced_cards = copy.deepcopy(self.replaced)
        job.unknown = list(self.unknown)
        job.meta = copy.deepcopy(self.meta)

    def new_lines(self) -> list[str]:
        skip = [f"不要的 {self._skipped} 个文件没导入"] if self._skipped else []
        return self.lines + self.binding_lines() + self.unbound + skip

    # ── 读文件 ──

    def _image(self, path: str) -> tuple[bytes, str] | None:
        file = self.tree.path(path)
        size = file.stat().st_size
        if size > MAX_IMAGE_BYTES:
            limit = MAX_IMAGE_BYTES // 1024 // 1024
            self.problems.append(f"「{_name(path)}」太大了({_mb(size)},图的上限 {limit} MB),没导入")
            return None
        data = file.read_bytes()
        mime = sniff_image_mime(data)
        if mime is None:
            self.problems.append(f"「{_name(path)}」不是 PNG / JPEG / WebP / GIF 图片,没导入")
            return None
        return data, mime

    def _audio(self, path: str) -> tuple[bytes, str, bool] | None:
        source, mime = audio.stored_file(self.tree, path)
        converted = source != self.tree.path(path)
        size = source.stat().st_size
        if size > MAX_AUDIO_BYTES:
            limit = MAX_AUDIO_BYTES // 1024 // 1024
            after = "转成 m4a 以后还有 " if converted else ""
            self.problems.append(f"「{_name(path)}」太大了({after}{_mb(size)},曲子的上限 {limit} MB),没导入")
            return None
        if not mime.startswith("audio/"):
            self.problems.append(f"「{_name(path)}」不是能放的音频,没导入")
            return None
        return source.read_bytes(), mime, converted

    # ── 找脸 ──

    def _scan(self, datas: list[bytes]) -> list[dict | None]:
        if not datas:
            return []
        with ThreadPoolExecutor(max_workers=min(FACE_WORKERS, len(datas))) as pool:
            return list(pool.map(scan, datas))

    def _face_note(self, pack_name: str, faces: list[dict | None], siblings: list[dict | None] = ()) -> None:
        """这批立绘里没找到脸的写一句;同画布大小的图(这批和 siblings)有脸的,游戏里借它的位置"""
        if any(f is None for f in faces):
            if not self._no_face_tool:
                self._no_face_tool = True
                self.faces.append("服务器上没装 OpenCV,找不了脸;立绘先按撑满高度、居中摆")
            return

        def canvas(f: dict | None):
            if not f or f.get("width") is None or f.get("height") is None:
                return None
            return f["width"], f["height"]

        misses = [f for f in faces if not f.get("face")]
        if not misses:
            return
        found = {canvas(f) for f in [*faces, *siblings] if f and f.get("face") and canvas(f)}
        borrowed = sum(1 for f in misses if canvas(f) in found)
        if borrowed == len(misses):
            tail = "按同尺寸的图借了位置"
        elif borrowed == 0:
            tail = "先按撑满高度、居中摆"
        else:
            tail = f"{borrowed} 张按同尺寸的图借了位置,其余先按撑满高度、居中摆"
        self.faces.append(f"「{pack_name}」{len(misses)} 张没找到脸,{tail}")

    # ── 卡 ──

    def card_group(self, g: PlanGroup, decision: str) -> str:
        db = self.db
        payload = TavernCardCreate(**g.detail.get("card", {})).model_dump()
        if not payload["name"].strip():
            payload["name"] = g.name
        dup = db.get(TavernCard, g.duplicate_of["id"]) if g.duplicate_of else None
        if dup is not None and decision == "update":
            self.replaced.setdefault(dup.id, {f: copy.deepcopy(getattr(dup, f)) for f in CARD_FIELDS})
            for f, value in payload.items():
                setattr(dup, f, value)
            db.flush()
            self.lines.append(f"更新了角色卡「{dup.name}」的资料(对话和绑定都留着)")
            return dup.id
        if dup is not None and decision == "share":
            self.lines.append(f"角色卡「{dup.name}」库里已经有了,没改它,素材挂到它上面")
            return dup.id
        card = TavernCard(**payload)
        db.add(card)
        db.flush()
        self.created["cards"].append(card.id)
        greetings = (1 if card.first_mes.strip() else 0) + len(card.alternate_greetings or [])
        book = len((card.character_book or {}).get("entries") or [])
        extra = [f"开场白 {greetings} 条" if greetings else "", f"世界书 {book} 条" if book else ""]
        text = f"新建角色卡「{card.name}」"
        if any(extra):
            text += f"({' · '.join(x for x in extra if x)})"
        if g.duplicate_of:
            text += ",库里已经有一张一样的,另存了一张"
        self.lines.append(text)
        return card.id

    # ── 绑定 ──

    def _new_card(self, card_id: str) -> bool:
        return card_id in self.created["cards"]

    def _kind(self, word: str) -> None:
        kinds = set(self.meta.get("kinds") or []) | {word}
        self.meta["kinds"] = [k for k in KINDS_SHOWN if k in kinds]

    def _touch(self, card_id: str) -> _Touched:
        return self.touched.setdefault(card_id, _Touched())

    def bind_sprite(self, card_id: str, pack_id: str) -> None:
        db = self.db
        ids = bindings.targets(db, card_id, bindings.SPRITE)
        was = bindings.primary(db, card_id, bindings.SPRITE)
        added = pack_id not in ids
        current = was
        # 一套都没有时挂上的第一套就是当前(新卡都是这样);原有的卡勾了「挂上以后直接换成这套」才换成这次的第一套
        if was is None or (self.make_current and card_id not in self._current_set):
            current = pack_id
            self._current_set.add(card_id)
        self._kind(SPRITE_WORD)
        touched = self._touch(card_id)
        touched.sprites += 1
        if touched.was is None and touched.now is None:
            touched.was = was
        if not added and current == was:
            return
        bindings.replace(db, card_id, bindings.SPRITE, [*ids, pack_id] if added else ids, current)
        if current != was:
            touched.now = current
        if not self._new_card(card_id):
            self.bound.append(
                {"card_id": card_id, "kind": bindings.SPRITE, "target_id": pack_id, "added": added, "previous_primary": was}
            )

    def bind_scene(self, card_id: str, pack_id: str, bg: bool, bgm: bool) -> None:
        db = self.db
        parts = bindings.scene_parts(db, card_id)
        add_bg = bg and pack_id not in parts["bg"]
        add_bgm = bgm and pack_id not in parts["bgm"]
        touched = self._touch(card_id)
        if bg:
            self._kind(BG_WORD)
            touched.bg = True
        if bgm:
            self._kind(BGM_WORD)
            touched.bgm = True
        if not (add_bg or add_bgm):
            return
        bindings.replace_scene(
            db, card_id, parts["bg"] + ([pack_id] if add_bg else []), parts["bgm"] + ([pack_id] if add_bgm else [])
        )
        if not self._new_card(card_id):
            which = "" if add_bg and add_bgm else (bindings.PART_BG if add_bg else bindings.PART_BGM)
            self.bound.append({"card_id": card_id, "kind": bindings.SCENE, "target_id": pack_id, "parts": which})

    def bind_cg(self, card_id: str, pack_id: str) -> None:
        ids = bindings.targets(self.db, card_id, bindings.CG)
        self._kind(CG_WORD)
        self._touch(card_id).cg += 1
        if pack_id in ids:
            return
        bindings.replace(self.db, card_id, bindings.CG, [*ids, pack_id])
        if not self._new_card(card_id):
            self.bound.append({"card_id": card_id, "kind": bindings.CG, "target_id": pack_id})

    def binding_lines(self) -> list[str]:
        out = []
        for card_id, t in self.touched.items():
            card = self.db.get(TavernCard, card_id)
            if card is None:
                continue
            parts = [
                f"立绘 {t.sprites} 套" if t.sprites else "",
                "背景" if t.bg else "",
                "BGM" if t.bgm else "",
                f"CG {t.cg} 个包" if t.cg else "",
            ]
            what = "、".join(p for p in parts if p)
            if self._new_card(card_id):
                out.append(f"绑到新卡「{card.name}」:{what}")
                continue
            text = f"绑到原有的卡「{card.name}」:{what}"
            if t.now is not None:
                verb = "换成了" if t.was else "设为"
                text += f";当前服装{verb}「{self._pack_name(SpritePack, t.now)}」"
            elif t.sprites and t.was:
                text += f";当前服装还是「{self._pack_name(SpritePack, t.was)}」(勾「挂上以后直接换成这套」或在素材页「设为当前服装」才换)"
            out.append(text)
        return out

    def _pack_name(self, model, pack_id: str) -> str:
        pack = self.db.get(model, pack_id)
        return pack.name if pack is not None else "(已删除)"

    # ── 包 ──

    def _shared(self, g: PlanGroup, model, decision: str):
        """选了「共用已有的」:库里那个包(还在的话)"""
        if decision != "share" or not g.duplicate_of:
            return None
        return self.db.get(model, g.duplicate_of["id"])

    @staticmethod
    def _renamed(planned: str, actual: str) -> str:
        return f"(库里已经有「{planned}」,改叫「{actual}」)" if planned != actual else ""

    @staticmethod
    def _copied(g: PlanGroup) -> str:
        if not g.duplicate_of:
            return ""
        return f",和库里的「{g.duplicate_of['name']}」一模一样,另存了一份(文件共用,不多占地方)"

    def _not_bound(self, kind: str, name: str) -> None:
        self.unbound.append(f"{PACK_NOUN[kind]}「{name}」没绑到角色卡,之后可以在卡编辑器的素材页挂上")

    def create_sprite_pack(
        self, name: str, files: list[str], labels: dict, alias_map: dict
    ) -> tuple[SpritePack, list[PackSprite]] | None:
        db = self.db
        rows = [(path, *got) for path in files if (got := self._image(path)) is not None]
        if not rows:
            return None
        pack = SpritePack(name=unique_pack_name(db, SpritePack, name), description="")
        db.add(pack)
        db.flush()
        faces = self._scan([data for _, data, _ in rows])
        out = []
        for i, ((path, data, mime), face) in enumerate(zip(rows, faces)):
            label = clean_label(labels.get(path) or file_label(path, "差分"))
            sprite = PackSprite(
                pack_id=pack.id,
                label=label,
                aliases=clean_aliases(alias_map.get(label, []), label),
                description="",
                sort=i,
                face_scan=face,
            )
            refs.save(refs.SPRITE, sprite, data, mime, db)
            sprite.mime = mime
            db.add(sprite)
            out.append(sprite)
        db.flush()
        self.created["sprite_packs"].append(pack.id)
        self.meta["has_packs"] = True
        self._face_note(pack.name, faces)
        return pack, out

    def sprite_group(self, g: PlanGroup, decision: str, owner: str | None) -> None:
        shared = self._shared(g, SpritePack, decision)
        if shared is not None:
            self.lines.append(f"立绘包「{g.name}」和库里的「{shared.name}」一模一样,直接共用")
            self.meta["has_packs"] = True
            if owner:
                self.bind_sprite(owner, shared.id)
            return
        made = self.create_sprite_pack(g.name, g.files, g.detail.get("labels", {}), g.detail.get("aliases", {}))
        if made is None:
            self.problems.append(f"立绘包「{g.name}」里的图都没导入,这个包没建")
            return
        pack, rows = made
        aliases = sum(len(r.aliases) for r in rows)
        text = f"立绘包「{pack.name}」{len(rows)} 张"
        if aliases:
            text += f",配上中文别名 {aliases} 个"
        text += f",默认差分 {rows[0].label}{self._copied(g)}{self._renamed(g.name, pack.name)}"
        self.lines.append(text)
        if owner:
            self.bind_sprite(owner, pack.id)
        else:
            self._not_bound("sprite", pack.name)

    def _scene_asset(self, pack: ScenePack, kind: str, label: str, data: bytes, mime: str, sort: int) -> SceneAsset:
        asset = SceneAsset(
            pack_id=pack.id, kind=kind, label=clean_label(label, SCENE_NOUN[kind]), aliases=[], description="", sort=sort
        )
        refs.save(refs.SCENE_ASSET, asset, data, mime, self.db)
        asset.mime = mime
        asset.size = len(data)
        self.db.add(asset)
        return asset

    def scene_group(self, g: PlanGroup, decision: str, owner: str | None) -> None:
        db = self.db
        shared = self._shared(g, ScenePack, decision)
        if shared is not None:
            self.lines.append(f"场景包「{g.name}」和库里的「{shared.name}」一模一样,直接共用")
            self.meta["has_packs"] = True
            if owner:
                kinds = set(db.scalars(select(SceneAsset.kind).where(SceneAsset.pack_id == shared.id)).all())
                self.bind_scene(owner, shared.id, "bg" in kinds, "bgm" in kinds)
            return
        bg_rows = [(path, *got) for path in g.detail.get("bg", []) if (got := self._image(path)) is not None]
        bgm_rows = [(path, *got) for path in g.detail.get("bgm", []) if (got := self._audio(path)) is not None]
        if not bg_rows and not bgm_rows:
            self.problems.append(f"场景包「{g.name}」里的文件都没导入,这个包没建")
            return
        pack = ScenePack(name=unique_pack_name(db, ScenePack, g.name), description="")
        db.add(pack)
        db.flush()
        labels = g.detail.get("labels", {})
        for i, (path, data, mime) in enumerate(bg_rows):
            self._scene_asset(pack, "bg", labels.get(path) or file_label(path, "背景"), data, mime, i)
        music: dict[str, SceneAsset] = {}
        for i, (path, data, mime, _) in enumerate(bgm_rows):
            music[path] = self._scene_asset(pack, "bgm", labels.get(path) or file_label(path, "曲子"), data, mime, i)
        db.flush()
        cover = music.get(g.detail.get("cover") or "")
        if cover is not None:
            pack.title_bgm_id = cover.id
            db.flush()
        self.created["scene_packs"].append(pack.id)
        self.meta["has_packs"] = True
        what = [f"背景 {len(bg_rows)} 张" if bg_rows else "", f"曲子 {len(bgm_rows)} 首" if bgm_rows else ""]
        text = f"场景包「{pack.name}」" + "、".join(x for x in what if x)
        if cover is not None:
            text += f",封面曲 {cover.label}"
        self.lines.append(text + self._copied(g) + self._renamed(g.name, pack.name))
        converted = sum(1 for *_, conv in bgm_rows if conv)
        if converted:
            self.lines.append(f"{converted} 首 WAV / OGG / FLAC 转成了 m4a(iPhone 也能放)")
        if owner:
            self.bind_scene(owner, pack.id, bool(bg_rows), bool(bgm_rows))
        else:
            self._not_bound("scene", pack.name)

    def _cg_row(
        self, pack: CgPack, parent: CgAsset | None, item: dict, data: bytes, mime: str, sort: int
    ) -> CgAsset:
        noun = "表情名" if parent is not None else "CG 名"
        label = clean_label(item["label"], noun)
        row = CgAsset(
            pack_id=pack.id,
            parent_id=parent.id if parent is not None else None,
            label=label,
            aliases=clean_aliases(item.get("aliases") or [], label, noun),
            description=(item.get("desc") or "") if parent is None else "",
            forms=list(item.get("forms") or []) if parent is None else [],
            focus_x=int(item["focus"]) if parent is None and isinstance(item.get("focus"), int) else 50,
            sort=sort,
        )
        refs.save(refs.CG_ASSET, row, data, mime, self.db)
        row.mime = mime
        row.size = len(data)
        self.db.add(row)
        self.db.flush()
        return row

    def cg_group(self, g: PlanGroup, decision: str, owner: str | None) -> None:
        db = self.db
        shared = self._shared(g, CgPack, decision)
        if shared is not None:
            self.lines.append(f"CG 包「{g.name}」和库里的「{shared.name}」一模一样,直接共用")
            self.meta["has_packs"] = True
            if owner:
                self.bind_cg(owner, shared.id)
            return
        ready = []
        for comp in g.detail.get("compositions", []):
            base = self._image(comp["file"])
            if base is None:
                if comp.get("variants"):
                    self.problems.append(f"CG「{comp['label']}」的图没导入,它的 {len(comp['variants'])} 张差分也跳过了")
                continue
            variants = [(v, got) for v in comp.get("variants") or [] if (got := self._image(v["file"])) is not None]
            ready.append((comp, base, variants))
        if not ready:
            self.problems.append(f"CG 包「{g.name}」里的图都没导入,这个包没建")
            return
        pack = CgPack(name=unique_pack_name(db, CgPack, g.name), description="", generated=False)
        db.add(pack)
        db.flush()
        variant_count = 0
        for k, (comp, (data, mime), variants) in enumerate(ready):
            row = self._cg_row(pack, None, comp, data, mime, k)
            for j, (v, (vdata, vmime)) in enumerate(variants):
                self._cg_row(pack, row, v, vdata, vmime, j)
                variant_count += 1
        self.created["cg_packs"].append(pack.id)
        self.meta["has_packs"] = True
        text = f"CG 包「{pack.name}」{len(ready)} 个构图"
        if variant_count:
            text += f"、{variant_count} 张差分"
        self.lines.append(text + self._copied(g) + self._renamed(g.name, pack.name))
        if owner:
            self.bind_cg(owner, pack.id)
        else:
            self._not_bound("cg", pack.name)

    # ── 认领没认出来的文件 ──

    def _extra_name(self) -> str:
        """「角色 · 补充」:角色 = 这次的卡名;没有卡就叫「补充」"""
        card = self.db.get(TavernCard, self.card_id) if self.card_id else None
        name = card.name.strip() if card is not None else ""
        return f"{name} · 补充" if name else "补充"

    def _first(self, model, key: str):
        for pid in self.created.get(key, []):
            pack = self.db.get(model, pid)
            if pack is not None:
                return pack
        return None

    def classify(self, path: str, kind: str) -> None:
        """一个没认出来的暂存文件归进这次建的同类包;没有就新建「角色 · 补充」绑到这次的卡。kind = skip 就是不要了"""
        if path not in self.unknown:
            raise HTTPException(400, f"「{path}」不在没认出来的文件里")
        if kind not in CLASSIFY_KINDS:
            raise HTTPException(400, f"不认识的类型:{kind}(只能是立绘 / 背景 / BGM / CG,或者不要)")
        if kind == "skip":
            self.unknown.remove(path)
            self._skipped += 1
            return
        found = kind_of(self.tree.path(path))
        if kind == "bgm" and found != "audio":
            raise HTTPException(400, f"「{_name(path)}」不是音频,不能当 BGM")
        if kind != "bgm" and found not in ("image", "card_png"):
            raise HTTPException(400, f"「{_name(path)}」不是图片,不能当{KIND_WORD[kind]}")
        if kind == "sprite":
            self._classify_sprite(path)
        elif kind == "cg":
            self._classify_cg(path)
        else:
            self._classify_scene(path, kind)
        self.unknown.remove(path)

    def _classify_sprite(self, path: str) -> None:
        db = self.db
        pack = self._first(SpritePack, "sprite_packs")
        if pack is None:
            label = file_label(path, "差分")
            made = self.create_sprite_pack(self._extra_name(), [path], {}, {label: alias_dict.chinese_aliases(label)})
            if made is None:
                return
            pack = made[0]
            self.lines.append(f"「{_name(path)}」归进了新的立绘包「{pack.name}」")
            if self.card_id:
                self.bind_sprite(self.card_id, pack.id)
            return
        got = self._image(path)
        if got is None:
            return
        data, mime = got
        rows = db.scalars(select(PackSprite).where(PackSprite.pack_id == pack.id)).all()
        taken = _taken(rows)
        label = _unique_label(file_label(path, "差分"), taken)
        extra = [w for w in alias_dict.chinese_aliases(label) if w.casefold() not in taken]
        last = db.scalar(select(func.max(PackSprite.sort)).where(PackSprite.pack_id == pack.id))
        face = scan(data)
        sprite = PackSprite(
            pack_id=pack.id,
            label=label,
            aliases=clean_aliases(extra, label),
            description="",
            sort=(last + 1) if last is not None else 0,
            face_scan=face,
        )
        refs.save(refs.SPRITE, sprite, data, mime, db)
        sprite.mime = mime
        db.add(sprite)
        db.flush()
        self._face_note(pack.name, [face], [r.face_scan for r in rows])
        self.lines.append(f"「{_name(path)}」归进了立绘包「{pack.name}」")

    def _classify_scene(self, path: str, kind: str) -> None:
        db = self.db
        packs = [p for pid in self.created.get("scene_packs", []) if (p := db.get(ScenePack, pid)) is not None]

        def has(pack: ScenePack) -> bool:
            return db.scalar(select(SceneAsset.id).where(SceneAsset.pack_id == pack.id, SceneAsset.kind == kind).limit(1)) is not None

        pack = next((p for p in packs if has(p)), packs[0] if packs else None)
        if kind == "bg":
            got = self._image(path)
            converted = False
        else:
            got = self._audio(path)
            converted = bool(got and got[2])
        if got is None:
            return
        data, mime = got[0], got[1]
        fresh = pack is None
        if fresh:
            pack = ScenePack(name=unique_pack_name(db, ScenePack, self._extra_name()), description="")
            db.add(pack)
            db.flush()
            self.created["scene_packs"].append(pack.id)
            self.meta["has_packs"] = True
        rows = db.scalars(
            select(SceneAsset).where(SceneAsset.pack_id == pack.id, SceneAsset.kind == kind, SceneAsset.parent_id.is_(None))
        ).all()
        label = _unique_label(file_label(path, "背景" if kind == "bg" else "曲子"), _taken(rows))
        sort = max((r.sort for r in rows), default=-1) + 1
        self._scene_asset(pack, kind, label, data, mime, sort)
        db.flush()
        what = "背景" if kind == "bg" else "BGM"
        text = f"「{_name(path)}」归进了{'新的' if fresh else ''}场景包「{pack.name}」({what})"
        self.lines.append(text + (",转成了 m4a" if converted else ""))
        # 新建的补充包绑到这次的卡;已经绑在这次的卡上的包,把这一边也绑上
        if self.card_id and (fresh or pack.id in bindings.targets(db, self.card_id, bindings.SCENE)):
            self.bind_scene(self.card_id, pack.id, kind == "bg", kind == "bgm")

    def _classify_cg(self, path: str) -> None:
        db = self.db
        pack = self._first(CgPack, "cg_packs")
        got = self._image(path)
        if got is None:
            return
        fresh = pack is None
        if fresh:
            pack = CgPack(name=unique_pack_name(db, CgPack, self._extra_name()), description="", generated=False)
            db.add(pack)
            db.flush()
            self.created["cg_packs"].append(pack.id)
            self.meta["has_packs"] = True
        rows = db.scalars(select(CgAsset).where(CgAsset.pack_id == pack.id, CgAsset.parent_id.is_(None))).all()
        label = _unique_label(file_label(path, "CG"), _taken(rows))
        sort = max((r.sort for r in rows), default=-1) + 1
        self._cg_row(pack, None, {"label": label}, got[0], got[1], sort)
        self.lines.append(f"「{_name(path)}」归进了{'新的' if fresh else ''} CG 包「{pack.name}」")
        if fresh and self.card_id:
            self.bind_cg(self.card_id, pack.id)


# ── 执行计划 ──


def headline(plan: ImportPlan, tops: list[list]) -> tuple[str, str]:
    """(导入记录的一行摘要「刻晴.png + 3 个文件夹」, 提示条里的主文件名)。
    tops:拖进来的最上面一层 [[名字, 是不是文件夹], …](出计划时按上传的路径记下的)"""
    card = next((g for g in plan.groups if g.type == "card"), None)
    main_top = None
    main = None
    if card is not None and card.files:
        seg = card.files[0].split("/")[0].casefold()
        for t in tops:
            name = _safe_part(t[0]).casefold()
            if name == seg or PurePosixPath(name).stem == seg:
                main_top = t
                break
        main = _name(card.files[0])
    if main_top is None and tops:
        main_top = tops[0]
    if main is None:
        main = main_top[0] if main_top else "导入"
    others = [t for t in tops if t is not main_top]
    folders = sum(1 for t in others if t[1])
    files = len(others) - folders
    rest = "、".join(x for x in (f"{folders} 个文件夹" if folders else "", f"{files} 个文件" if files else "") if x)
    title = (main_top[0] if main_top else main) + (f" + {rest}" if rest else "")
    return title[:200], main


def apply_plan(
    db: Session,
    tree: StagedTree,
    plan: ImportPlan,
    tops: list[list],
    decisions: dict[str, str],
    classify: dict[str, str],
    make_current: bool,
) -> ImportJob:
    """照计划建卡、建包、绑定,记一条导入记录;不提交。请求本身不对(选择、路径、拖到的卡不在了)抛 HTTPException"""
    groups = {g.key: g for g in plan.groups}
    for key, decision in decisions.items():
        if key not in groups:
            raise HTTPException(400, f"导入计划里没有「{key}」这一组")
        if decision not in DECISIONS:
            raise HTTPException(400, f"不认识的选择:{decision}(只能是 new / share / update)")
        if decision == "update" and groups[key].type != "card":
            raise HTTPException(400, "只有角色卡能选「更新这张」")
    for path, kind in classify.items():
        if path not in plan.unknown:
            raise HTTPException(400, f"「{path}」不在没认出来的文件里")
        if kind not in CLASSIFY_KINDS:
            raise HTTPException(400, f"不认识的类型:{kind}(只能是立绘 / 背景 / BGM / CG,或者不要)")
    target = plan.target_card_id
    if target and db.get(TavernCard, target) is None:
        raise HTTPException(404, "拖到的那张卡已经不在了")

    title, main = headline(plan, tops)
    ctx = ImportContext(db=db, tree=tree, unknown=list(plan.unknown), make_current=make_current)
    ctx.meta["main"] = main
    card_ids: dict[str, str] = {}
    for g in plan.groups:
        if g.type == "card":
            card_ids[g.key] = ctx.card_group(g, decisions.get(g.key, "new"))
    ctx.card_id = next(iter(card_ids.values()), None) or target
    handlers = {"sprite_pack": ctx.sprite_group, "scene_pack": ctx.scene_group, "cg_pack": ctx.cg_group}
    for g in plan.groups:
        if g.type == "card":
            continue
        owner = target if g.owner == "target" else card_ids.get(g.owner or "")
        handlers[g.type](g, decisions.get(g.key, "new"), owner)
    for path in [p for p in plan.unknown if p in classify]:
        ctx.classify(path, classify[path])

    job = ImportJob(id=plan.id, title=title, target_card_id=target, status="done")
    ctx.save(job)
    job.report = ctx.new_lines() + list(plan.skipped) + ctx.problems + ctx.faces
    db.add(job)
    db.flush()
    return job


# ── 给前端的样子 ──


def notice_of(job: ImportJob) -> dict:
    """素材页顶上那一行提示(10-15 定:不弹窗):{title, detail, unknown}"""
    meta = job.meta or {}
    kinds = [k for k in KINDS_SHOWN if k in (meta.get("kinds") or [])]
    title = f"{meta.get('main') or '导入'} 导入完成"
    if kinds:
        title += " · 已自动绑定配套的" + "、".join(kinds)
    elif meta.get("has_packs"):
        title += " · 还没绑定到角色卡"
    return {"title": title, "detail": detail_of(job), "unknown": list(job.unknown or [])}


def detail_of(job: ImportJob) -> str:
    """「新建 角色卡 1 张、立绘包 2 个;更新 角色卡 1 张」"""
    c = {**empty_created(), **(job.created or {})}
    made = [
        f"角色卡 {len(c['cards'])} 张" if c["cards"] else "",
        f"立绘包 {len(c['sprite_packs'])} 个" if c["sprite_packs"] else "",
        f"场景包 {len(c['scene_packs'])} 个" if c["scene_packs"] else "",
        f"CG 包 {len(c['cg_packs'])} 个" if c["cg_packs"] else "",
    ]
    out = []
    if any(made):
        out.append("新建 " + "、".join(x for x in made if x))
    if job.replaced_cards:
        out.append(f"更新 角色卡 {len(job.replaced_cards)} 张")
    return ";".join(out) or "没有新建东西,用的都是库里已有的"


def report_of(job: ImportJob) -> list[str]:
    """存下的报告,加上「还有几个文件没认出来」(按现在还剩的算)"""
    lines = list(job.report or [])
    left = list(job.unknown or [])
    if left:
        names = "、".join(_name(p) for p in left[:3]) + (" 等" if len(left) > 3 else "")
        lines.append(f"{len(left)} 个文件没认出来:{names},在提示条里点「查看」选它们是什么")
    return lines


def result_of(job: ImportJob) -> dict:
    """执行导入、认领文件的返回:{job_id, card_id, notice, report, created}。
    created = 这次新建的卡和包的编号 {cards, sprite_packs, scene_packs, cg_packs},按建的先后(共用库里的不算);
    没有卡可开时前端照它打开素材管理页、选中第一个新建的包"""
    created = {key: list(ids) for key, ids in {**empty_created(), **(job.created or {})}.items()}
    return {"job_id": job.id, "card_id": job.card_id, "notice": notice_of(job), "report": report_of(job), "created": created}
