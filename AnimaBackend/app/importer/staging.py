"""导入的暂存目录:拖进来的文件先原样放进 data/import-staging/<plan_id>/files/,zip 就地解开(设计 6.4)。

    tree = stage([("刻晴/立绘（玉衡星）/微笑.png", data), ("expressions.zip", path), …])

StagedTree 是给导入计划(classify.py)走的一棵树:
- plan_id  32 位十六进制,这次导入的编号(导入计划用同一个)
- dir      data/import-staging/<plan_id>/,导入计划之类的东西可以放这里
- root     dir/files/,文件都在这下面;tree.path(相对路径) 取文件(路径不安全就抛错)
- files    StagedFile(path, size, kind) 的列表,按 path 排好:path 是相对 root 的 POSIX 路径(NFC),
           kind 是 sniff.kind_of 认出来的(card_png / card_json / image / audio / cg_manifest / bgm_picks /
           voice_refs / other)。解开的 zip 本身不在里面(带卡的 PNG 后面接 zip 的除外,卡留着)。
open_tree(plan_id) 照磁盘上的暂存目录重新走一遍(执行导入时用);discard 删一次的,purge 清掉过期的。

放进来时把关(有一条不过,整批不收,暂存目录删干净):
- 路径:反斜杠当分隔符;绝对路径(/x、C:\\x、\\\\server)、带 .. 的拒收;Windows 上不能用的字符(包括 C:x 里的冒号)换成 _、
  末尾的点和空格去掉、CON / NUL 这类设备名后面加 _;Windows 的盘不分大小写,撞名的加「 2」「 3」。
- 垃圾:__MACOSX 整个文件夹、.DS_Store、Thumbs.db、desktop.ini 直接跳过。
- zip:按文件头认(PK 开头;图片后面接 zip 的 —— 比如 CHARX 那种 JPEG —— 靠 zipfile 从文件末尾的目录
  找回 PK 头)。解进同一层的「zip 名」文件夹,zip 里唯一的顶层文件夹和 zip 同名时不再多套一层。
  没有 UTF-8 标记的文件名按整个压缩包试 utf-8 → gbk → shift_jis,再 NFC(gbk 解出来大多是生僻字、
  shift_jis 又解得通时用 shift_jis:日文压缩包的名字 gbk 往往也「解得通」,只是一堆乱码)。
  最多解两层(zip 里的 zip 也解,再往里的原样留着,kind 是 other);有密码的、坏的拒收。
- 上限:解开以后总共 8 GiB(声音包带模型,第 4 步从 2 GiB 放到 8 GiB)、5000 个文件(解开的 zip 本身不算);zip 先按目录里写的大小算,超了不解。
"""

from __future__ import annotations

import os
import re
import shutil
import time
import unicodedata
import uuid
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Union

from sqlalchemy.engine import make_url

from app.assets.common import sniff_image_mime
from app.config import settings
from app.importer.sniff import Kind, kind_of

MAX_TOTAL_BYTES = 8 * 1024**3
MAX_FILES = 5000
MAX_ZIP_DEPTH = 2
FILES = "files"
PLAN_ID = re.compile(r"^[0-9a-f]{32}$")

Content = Union[bytes, bytearray, memoryview, os.PathLike, BinaryIO]

_JUNK_DIRS = {"__macosx"}
_JUNK_FILES = {".ds_store", "thumbs.db", "desktop.ini"}
_ZIP_MAGIC = (b"PK\x03\x04", b"PK\x05\x06")
_UNSAFE = re.compile(r'[<>:"|?*\x00-\x1f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_CHUNK = 1024 * 1024
_UTF8_FLAG = 0x800
_ENCRYPTED = 0x1


class StagingError(ValueError):
    """这批文件不收;消息是给人看的中文"""


class TooLarge(StagingError):
    """超过总大小或文件数的上限"""


@dataclass(frozen=True)
class StagedFile:
    path: str  # 相对 StagedTree.root,POSIX 斜杠,NFC
    size: int
    kind: Kind


@dataclass
class StagedTree:
    plan_id: str
    dir: Path
    root: Path
    files: list[StagedFile]

    def path(self, rel: str) -> Path:
        """暂存目录里的一个文件;rel 来自前端时也安全(不安全的路径抛 StagingError)"""
        parts = _split(rel)
        if parts is None:
            raise StagingError(f"没有这个文件:{rel}")
        return _target(self.root, "/".join(parts))


# ── 暂存目录 ──


def staging_root(database_url: str | None = None) -> Path:
    """data/import-staging/:设了 import_staging_dir 就用它;不然放库文件旁边,和 blobs/ 同级
    (内存库或别的库放 AnimaBackend/data/import-staging/)"""
    if settings.import_staging_dir:
        return Path(settings.import_staging_dir)
    url = make_url(database_url or settings.database_url)
    if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
        return Path(url.database).parent / "import-staging"
    return Path(__file__).resolve().parents[2] / "data" / "import-staging"


def stage(files: list[tuple[str, Content]], root: Path | None = None) -> StagedTree:
    """拖进来的一批文件放进新的暂存目录。files:(相对路径, 内容);内容可以是 bytes、文件路径或打开的二进制文件。
    不收就抛 StagingError(超限是它的子类 TooLarge),暂存目录删干净"""
    plan_id = uuid.uuid4().hex
    plan_dir = Path(root if root is not None else staging_root()) / plan_id
    files_root = plan_dir / FILES
    files_root.mkdir(parents=True)
    try:
        budget, names = _Budget(), _Names()
        queue: list[tuple[str, int]] = []  # (相对路径, 第几层 zip 里出来的)
        for name, content in files:
            parts = _split(name)
            if parts is None:
                continue
            rel = names.file("", parts)
            _write(_target(files_root, rel), content, budget)
            queue.append((rel, 0))
        while queue:
            rel, depth = queue.pop(0)
            if depth < MAX_ZIP_DEPTH:
                queue.extend((r, depth + 1) for r in _unpack(files_root, rel, names, budget))
        return _scan(plan_id, plan_dir)
    except BaseException:
        shutil.rmtree(plan_dir, ignore_errors=True)
        raise


def open_tree(plan_id: str, root: Path | None = None) -> StagedTree:
    """照磁盘上的暂存目录重新走一遍(执行导入时用)"""
    plan_dir = _plan_dir(plan_id, root)
    if not (plan_dir / FILES).is_dir():
        raise StagingError("这次导入的暂存文件不在了(可能过期清理掉了),请重新拖进来")
    return _scan(plan_id, plan_dir)


def discard(plan_id: str, root: Path | None = None) -> None:
    """删掉一次导入的暂存目录;不在了也不报错"""
    shutil.rmtree(_plan_dir(plan_id, root), ignore_errors=True)


def purge(root: Path | None = None, max_age_days: float = 7, now: float | None = None) -> int:
    """清掉 max_age_days 天以前的暂存目录(按目录的修改时间),返回清了几个"""
    base = Path(root if root is not None else staging_root())
    if not base.is_dir():
        return 0
    cutoff = (now if now is not None else time.time()) - max_age_days * 24 * 3600
    n = 0
    for d in base.iterdir():
        if d.is_dir() and PLAN_ID.match(d.name) and d.stat().st_mtime < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            n += 1
    return n


def _plan_dir(plan_id: str, root: Path | None) -> Path:
    if not isinstance(plan_id, str) or not PLAN_ID.match(plan_id):
        raise StagingError("导入编号不对")
    return Path(root if root is not None else staging_root()) / plan_id


def _scan(plan_id: str, plan_dir: Path) -> StagedTree:
    root = plan_dir / FILES
    files = [
        StagedFile(p.relative_to(root).as_posix(), p.stat().st_size, kind_of(p))
        for p in root.rglob("*")
        if p.is_file()
    ]
    files.sort(key=lambda f: f.path)
    return StagedTree(plan_id=plan_id, dir=plan_dir, root=root, files=files)


# ── 路径 ──


def _split(name: str) -> list[str] | None:
    """一个相对路径 → 安全的各段;垃圾文件返回 None;绝对路径和 .. 抛 StagingError"""
    s = unicodedata.normalize("NFC", name).replace("\\", "/")
    if s.startswith("/") or re.match(r"^[A-Za-z]:/", s):
        raise StagingError(f"文件路径不安全(绝对路径):{name}")
    parts = [p for p in s.split("/") if p not in ("", ".")]
    if ".." in parts:
        raise StagingError(f"文件路径不安全(带 ..):{name}")
    if not parts or any(p.casefold() in _JUNK_DIRS for p in parts) or parts[-1].casefold() in _JUNK_FILES:
        return None
    return [_safe_part(p) for p in parts]


def _safe_part(part: str) -> str:
    """Windows 上能用的名字:换掉 <>:"|?* 和控制字符,去掉末尾的点和空格,设备名后面加 _"""
    part = _UNSAFE.sub("_", part).rstrip(" .")
    if not part:
        return "_"
    base, dot, rest = part.partition(".")
    return f"{base}_{dot}{rest}" if base.upper() in _RESERVED else part


def _join(parent: str, name: str) -> str:
    return f"{parent}/{name}" if parent else name


def _target(files_root: Path, rel: str) -> Path:
    target = files_root.joinpath(*rel.split("/"))
    # 双保险:不管名字怎么来的,写的位置一定在暂存目录里
    if not target.resolve().is_relative_to(files_root.resolve()):
        raise StagingError(f"文件路径不安全:{rel}")
    return target


class _Names:
    """暂存目录里已经占掉的名字。不分大小写(Windows 的盘不分);撞名的加「 2」「 3」。
    同一个来源的文件夹(上传的路径、zip 里的路径)只是大小写不同时合成一个,和 Windows 解压一样"""

    def __init__(self) -> None:
        self.files: set[str] = set()  # 文件(casefold)
        self.dirs: dict[tuple[str, str], str] = {}  # (来源, 原路径 casefold)→ 实际的目录
        self.owner: dict[str, tuple[str, str]] = {}  # 实际的目录(casefold)→ 来源

    def _taken(self, cand: str, key: tuple[str, str] | None = None) -> bool:
        c = cand.casefold()
        return c in self.files or (c in self.owner and self.owner[c] != key)

    def _dir(self, base: str, parts: list[str]) -> str:
        actual = base
        for i, part in enumerate(parts):
            key = (base.casefold(), "/".join(parts[: i + 1]).casefold())
            if key in self.dirs:
                actual = self.dirs[key]
                continue
            cand, n = _join(actual, part), 2
            while self._taken(cand, key):
                cand, n = _join(actual, f"{part} {n}"), n + 1
            self.dirs[key] = cand
            self.owner[cand.casefold()] = key
            actual = cand
        return actual

    def file(self, base: str, parts: list[str]) -> str:
        """base 下面的文件(base 是 zip 解开的文件夹,上传的是 "")→ 实际的相对路径"""
        folder = self._dir(base, parts[:-1])
        name = parts[-1]
        ext = PurePosixPath(name).suffix
        stem = name[: -len(ext)] if ext else name
        cand, n = _join(folder, name), 2
        while self._taken(cand):
            cand, n = _join(folder, f"{stem} {n}{ext}"), n + 1
        self.files.add(cand.casefold())
        return cand

    def fresh_dir(self, parent: str, name: str) -> str:
        """解 zip 用的新文件夹:不和已有的文件、文件夹同名"""
        cand, n = _join(parent, name), 2
        while self._taken(cand):
            cand, n = _join(parent, f"{name} {n}"), n + 1
        self.owner[cand.casefold()] = ("zip", cand.casefold())
        return cand

    def drop(self, rel: str) -> None:
        self.files.discard(rel.casefold())


# ── 写文件、上限 ──


class _Budget:
    def __init__(self) -> None:
        self.bytes = 0
        self.files = 0

    def charge(self, size: int, files: int = 0) -> None:
        self.bytes += size
        self.files += files
        if self.files > MAX_FILES:
            raise TooLarge(f"文件太多了:超过 {MAX_FILES} 个,这批没有导入")
        if self.bytes > MAX_TOTAL_BYTES:
            raise TooLarge(f"文件太大了:解开以后超过 {_size(MAX_TOTAL_BYTES)},这批没有导入")


def _size(n: int) -> str:
    return f"{n / 1024**3:g} GB" if n >= 1024**3 else f"{n / 1024**2:.1f} MB"


def _write(target: Path, content: Content, budget: _Budget) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, (bytes, bytearray, memoryview)):
        budget.charge(len(content), 1)
        target.write_bytes(content)
    elif isinstance(content, os.PathLike):
        budget.charge(os.path.getsize(content), 1)
        shutil.copyfile(content, target)
    else:
        budget.charge(0, 1)
        with open(target, "wb") as out:
            while chunk := content.read(_CHUNK):
                budget.charge(len(chunk))
                out.write(chunk)


# ── zip ──


def _open_zip(path: Path) -> tuple[zipfile.ZipFile, bool] | None:
    """是 zip 就打开:(压缩包, 是不是藏在图片后面的)。PK 开头却打不开的是坏包,整批拒收;
    图片后面看着像 zip 却打不开的,当普通图片"""
    with open(path, "rb") as f:
        head = f.read(16)
    if head.startswith(_ZIP_MAGIC):
        try:
            return zipfile.ZipFile(path), False
        except (zipfile.BadZipFile, OSError) as e:
            raise StagingError(f"压缩包「{path.name}」坏了,解不开") from e
    if sniff_image_mime(head) and zipfile.is_zipfile(path):
        try:
            zf = zipfile.ZipFile(path)
        except (zipfile.BadZipFile, OSError):
            return None
        if zf.infolist():
            return zf, True
        zf.close()
    return None


# 本身就是 zip 格式、但要原样留着的文件:PyTorch 的模型(.ckpt / .pth / .pt)。不留的话声音包里的模型会被拆成一堆文件夹
_KEEP_WHOLE = {".ckpt", ".pth", ".pt"}


def _unpack(files_root: Path, rel: str, names: _Names, budget: _Budget) -> list[str]:
    """rel 是 zip 就解进同一层的「zip 名」文件夹,返回解出来的文件;不是 zip(或是要原样留着的模型)返回 []"""
    path = files_root / rel
    if path.suffix.lower() in _KEEP_WHOLE:
        return []
    found = _open_zip(path)
    if found is None:
        return []
    zf, embedded = found
    pure = PurePosixPath(rel)
    parent = "" if str(pure.parent) == "." else str(pure.parent)
    stem = pure.stem if pure.suffix else pure.name
    # 图片后面接 zip:带卡的 PNG 留着(卡在图里),别的图只是个壳
    keep = embedded and kind_of(path) == "card_png"
    with zf:
        if not keep:
            names.drop(rel)
            budget.charge(-path.stat().st_size, -1)
        folder = names.fresh_dir(parent, stem or "_")
        out = _extract(zf, files_root, folder, stem, pure.name, names, budget)
    if not keep:
        path.unlink()
    return out


def _extract(
    zf: zipfile.ZipFile, files_root: Path, folder: str, stem: str, label: str, names: _Names, budget: _Budget
) -> list[str]:
    entries: list[tuple[zipfile.ZipInfo, list[str]]] = []
    infos = [i for i in zf.infolist() if not i.is_dir()]
    decoded = _decode_names(infos)
    for info in infos:
        parts = _split(decoded[id(info)])
        if parts is None:
            continue
        if info.flag_bits & _ENCRYPTED:
            raise StagingError(f"压缩包「{label}」有密码,解不开;先解压了再拖进来")
        entries.append((info, parts))
    # 顶层只有一个和 zip 同名的文件夹(把「刻晴」文件夹压成「刻晴.zip」):不再多套一层
    tops = {parts[0].casefold() for _, parts in entries}
    if entries and tops == {stem.casefold()} and all(len(parts) > 1 for _, parts in entries):
        entries = [(info, parts[1:]) for info, parts in entries]
    # 先按目录里写的大小算(zipfile 解出来的不会比写的多,写少了 CRC 对不上会报错)
    budget.charge(sum(info.file_size for info, _ in entries), len(entries))
    out = []
    for info, parts in entries:
        rel = names.file(folder, parts)
        target = _target(files_root, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with zf.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst, _CHUNK)
        except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError) as e:
            raise StagingError(f"压缩包「{label}」坏了,解不开:{info.filename}") from e
        out.append(rel)
    return out


def _decode_names(infos: list[zipfile.ZipInfo]) -> dict[int, str]:
    """没 UTF-8 标记的名字:zipfile 按 cp437 解了,换回原始字节再按整个压缩包选编码"""
    out: dict[int, str] = {}
    raw: dict[int, bytes] = {}
    for info in infos:
        if info.flag_bits & _UTF8_FLAG:
            out[id(info)] = info.orig_filename
        else:
            # orig_filename 是没把反斜杠换成 / 的原名:Shift-JIS 的第二个字节可能正好是 0x5C
            raw[id(info)] = info.orig_filename.encode("cp437")
    encoding = _pick_encoding([b for b in raw.values() if not b.isascii()])
    for key, b in raw.items():
        out[key] = _decode(b, encoding)
    return out


def _try_decode(raws: list[bytes], encoding: str) -> list[str] | None:
    try:
        return [b.decode(encoding) for b in raws]
    except UnicodeDecodeError:
        return None


def _mostly_gb2312(names: list[str]) -> bool:
    """gbk 解出来的字九成以上是常用字(GB2312 里有的):是真中文。日文压缩包按 gbk 解出来多是生僻字"""
    wide = [c for s in names for c in s if ord(c) > 0x7F]
    common = 0
    for c in wide:
        try:
            c.encode("gb2312")
            common += 1
        except UnicodeEncodeError:
            pass
    return common >= 0.9 * len(wide)


def _pick_encoding(raws: list[bytes]) -> str | None:
    """整个压缩包用哪种编码;None = 没有一种能解全部,逐个名字试"""
    if _try_decode(raws, "utf-8") is not None:
        return "utf-8"
    gbk = _try_decode(raws, "gbk")
    if gbk is not None and _mostly_gb2312(gbk):
        return "gbk"
    if _try_decode(raws, "shift_jis") is not None:
        return "shift_jis"
    return "gbk" if gbk is not None else None


def _decode(raw: bytes, encoding: str | None) -> str:
    for enc in [encoding] if encoding else ["utf-8", "gbk", "shift_jis"]:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("cp437")
