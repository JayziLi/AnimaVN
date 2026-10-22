"""导入计划(实施计划第 3 段 B4;设计稿 1.5、1.7、6.3):照暂存目录里的文件,定下这次导入要建什么。

    plan = build_plan(tree, db, target_card_id, forced_kind)

一组(PlanGroup)= 导入后会建出来的一样东西:一张卡、一个立绘包、一个场景包或一个 CG 包。组里写着用哪些暂存文件、
建议的名字(撞名时 apply 再加「 2」)、绑到哪张卡(owner:另一个卡组的 key、"target" = 拖到的那张卡、None = 不绑)、
建的时候要的细节(detail),库里有一模一样的就填 duplicate_of。认不出来的文件进 unknown(导完能在提示条里点选类型),
跳过的写成一句一句的说明进 skipped。这里只读库(找重复、拖到的卡叫什么),什么都不写。

规则(按顺序;tests/test_importer_classify.py 每条一个用例):
1. 跳过「.」「_」开头的文件和文件夹(__MACOSX 不提);不是图 / 音频 / 卡 / 清单的文件只计数;其中名字是图片
   (.png / .jpg …)、内容不是的单独说一句「N 张图打不开」(Chub 的表情 zip 里有时是起名 joy.png 的 HTML 错误页);
   声音的参考(refs.json、名字像「语音参考」或装着【情绪】原文.wav 的文件夹)记一句「声音包这次不认」。
2. 每个卡文件一组。卡所在的文件夹里只有这一张卡时,下面的素材都归它;整批只有一张卡时全部归它;
   都没有卡时归拖到的卡,也没有就不绑。两张卡都够不着的素材不猜,不绑。
3. 文件夹按名字认(不分大小写,全角半角都认,folder_kind):立绘 / 立绘(X) / expressions / sprites / 表情(包)
   → 立绘;背景 / backgrounds / bgs → 背景;bgm / music / 音乐 / 曲子 / BGM候选 → 曲子;cg / cgs / events → CG;
   放着 CG 清单(import.json)的文件夹也是 CG。立绘文件夹下的每个图片子文件夹是一套服装(包一层的 Chub 表情 zip
   也是这样:expressions/<英文名>/joy.png);CG 文件夹下的子文件夹是一个构图(默认.* 是构图本身,没有就取
   排第一的那张,其余是差分),直接放着的图各是一个构图。
4. 认不出名字的文件夹、根上散着的图:六成以上的名字(去掉 NN_ 前缀、-1 / .xxx 后缀)在表情词表里(aliases.py)
   → 立绘,不然进 unknown;散着的音频 → 曲子。拖到某一栏(forced_kind)时全部按那一栏,卡也当普通文件。
5. 下面有上面几种子文件夹的文件夹是「角色文件夹」:它的名字是角色名;里面没认出来的子文件夹整个跳过(汇总一句),
   只装着认得出的子文件夹的(比如「场景包/背景」)往下找,算同一个角色。
6. 包名:立绘「角色 · 服装」(只有一套又没有服装名就叫「角色」;服装名和角色名一样的不重复写),背景和曲子在同一个
   角色文件夹里合成一个场景包「角色」,只有背景「角色 · 背景」,只有曲子「角色 · BGM」,CG「角色 · CG」;
   角色 = 卡名 > 角色文件夹名 > 拖到的卡名 > zip / 文件夹名;都没有就只写「立绘」「背景」……。同一计划里同类撞名加「 2」。
7. 立绘名:去扩展名、去 NN_ 前缀;纯英文名按酒馆的规则认版本(joy.png、joy-1.png、joy.xxx.png 都是 joy,只留第一张,
   其余进 skipped_versions);去掉名字里的禁用字符、截到 LABEL_MAX;包内重名加「 2」。英文名查小字典加中文别名,
   包里别的图已经用了的词不加。默认差分排第一:neutral → joy → 带编号的取编号最小的 → 平静 / 微笑 / 开心(和它们的
   英文名)→ 排第一的(带 NN_ 的按数字,其余自然排序)。
8. 背景名 = 文件名(去前缀);曲子:同一文件夹里有 picks.json 时只导挑中的,名字 = 情绪键(一个键几首就「日常 2」),
   「封面」那首设为封面曲、名字用它自己的文件名(它同时挂在别的情绪下就用那个情绪名);没有 picks.json 就全导,
   名字 = 文件名,名字里有「封面」(其次是 title、片头、主题曲、opening)的设为封面曲。
9. CG 清单(import.json):名字、说明、forms、焦点(focus,有才写)、差分的名字和别名照抄;清单里的路径(常是别的电脑上的
   绝对路径,分隔符混着用)按「末尾几段路径对得上最多」在这个文件夹里找,找不到、对不准的写进说明;清单没列的图不导。
0. 角色包 / 单包(第 3 步):放着 animavn.json(format = animavn)的文件夹是一个角色包,出一个 bundle 组;不在角色包里、
   放着 pack.json(format = animapack)的文件夹是一个单包,出一个 pack_file 组。这两种文件夹整个不走下面的规则;
   读不了(app/bundle/read.py 校验不过)的写一句进 skipped,也不导。拖到某张卡、某一栏时也照样另建,不挂到那张卡上。
10. 重复:立绘包 / 场景包 / CG 包按「全部文件的指纹排好序」和库里比,一模一样的填 duplicate_of {id, name, card_count};
    卡按「名字 + 描述 + 开场白」比,填 {id, name}。指纹按文件存进库的样子算:要转成 m4a 的曲子(audio.py)在这里就转好,
    算转好的那份(执行导入时直接用它)。

detail 的样子:
- 卡       {card: cards.parse_card 的结果(建卡接口收的那份)}
- 立绘包   {labels: {path: 名字}, aliases: {名字: [中文别名]}(只列有的), default: 名字, skipped_versions: [path]};
           files 按导入后的顺序,默认差分排第一
- 场景包   {bg: [path], bgm: [path], cover: path | None, labels: {path: 名字}};files = bg + bgm
- CG 包    {compositions: [{label, desc, file, aliases, forms, variants: [{label, aliases, file}], focus?}]}
- 角色包   {note, preview, cards: [{name, new_name, state}], packs: [{kind, name, detail, thumbs}], follows, preset: {name} | None,
           has_voice, bytes, folder};files = [清单的路径]。preview、thumbs 是 /api/import/{plan_id}/file?path=… 的地址
- 单包     {kind, name, detail, thumbs, bytes, folder};files = [pack.json 的路径]
所有名字都已经去掉禁用字符、截好长度、在各自的范围里不重名(立绘:整个包的名字和别名;背景、曲子各算各的;
CG:构图之间,差分在同一个构图里),apply 照着建就行。
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings
from app.assets.common import PACK_NAME_MAX
from app.bundle import read as bundle_read
from app.bundle.restore import follows as bundle_follows
from app.bundle.restore import pack_detail
from app.contracts import LABEL_FORBIDDEN, LABEL_MAX, REF_NAME_PATTERN
from app.importer import aliases
from app.importer.audio import stored_file as stored_audio
from app.importer.cards import CardError, normalize, parse_card
from app.importer.staging import StagedFile, StagedTree, _safe_part
from app.models import CgAsset, CgPack, PackSprite, SceneAsset, ScenePack, SpritePack, TavernCard
from app.storage import refs

GroupType = Literal["card", "sprite_pack", "scene_pack", "cg_pack", "bundle", "pack_file"]
BUNDLE_TYPES = ("bundle", "pack_file")
# 导入确认里的缩略图:几张、多宽
THUMBS, THUMB_W = 4, 256
# 拖到素材页的哪一栏(forced_kind)能认的
FORCED_KINDS = ("sprite", "bg", "bgm", "cg")
# 六成以上的图名是表情词,才当立绘(规则 4)
SPRITE_VOTE = 0.6
COVER_KEY = "封面"
# 没有 picks.json 时,名字里带这些词的曲子设为封面曲(按先后找)
COVER_HINTS = ("封面", "title", "片头", "主题曲", "opening")


@dataclass
class PlanGroup:
    """导入后会建出来的一样东西"""

    key: str  # 计划里唯一
    type: GroupType
    name: str  # 建议的名字(撞名时 apply 再加「 2」)
    files: list[str]  # 暂存目录里的相对路径
    owner: str | None  # 绑到哪张卡:另一个 card 组的 key,或者 "target"(拖到的那张卡),None = 不绑
    detail: dict
    duplicate_of: dict | None = None  # 包:{"id", "name", "card_count"};卡:{"id", "name"}


@dataclass
class ImportPlan:
    id: str
    groups: list[PlanGroup]
    unknown: list[str]  # 认不出来的文件(相对路径)
    skipped: list[str]  # 一句一句的说明
    target_card_id: str | None
    forced_kind: str | None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> ImportPlan:
        return cls(**{**data, "groups": [PlanGroup(**g) for g in data["groups"]]})


# ── 名字 ──

_FORBIDDEN = re.compile("[" + re.escape(LABEL_FORBIDDEN) + "]")
_NUMBER = re.compile(r"^([0-9]+)[_\-\s.]")
_ENGLISH = re.compile(r"[A-Za-z0-9 _'.\-]*[A-Za-z][A-Za-z0-9 _'.\-]*")
_ST_VERSION = re.compile(r"^(.+?)(?:[-.].*)?$")  # 酒馆认版本的规则:joy-1、joy.xxx 都是 joy
_OUTFIT_FOLDER = re.compile(r"^立绘\s*[（(]\s*(.+?)\s*[)）]$")
_FOLDER_KINDS = (
    ("sprite", re.compile(r"^(?:立绘|expressions?|sprites?|表情包?)$")),
    ("bg", re.compile(r"^(?:背景|backgrounds?|bgs?)$")),
    ("bgm", re.compile(r"^(?:bgm|music|音乐|曲子|bgm候选)$")),
    ("cg", re.compile(r"^(?:cgs?|events?)$")),
)
_VOICE_FOLDER = re.compile(r"语音|声音|声线|参考音频|配音|voice|^refs?$")
_REF_FILE = re.compile(REF_NAME_PATTERN)
_SQUASH = re.compile(r"[\s_\-·・.]+")
_GENERIC_OUTFIT = re.compile(r"expressions?|sprites?|表情包?|立绘|emotes?|emotions?")
# 默认差分:没有 neutral / joy、也没编号时,按这个先后找
_DEFAULT_FALLBACK = ("平静", "默认", "normal", "calm", "微笑", "smile", "开心", "高兴", "happy")
_DEFAULT_IDS = ("默认", "default")  # CG 子文件夹里「构图本身」那张


def _key(name: str) -> str:
    return unicodedata.normalize("NFKC", name).strip().casefold()


def folder_kind(name: str) -> tuple[str | None, str | None]:
    """文件夹名 → (类型, 服装名):类型是 sprite / bg / bgm / cg,认不出是 None;服装名只有「立绘(X)」有"""
    m = _OUTFIT_FOLDER.match(name.strip())
    if m:
        return "sprite", m.group(1)
    key = _key(name)
    for kind, pattern in _FOLDER_KINDS:
        if pattern.match(key):
            return kind, None
    return None, None


def _natural(s: str) -> list:
    parts = re.split(r"([0-9]+)", s.casefold())
    return [int(p) if i % 2 else p for i, p in enumerate(parts)]


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def _stem(path: str) -> str:
    return PurePosixPath(_basename(path)).stem or _basename(path)


# 上传接口收的几种图(app/assets/common.py 的 sniff_image_mime)的扩展名
_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def _named_like_image(path: str) -> bool:
    """名字是图片:认成「无关文件」的里面有这种的,是下载时坏了(规则 1)"""
    return PurePosixPath(_basename(path)).suffix.casefold() in _IMAGE_SUFFIXES


def _split_number(stem: str) -> tuple[int | None, str]:
    """「00_微笑」→ (0, "微笑");去掉以后什么都不剩的不去"""
    m = _NUMBER.match(stem)
    if m and stem[m.end() :].strip():
        return int(m.group(1)), stem[m.end() :]
    return None, stem


def _ordered(files: list[StagedFile]) -> list[StagedFile]:
    """带 NN_ 的按数字排在前面,其余按名字自然排序"""

    def key(f: StagedFile):
        num, rest = _split_number(_stem(f.path))
        return (0, num, _natural(rest)) if num is not None else (1, 0, _natural(rest))

    return sorted(files, key=key)


def _clean(raw: str) -> str:
    """AI 要在标签里点名的名字:去掉禁用字符和两头空白,截到 LABEL_MAX(同前端 labelFromFile)"""
    name = _FORBIDDEN.sub("", unicodedata.normalize("NFC", raw)).strip()
    return name[:LABEL_MAX].strip()


def _unique(base: str, fallback: str, taken: set[str], limit: int = LABEL_MAX) -> str:
    """不撞 taken(casefold)的名字:食堂、食堂 2、食堂 3…;用了就记进 taken"""
    root = base or fallback
    name, n = root, 2
    while name.casefold() in taken:
        suffix = f" {n}"
        name = root[: limit - len(suffix)].rstrip() + suffix
        n += 1
    taken.add(name.casefold())
    return name


def _listing(names: list[str]) -> str:
    """「A、B、C 等 5 个」/「A、B 2 个」"""
    shown = "、".join(names[:3])
    return f"{shown} 等 {len(names)} 个" if len(names) > 3 else f"{shown} {len(names)} 个"


def _squash(s: str) -> str:
    return _SQUASH.sub("", _key(s))


def _outfit(outfit: str | None, character: str | None) -> str | None:
    """包名里要不要写服装名:和角色名一样(或是它的一部分)、只是「expressions」这类泛称的不写"""
    if not outfit:
        return None
    o, c = _squash(outfit), _squash(character) if character else ""
    if not o or (c and o in c):
        return None
    rest = _GENERIC_OUTFIT.sub("", o.replace(c, "") if c else o)
    return outfit if rest else None


def _pack_name(character: str | None, suffix: str | None, alone: str) -> str:
    if character and suffix:
        name = f"{character} · {suffix}"
    else:
        name = character or suffix or alone
    return name.strip()[:PACK_NAME_MAX].strip() or alone


def _strs(value) -> list[str]:
    return [str(x) for x in value if isinstance(x, (str, int, float)) and str(x).strip()] if isinstance(value, list) else []


# ── 目录树 ──


@dataclass
class _Dir:
    path: str  # 相对路径,根是 ""
    name: str
    dirs: list[_Dir] = field(default_factory=list)
    files: list[StagedFile] = field(default_factory=list)


def _build_tree(files: list[StagedFile]) -> tuple[_Dir, list[tuple[str, bool]]]:
    """暂存文件 → 目录树;「.」「_」开头的(规则 1)不进树,返回它们最上面那一层 (路径, 是不是文件夹)"""
    root = _Dir("", "")
    index = {"": root}
    hidden: dict[str, bool] = {}
    for f in files:
        parts = f.path.split("/")
        cut = next((i for i, p in enumerate(parts) if p[:1] in "._"), None)
        if cut is not None:
            if parts[cut].casefold() != "__macosx":
                hidden.setdefault("/".join(parts[: cut + 1]), cut < len(parts) - 1)
            continue
        node = root
        for i, part in enumerate(parts[:-1]):
            path = "/".join(parts[: i + 1])
            child = index.get(path)
            if child is None:
                child = index[path] = _Dir(path, part)
                node.dirs.append(child)
            node = child
        node.files.append(f)
    for d in index.values():
        d.dirs.sort(key=lambda x: _natural(x.name))
        d.files.sort(key=lambda x: _natural(_basename(x.path)))
    return root, list(hidden.items())


def _folders(d: _Dir) -> Iterator[_Dir]:
    """d 和它下面所有的文件夹,先自己、再按名字往下"""
    yield d
    for c in d.dirs:
        yield from _folders(c)


# ── 走一遍目录:先收集,后面再分组 ──


@dataclass
class _Ctx:
    """一个角色文件夹(规则 5);根和不在角色文件夹里的 name 是 None、char 是 False"""

    dir: str
    name: str | None
    char: bool


@dataclass
class _Card:
    path: str
    dir: str
    card: dict


@dataclass
class _SpriteSet:
    ctx: _Ctx
    dir: str
    outfit: str | None
    files: list[StagedFile]


@dataclass
class _SceneSet:
    ctx: _Ctx
    dir: str
    bg: list[StagedFile] = field(default_factory=list)
    bgm: list[tuple[StagedFile, str | None]] = field(default_factory=list)  # (文件, picks 里的情绪名)
    cover: StagedFile | None = None


@dataclass
class _CgSet:
    ctx: _Ctx
    dir: str
    compositions: list[dict] = field(default_factory=list)  # 名字还没去重


class _Planner:
    def __init__(self, tree: StagedTree, db: Session, target_card_id: str | None, forced_kind: str | None):
        self.tree, self.db = tree, db
        self.target_card_id, self.forced = target_card_id, forced_kind
        target = db.get(TavernCard, target_card_id) if target_card_id else None
        self.target_name = (target.name.strip() or None) if target is not None else None
        self.cards: list[_Card] = []
        self.sprites: list[_SpriteSet] = []
        self.scenes: list[_SceneSet] = []
        self.cgs: list[_CgSet] = []
        self.unknown: list[str] = []
        self.irrelevant: list[str] = []
        self.voice: list[str] = []
        self.skipped_dirs: list[str] = []
        self.notes: list[str] = []
        self._parsed: dict[str, dict | None] = {}
        self._shas: dict[str, str] = {}
        self._kinds = {f.path: f.kind for f in tree.files}
        self.card_names: dict[str, str] = {}  # 卡组的 key → 卡名
        self.cards_by_dir: dict[str, list[str]] = {}  # 文件夹 → 直接放在里面的卡组

    # ── 文件是什么 ──

    def _card_of(self, f: StagedFile) -> dict | None:
        if f.path not in self._parsed:
            try:
                self._parsed[f.path] = parse_card(self.tree.path(f.path).read_bytes())
            except CardError as e:
                self._parsed[f.path] = None
                self.notes.append(f"「{f.path}」里的角色卡读不出来({e}),当普通文件处理")
        return self._parsed[f.path]

    def _kind(self, f: StagedFile) -> str:
        """sniff 的结果;拖到某一栏时卡当普通文件,读不出来的卡也是"""
        if f.kind in ("card_png", "card_json") and (self.forced or self._card_of(f) is None):
            return "image" if f.kind == "card_png" else "other"
        return f.kind

    def _take_card(self, f: StagedFile, d: _Dir) -> None:
        self.cards.append(_Card(f.path, d.path, self._card_of(f) or {}))

    def _misc(self, f: StagedFile, d: _Dir) -> None:
        """不是这个文件夹要的那一类的文件:卡照样是卡,图和音频等着人认,别的只计数"""
        kind = self._kind(f)
        if kind in ("card_png", "card_json"):
            self._take_card(f, d)
        elif kind in ("image", "audio"):
            self.unknown.append(f.path)
        elif kind == "voice_refs":
            self.voice.append(f.path)
        else:
            self.irrelevant.append(f.path)

    # ── 文件夹 ──

    def _folder_kind(self, d: _Dir) -> tuple[str | None, str | None]:
        kind, outfit = folder_kind(d.name) if d.path else (None, None)
        if kind is None and any(f.kind == "cg_manifest" for f in d.files):
            return "cg", None
        return kind, outfit

    def _is_voice(self, d: _Dir) -> bool:
        if not d.path:
            return False
        if _VOICE_FOLDER.search(_key(d.name)) or any(f.kind == "voice_refs" for f in d.files):
            return True
        audio = [f for f in d.files if f.kind == "audio"]
        return bool(audio) and 2 * sum(bool(_REF_FILE.match(_basename(f.path))) for f in audio) >= len(audio)

    def _has_kind_child(self, d: _Dir) -> bool:
        return any(self._folder_kind(c)[0] for c in d.dirs)

    def _has_kind_below(self, d: _Dir) -> bool:
        return any(self._folder_kind(c)[0] or self._has_kind_below(c) for c in d.dirs)

    def visit(self, d: _Dir, ctx: _Ctx) -> None:
        if self._is_voice(d):
            self.voice.append(d.path)
            return
        kind, outfit = self._folder_kind(d)
        if kind == "sprite":
            self._sprite_folder(d, ctx, outfit)
            return
        if kind == "bg":
            self._bg_folder(d, ctx)
            return
        if kind == "bgm":
            self._bgm_folder(d, ctx)
            return
        if kind == "cg":
            unit = _CgSet(ctx, d.path)
            self._cg_into(d, unit)
            if unit.compositions:
                self.cgs.append(unit)
            return
        if not ctx.char and self._has_kind_child(d):
            ctx = _Ctx(d.path, d.name or None, True)  # 角色文件夹(规则 5)
        self._loose(d, ctx)
        for c in d.dirs:
            if not ctx.char or self._is_voice(c) or self._folder_kind(c)[0] or self._has_kind_below(c):
                self.visit(c, ctx)
            else:
                self.skipped_dirs.append(c.path)

    def _loose(self, d: _Dir, ctx: _Ctx) -> None:
        """认不出名字的文件夹里直接放着的文件(规则 4):图投票、音频当曲子"""
        images: list[StagedFile] = []
        audio: list[StagedFile] = []
        picks = next((f for f in d.files if f.kind == "bgm_picks"), None)
        for f in d.files:
            kind = self._kind(f)
            if kind in ("card_png", "card_json"):
                self._take_card(f, d)
            elif kind == "image":
                images.append(f)
            elif kind == "audio":
                audio.append(f)
            elif f is not picks:
                self._misc(f, d)
        if images:
            vocab = aliases.vocabulary()
            hits = sum(_vote_word(_stem(f.path)) in vocab for f in images)
            if hits >= SPRITE_VOTE * len(images):
                self.sprites.append(_SpriteSet(ctx, d.path, d.name or None, _ordered(images)))
            else:
                self.unknown.extend(f.path for f in images)
        if audio:
            self._bgm(d, ctx, audio, picks)
        elif picks is not None:
            self.irrelevant.append(picks.path)

    def _sprite_folder(self, d: _Dir, ctx: _Ctx, outfit: str | None) -> None:
        """立绘文件夹:直接放着的图是一套,每个子文件夹又是一套(服装名 = 子文件夹名)"""
        images = []
        for f in d.files:
            if self._kind(f) == "image":
                images.append(f)
            else:
                self._misc(f, d)
        if images:
            self.sprites.append(_SpriteSet(ctx, d.path, outfit, _ordered(images)))
        for c in d.dirs:
            self._sprite_folder(c, ctx, f"{outfit} · {c.name}" if outfit else c.name)

    def _bg_folder(self, d: _Dir, ctx: _Ctx) -> None:
        unit = _SceneSet(ctx, d.path)
        for sub in _folders(d):
            images = []
            for f in sub.files:
                if self._kind(f) == "image":
                    images.append(f)
                else:
                    self._misc(f, sub)
            unit.bg.extend(_ordered(images))
        if unit.bg:
            self.scenes.append(unit)

    def _bgm_folder(self, d: _Dir, ctx: _Ctx) -> None:
        for sub in _folders(d):
            picks = next((f for f in sub.files if f.kind == "bgm_picks"), None)
            audio = []
            for f in sub.files:
                if self._kind(f) == "audio":
                    audio.append(f)
                elif f is not picks:
                    self._misc(f, sub)
            if audio:
                self._bgm(sub, ctx, audio, picks)

    def _bgm(self, d: _Dir, ctx: _Ctx, audio: list[StagedFile], picks: StagedFile | None) -> None:
        """一个文件夹里的曲子(规则 8)"""
        ordered = _ordered(audio)
        unit = _SceneSet(ctx, d.path)
        chosen = self._read_picks(d, ordered, picks) if picks is not None else None
        if chosen is None:
            unit.bgm = [(f, None) for f in ordered]
            unit.cover = next((f for hint in COVER_HINTS for f in ordered if hint in _stem(f.path).casefold()), None)
        else:
            unit.bgm, unit.cover = chosen
            left = len(audio) - len(unit.bgm)
            if left:
                where = d.name or "根目录"
                self.notes.append(f"「{where}」按 picks.json 只导挑中的 {len(unit.bgm)} 首,另外 {left} 首没挑中、没导")
        if unit.bgm:
            self.scenes.append(unit)

    def _read_picks(
        self, d: _Dir, audio: list[StagedFile], picks: StagedFile
    ) -> tuple[list[tuple[StagedFile, str | None]], StagedFile | None] | None:
        """picks.json {情绪: [文件名…]} → [(文件, 情绪名)] 和封面曲;读不出来是 None(当没有 picks.json)"""
        try:
            data = json.loads(self.tree.path(picks.path).read_bytes().decode("utf-8-sig"))
        except ValueError:
            self.irrelevant.append(picks.path)
            return None
        by_name: dict[str, StagedFile] = {}
        for f in audio:
            by_name.setdefault(_basename(f.path).casefold(), f)
        order: list[StagedFile] = []
        moods: dict[str, str] = {}
        cover: StagedFile | None = None
        where = f"{d.path}/picks.json" if d.path else "picks.json"
        for mood, names in data.items():
            for raw in names:
                name = unicodedata.normalize("NFC", re.split(r"[\\/]", raw)[-1])
                f = by_name.get(name.casefold()) or by_name.get(_safe_part(name).casefold())
                if f is None:
                    self.notes.append(f"「{where}」里的「{raw}」没找到")
                    continue
                if f not in order:
                    order.append(f)
                if mood == COVER_KEY:
                    cover = cover or f
                else:
                    moods.setdefault(f.path, mood)
        return [(f, moods.get(f.path)) for f in order], cover

    # ── CG ──

    def _cg_into(self, d: _Dir, unit: _CgSet) -> None:
        manifests = [f for f in d.files if f.kind == "cg_manifest"]
        if manifests:
            self._cg_manifest(d, unit, manifests)
            return
        images = []
        for f in d.files:
            if self._kind(f) == "image":
                images.append(f)
            else:
                self._misc(f, d)
        for f in _ordered(images):
            unit.compositions.append(_composition(_split_number(_stem(f.path))[1], f.path))
        for c in d.dirs:
            c_images = [f for f in c.files if self._kind(f) == "image"]
            if not c_images or any(f.kind == "cg_manifest" for f in c.files):
                self._cg_into(c, unit)  # 多包的一层,或者自带清单
                continue
            for f in c.files:
                if self._kind(f) != "image":
                    self._misc(f, c)
            ordered = _ordered(c_images)
            base = next((f for f in ordered if _key(_stem(f.path)) in _DEFAULT_IDS), ordered[0])
            comp = _composition(c.name, base.path)
            comp["variants"] = [
                {"label": _split_number(_stem(f.path))[1], "aliases": [], "file": f.path} for f in ordered if f is not base
            ]
            unit.compositions.append(comp)
            for cc in c.dirs:
                self._cg_into(cc, unit)

    def _cg_manifest(self, d: _Dir, unit: _CgSet, manifests: list[StagedFile]) -> None:
        """CG 清单(规则 9):照抄;路径按末尾几段对得上最多的找"""
        pool = [f for sub in _folders(d) for f in sub.files if self._kind(f) == "image"]
        used: set[str] = set()
        where = d.name or "CG"
        for m in manifests:
            try:
                entries = json.loads(self.tree.path(m.path).read_bytes().decode("utf-8-sig"))
            except ValueError:
                self.irrelevant.append(m.path)
                continue
            for e in entries:
                name = str(e.get("name") or "").strip()
                base = _find(pool, e.get("file"))
                if base is None:
                    self.notes.append(f"CG 清单里「{name}」的图没找到:{_tail(e.get('file'))}")
                    continue
                comp = _composition(name or _stem(base.path), base.path)
                comp["desc"] = str(e.get("desc") or "")
                comp["aliases"] = _strs(e.get("aliases"))
                comp["forms"] = _strs(e.get("forms"))
                focus = e.get("focus", e.get("focus_x"))
                if isinstance(focus, (int, float)) and not isinstance(focus, bool) and 0 <= focus <= 100:
                    comp["focus"] = int(round(focus))
                used.add(base.path)
                for v in e.get("variants") or []:
                    if not isinstance(v, dict):
                        continue
                    vf = _find(pool, v.get("file"))
                    label = str(v.get("label") or "").strip()
                    if vf is None:
                        self.notes.append(f"CG 清单里「{name}」的差分「{label}」没找到:{_tail(v.get('file'))}")
                        continue
                    used.add(vf.path)
                    comp["variants"].append({"label": label or _stem(vf.path), "aliases": _strs(v.get("aliases")), "file": vf.path})
                unit.compositions.append(comp)
        for sub in _folders(d):
            for f in sub.files:
                if f.kind != "cg_manifest" and self._kind(f) != "image":
                    self._misc(f, sub)
        left = [f for f in pool if f.path not in used]
        if left:
            self.notes.append(f"「{where}」里清单没列的 {len(left)} 张图没导入")

    # ── 拖到某一栏(规则 4 后半) ──

    def visit_forced(self, root: _Dir) -> None:
        ctx = _Ctx("", None, False)
        if self.forced == "cg":
            unit = _CgSet(ctx, "")
            self._cg_into(root, unit)
            if unit.compositions:
                self.cgs.append(unit)
            return
        scene = _SceneSet(ctx, "")
        for d in self._forced_folders(root):
            images, audio = [], []
            picks = next((f for f in d.files if f.kind == "bgm_picks"), None)
            for f in d.files:
                kind = self._kind(f)
                if kind == "image":
                    images.append(f)
                elif kind == "audio":
                    audio.append(f)
                elif f is not picks:
                    self._misc(f, d)
            want, other = (audio, images) if self.forced == "bgm" else (images, audio)
            self.unknown.extend(f.path for f in other)
            if not want:
                continue
            if self.forced == "sprite":
                kind, outfit = folder_kind(d.name) if d.path else (None, None)
                self.sprites.append(_SpriteSet(ctx, d.path, outfit if kind else (d.name or None), _ordered(want)))
            elif self.forced == "bg":
                scene.bg.extend(_ordered(want))
            else:
                self._bgm(d, ctx, want, picks)
        if scene.bg:
            self.scenes.append(scene)

    def _forced_folders(self, d: _Dir) -> Iterator[_Dir]:
        if self._is_voice(d):
            self.voice.append(d.path)
            return
        yield d
        for c in d.dirs:
            yield from self._forced_folders(c)

    # ── 分组 ──

    def groups(self) -> list[PlanGroup]:
        cards: list[PlanGroup] = []
        for i, c in enumerate(self.cards, 1):
            key = f"card:{i}"
            name = (c.card.get("name") or "").strip() or _stem(c.path)
            self.card_names[key] = name
            self.cards_by_dir.setdefault(c.dir, []).append(key)
            cards.append(PlanGroup(key, "card", name, [c.path], None, {"card": c.card}))
        sprites = self._sprite_groups()
        scenes = self._scene_groups()
        cgs = self._cg_groups()
        return cards + sprites + scenes + cgs

    def _owner(self, path: str) -> str | None:
        if self.forced or not self.cards:
            return "target" if self.target_card_id else None
        if len(self.cards) == 1:
            return "card:1"
        d = path
        while True:
            here = self.cards_by_dir.get(d, [])
            if len(here) == 1:
                return here[0]
            if len(here) > 1 or not d:
                return None
            d = d.rsplit("/", 1)[0] if "/" in d else ""

    def _character(self, owner: str | None, ctx: _Ctx, path: str) -> str | None:
        """角色 = 卡名 > 角色文件夹名 > 拖到的卡名 > zip / 文件夹名"""
        if owner and owner.startswith("card:"):
            return self.card_names[owner]
        if ctx.name:
            return ctx.name
        if owner == "target" and self.target_name:
            return self.target_name
        for part in path.split("/") if path else []:
            if folder_kind(part)[0] is None:
                return part
        return None

    def _sprite_groups(self) -> list[PlanGroup]:
        order: dict[str, int] = {}
        for s in self.sprites:
            order.setdefault(s.ctx.dir, len(order))
        units = sorted(self.sprites, key=lambda s: (order[s.ctx.dir], s.outfit is not None, _natural(s.outfit or "")))
        taken: set[str] = set()
        out = []
        for i, s in enumerate(units, 1):
            owner = self._owner(s.dir)
            character = self._character(owner, s.ctx, s.dir)
            name = _unique(_pack_name(character, _outfit(s.outfit, character), "立绘"), "立绘", taken, PACK_NAME_MAX)
            files, detail = _sprite_detail(s.files)
            versions = detail["skipped_versions"]
            if versions:
                first = _basename(versions[0])
                which = f"里 {first} 等 {len(versions)} 张" if len(versions) > 1 else f"里的 {first} "
                self.notes.append(f"「{name}」{which}是同一表情的备用图,先只用第一张")
            out.append(PlanGroup(f"sprite_pack:{i}", "sprite_pack", name, files, owner, detail))
        return out

    def _scene_groups(self) -> list[PlanGroup]:
        merged: dict[tuple[str, str | None], tuple[_SceneSet, str | None]] = {}
        for s in self.scenes:
            owner = self._owner(s.ctx.dir if s.ctx.char else s.dir)
            key = (s.ctx.dir, owner)
            if key not in merged:
                merged[key] = (_SceneSet(s.ctx, s.dir), owner)
            unit = merged[key][0]
            unit.bg.extend(s.bg)
            unit.bgm.extend(s.bgm)
            unit.cover = unit.cover or s.cover
        taken: set[str] = set()
        out = []
        for i, (unit, owner) in enumerate(merged.values(), 1):
            character = self._character(owner, unit.ctx, unit.dir)
            if unit.bg and unit.bgm:
                name = _pack_name(character, None, "场景")
            elif unit.bg:
                name = _pack_name(character, "背景", "背景")
            else:
                name = _pack_name(character, "BGM", "BGM")
            name = _unique(name, "场景", taken, PACK_NAME_MAX)
            labels: dict[str, str] = {}
            bg_taken: set[str] = set()
            for f in unit.bg:
                labels[f.path] = _unique(_clean(_split_number(_stem(f.path))[1]), "背景", bg_taken)
            bgm_taken: set[str] = set()
            for f, mood in unit.bgm:
                labels[f.path] = _unique(_clean(mood or _split_number(_stem(f.path))[1]), "曲子", bgm_taken)
            bg = [f.path for f in unit.bg]
            bgm = [f.path for f, _ in unit.bgm]
            detail = {"bg": bg, "bgm": bgm, "cover": unit.cover.path if unit.cover else None, "labels": labels}
            out.append(PlanGroup(f"scene_pack:{i}", "scene_pack", name, bg + bgm, owner, detail))
        return out

    def _cg_groups(self) -> list[PlanGroup]:
        taken: set[str] = set()
        out = []
        for i, unit in enumerate(self.cgs, 1):
            owner = self._owner(unit.dir)
            character = self._character(owner, unit.ctx, unit.dir)
            name = _unique(_pack_name(character, "CG", "CG"), "CG", taken, PACK_NAME_MAX)
            comps, files = [], []
            comp_taken: set[str] = set()
            for raw in unit.compositions:
                comp = dict(raw)
                comp["label"] = _unique(_clean(raw["label"]), "CG", comp_taken)
                comp["aliases"] = _new_words(raw["aliases"], comp_taken)
                variant_taken: set[str] = set()
                comp["variants"] = []
                for v in raw["variants"]:
                    label = _unique(_clean(v["label"]), "差分", variant_taken)
                    comp["variants"].append({"label": label, "aliases": _new_words(v["aliases"], variant_taken), "file": v["file"]})
                comps.append(comp)
                files += [raw["file"], *(v["file"] for v in raw["variants"])]
            out.append(PlanGroup(f"cg_pack:{i}", "cg_pack", name, list(dict.fromkeys(files)), owner, {"compositions": comps}))
        return out

    # ── 重复(规则 10) ──

    def _sha(self, path: str) -> str:
        """存进库时那份文件的指纹:曲子要转码的按转好的算(规则 10)"""
        if path not in self._shas:
            source = self.tree.path(path)
            if self._kinds.get(path) == "audio":
                source = stored_audio(self.tree, path)[0]
            h = hashlib.sha256()
            with open(source, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    h.update(chunk)
            self._shas[path] = h.hexdigest()
        return self._shas[path]

    def mark_duplicates(self, groups: list[PlanGroup]) -> None:
        packs = {
            "sprite_pack": (SpritePack, PackSprite, refs.SPRITE, bindings.SPRITE),
            "scene_pack": (ScenePack, SceneAsset, refs.SCENE_ASSET, bindings.SCENE),
            "cg_pack": (CgPack, CgAsset, refs.CG_ASSET, bindings.CG),
        }
        contents: dict[str, list[tuple[object, list]]] = {}
        for g in groups:
            if g.type == "card":
                c = g.detail["card"]
                row = self.db.scalars(
                    select(TavernCard)
                    .where(
                        TavernCard.name == c.get("name", ""),
                        TavernCard.description == c.get("description", ""),
                        TavernCard.first_mes == c.get("first_mes", ""),
                    )
                    .order_by(TavernCard.created_at)
                ).first()
                if row is not None:
                    g.duplicate_of = {"id": row.id, "name": row.name}
                continue
            pack_model, row_model, ref, kind = packs[g.type]
            if g.type not in contents:
                contents[g.type] = _db_contents(self.db, pack_model, row_model, ref)
            want = sorted(self._sha(p) for p in g.files)
            for pack, rows in contents[g.type]:
                if len(rows) == len(want) and _row_shas(self.db, ref, rows) == want:
                    g.duplicate_of = {"id": pack.id, "name": pack.name, "card_count": bindings.count_cards(self.db, kind, pack.id)}
                    break

    # ── 说明 ──

    def skipped_lines(self, hidden: list[tuple[str, bool]]) -> list[str]:
        lines = []
        if hidden:
            names = [_basename(p) for p, is_dir in hidden if is_dir] + [_basename(p) for p, is_dir in hidden if not is_dir]
            lines.append(f"跳过了 {_listing(names)}「.」或「_」开头的文件夹 / 文件")
        if self.skipped_dirs:
            lines.append(f"跳过了 {_listing([_basename(p) for p in self.skipped_dirs])}文件夹(这次不认)")
        if self.voice:
            names = [_basename(p) for p in self.voice]
            more = f" 等 {len(names)} 处" if len(names) > 3 else ""
            lines.append(f"声音包这次不认:{'、'.join(names[:3])}{more} 没导入")
        broken = [_basename(p) for p in self.irrelevant if _named_like_image(p)]
        if broken:
            more = " 等" if len(broken) > 3 else ""
            lines.append(
                f"{len(broken)} 张图打不开,没导入(文件名是图片,内容不是;可能下载时坏了):{'、'.join(broken[:3])}{more}"
            )
        names = [_basename(p) for p in self.irrelevant if not _named_like_image(p)]
        if names:
            more = " 等" if len(names) > 3 else ""
            lines.append(f"跳过 {len(names)} 个无关文件({'、'.join(names[:3])}{more})")
        return lines + self.notes


def file_label(path: str, fallback: str) -> str:
    """一个文件单独当素材时的名字(导完认领文件用,apply.py):去扩展名、NN_ 前缀和禁用字符,截到 LABEL_MAX"""
    return _clean(_split_number(_stem(path))[1]) or fallback


def _vote_word(stem: str) -> str:
    """规则 4 投票用的名字:去 NN_ 前缀,再去 -1、.xxx 后缀"""
    base = _split_number(stem)[1].strip()
    m = _ST_VERSION.match(base)
    return (m.group(1) if m else base).strip().casefold()


def _composition(label: str, path: str) -> dict:
    return {"label": label, "desc": "", "file": path, "aliases": [], "forms": [], "variants": []}


def _new_words(words: list[str], taken: set[str]) -> list[str]:
    """别名:去禁用字符,和 taken(这个范围里已经用掉的名字和别名)撞的不要"""
    out = []
    for w in words:
        w = _clean(w)
        if w and w.casefold() not in taken:
            taken.add(w.casefold())
            out.append(w)
    return out


def _tail(raw) -> str:
    return re.split(r"[\\/]", raw)[-1] if isinstance(raw, str) and raw else "(没写路径)"


def _find(pool: list[StagedFile], raw) -> StagedFile | None:
    """清单里的路径(别的电脑上的绝对路径也行)→ 末尾几段对得上最多的那个文件;对不准(并列)就当没找到"""
    if not isinstance(raw, str) or not raw.strip():
        return None
    want = [_safe_part(unicodedata.normalize("NFC", p)).casefold() for p in re.split(r"[\\/]+", raw.strip()) if p]
    best, best_score, tie = None, 0, False
    for f in pool:
        have = f.path.casefold().split("/")
        score = 0
        while score < min(len(want), len(have)) and want[-1 - score] == have[-1 - score]:
            score += 1
        if score > best_score:
            best, best_score, tie = f, score, False
        elif score and score == best_score:
            tie = True
    return best if best_score and not tie else None


def _sprite_detail(files: list[StagedFile]) -> tuple[list[str], dict]:
    """一套立绘(已经按 _ordered 排好)→ (导入后的顺序, detail);规则 7"""
    entries: list[tuple[StagedFile, str, int | None]] = []  # (文件, 名字底子, 编号)
    seen: set[str] = set()
    versions: list[str] = []
    for f in files:
        num, base = _split_number(_stem(f.path))
        base = base.strip()
        if _ENGLISH.fullmatch(base):
            word = _clean(_ST_VERSION.match(base).group(1))
            if word.casefold() in seen:
                versions.append(f.path)
                continue
            seen.add(word.casefold())
        else:
            word = _clean(base)
        entries.append((f, word, num))
    taken: set[str] = set()
    labels = [_unique(word, "差分", taken) for _, word, _ in entries]
    words = [word.casefold() for _, word, _ in entries]
    pick = next((words.index(w) for w in ("neutral", "joy") if w in words), None)
    if pick is None and entries and entries[0][2] is not None:
        pick = 0
    if pick is None:
        pick = next((words.index(w) for w in _DEFAULT_FALLBACK if w in words), 0)
    order = [pick, *(i for i in range(len(entries)) if i != pick)] if entries else []
    found: dict[str, list[str]] = {}
    for i in order:
        extra = _new_words(aliases.chinese_aliases(entries[i][1]), taken)
        if extra:
            found[labels[i]] = extra
    detail = {
        "labels": {entries[i][0].path: labels[i] for i in order},
        "aliases": found,
        "default": labels[pick] if entries else None,
        "skipped_versions": versions,
    }
    return [entries[i][0].path for i in order], detail


def _db_contents(db: Session, pack_model, row_model, ref: refs.BlobRef) -> list[tuple[object, list]]:
    """库里每个包(按建的先后)和它的素材行 [(行编号, 指纹)]"""
    rows: dict[str, list] = {}
    for pack_id, row_id, sha in db.execute(select(row_model.pack_id, row_model.id, ref.sha_col)):
        rows.setdefault(pack_id, []).append((row_id, sha))
    packs = db.scalars(select(pack_model).order_by(pack_model.created_at)).all()
    return [(p, rows.get(p.id, [])) for p in packs]


def _row_shas(db: Session, ref: refs.BlobRef, rows: list) -> list[str]:
    """排好序的指纹;还没进文件仓库(指纹是空的)的行读出原件现算,读不出来的算空串(和谁都不一样)"""
    out = []
    for row_id, sha in rows:
        if sha is None:
            row = db.get(ref.model, row_id)
            data = refs.read_bytes(ref, row, db) if row is not None else None
            sha = hashlib.sha256(data).hexdigest() if data is not None else ""
        out.append(sha)
    return sorted(out)


def build_plan(
    tree: StagedTree, db: Session, target_card_id: str | None = None, forced_kind: str | None = None
) -> ImportPlan:
    """照暂存目录出导入计划;只读库。forced_kind 是 sprite / bg / bgm / cg 之一或 None,别的抛 ValueError"""
    if forced_kind is not None and forced_kind not in FORCED_KINDS:
        raise ValueError(f"不认识的素材类型:{forced_kind}")
    bundles, rest, bundle_notes = _bundle_groups(tree, db)
    planner = _Planner(tree, db, target_card_id, forced_kind)
    root, hidden = _build_tree(rest)
    if forced_kind:
        planner.visit_forced(root)
    else:
        planner.visit(root, _Ctx("", None, False))
    groups = planner.groups()
    planner.mark_duplicates(groups)
    return ImportPlan(
        id=tree.plan_id,
        groups=bundles + groups,
        unknown=sorted(planner.unknown),
        skipped=bundle_notes + planner.skipped_lines(hidden),
        target_card_id=target_card_id,
        forced_kind=forced_kind,
    )


# ── 角色包 / 单包(规则 0)──


def staged_url(plan_id: str, path: str, w: int | None = None) -> str:
    """暂存目录里一个文件的地址(GET /api/import/{plan_id}/file)"""
    return f"/api/import/{plan_id}/file?path={quote(path, safe='')}" + (f"&w={w}" if w else "")


def _under(path: str, folder: str) -> bool:
    return not folder or path.startswith(folder + "/")


def _join_rel(folder: str, rel: str) -> str:
    return f"{folder}/{rel}" if folder else rel


def _pack_out(tree: StagedTree, folder: str, pack: dict) -> dict:
    images = [
        i["file"]
        for i in pack.get("items") or []
        if isinstance(i, dict) and i.get("file") and str(i.get("mime") or "").startswith("image/") and not i.get("parent_id")
    ]
    return {
        "kind": pack["kind"],
        "name": str(pack["pack"].get("name") or ""),
        "detail": pack_detail(pack["kind"], pack),
        "count": len(pack.get("items") or []),
        "thumbs": [staged_url(tree.plan_id, _join_rel(folder, f), THUMB_W) for f in images[:THUMBS]],
    }


def _bundle_groups(tree: StagedTree, db: Session) -> tuple[list[PlanGroup], list[StagedFile], list[str]]:
    """认出角色包、单包:(它们的组, 剩下走规则 1–10 的文件, 读不了的说明)"""
    found: list[tuple[str, StagedFile]] = []
    for kind in ("bundle_manifest", "pack_manifest"):
        for f in sorted((f for f in tree.files if f.kind == kind), key=lambda f: (f.path.count("/"), f.path)):
            folder = f.path.rsplit("/", 1)[0] if "/" in f.path else ""
            if any(_under(f.path, other) for other, _ in found):
                continue  # 角色包里每个包的 pack.json;包里又套的包
            found.append((folder, f))
    groups, notes = [], []
    taken = {n.casefold() for n in db.scalars(select(TavernCard.name)).all()}
    for folder, f in found:
        root = tree.path(folder) if folder else tree.root
        label = folder.rsplit("/", 1)[-1] if folder else _basename(f.path)
        size = sum(x.size for x in tree.files if _under(x.path, folder))
        try:
            if f.kind == "bundle_manifest":
                groups.append(_bundle_group(tree, folder, f, bundle_read.read_manifest(root), size, taken, len(groups) + 1))
            else:
                pack = bundle_read.read_pack(root)
                detail = {**_pack_out(tree, folder, pack), "bytes": size, "folder": folder}
                groups.append(PlanGroup(f"pack_file:{len(groups) + 1}", "pack_file", detail["name"], [f.path], None, detail))
        except bundle_read.BundleError as e:
            what = "角色包" if f.kind == "bundle_manifest" else "素材包"
            notes.append(f"「{label}」不是能导入的{what}:{e}")
    claimed = [folder for folder, _ in found]
    rest = [x for x in tree.files if not any(_under(x.path, c) for c in claimed)]
    return groups, rest, notes


def _bundle_group(
    tree: StagedTree, folder: str, f: StagedFile, m: bundle_read.Manifest, size: int, taken: set[str], n: int
) -> PlanGroup:
    data = m.data
    states = {s["card"]: s.get("name") for s in (data.get("state_group") or {}).get("states") or []}
    order = [data["main_card"], *[k for k in m.cards if k != data["main_card"]]]
    cards = []
    for key in order:
        name = normalize(m.cards[key])["name"].strip() or "角色"
        new, i = name, 2
        while new.casefold() in taken:
            new, i = f"{name} {i}", i + 1
        cards.append({"name": name, "new_name": new, "state": states.get(key)})
    packs = [m.packs[p["key"]] for p in data.get("packs") or [] if p.get("key") in m.packs]
    preview = data.get("preview")
    title = str(data.get("title") or cards[0]["name"])
    detail = {
        "note": str(data.get("note") or ""),
        "preview": staged_url(tree.plan_id, _join_rel(folder, preview)) if preview else None,
        "cards": cards,
        "packs": [_pack_out(tree, folder, p) for p in packs],
        "follows": bundle_follows(data, packs),
        "preset": {"name": str(data["preset"].get("name") or "")} if m.preset is not None else None,
        "has_voice": False,
        "bytes": size,
        "folder": folder,
    }
    return PlanGroup(f"bundle:{n}", "bundle", title, [f.path], None, detail)
