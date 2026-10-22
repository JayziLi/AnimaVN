"""读解开的角色包 / 单包,校验(导入时用;暂存目录 app/importer/staging.py 已经把 zip 解开了)。

    manifest = read_manifest(folder)   # folder 下面有 animavn.json
    pack = read_pack(folder)           # folder 下面有 pack.json(单包)

校验:format / version 对;清单里写的路径都是包里的相对路径(不许 ..、绝对路径),引用的文件都在;
卡、包、绑定、状态组之间的 key 对得上。不对就抛 BundleError(消息是给人看的中文)。包里的行怎么建是 restore.py 的事。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from app.bundle.collect import FORMAT_BUNDLE, FORMAT_PACK, MANIFEST, PACK_KINDS, PACK_MANIFEST, VERSION

# 清单和 pack.json 再大也不该超过这么多(图都在 assets/ 里)
MAX_JSON_BYTES = 64 * 1024 * 1024
_KEY = re.compile(r"^[0-9A-Za-z_-]{1,64}$")


class BundleError(ValueError):
    """不是能导入的角色包 / 单包"""


@dataclass
class Manifest:
    folder: Path
    data: dict  # animavn.json
    cards: dict[str, dict] = field(default_factory=dict)  # key → 卡 JSON
    packs: dict[str, dict] = field(default_factory=dict)  # key → pack.json
    preset: dict | None = None  # 预设 JSON


def is_bundle_manifest(value) -> bool:
    return isinstance(value, dict) and value.get("format") == FORMAT_BUNDLE


def is_pack_manifest(value) -> bool:
    return isinstance(value, dict) and value.get("format") == FORMAT_PACK


def safe_path(folder: Path, rel) -> Path:
    """包里的一个相对路径 → 文件;路径不安全、文件不在都抛 BundleError"""
    if not isinstance(rel, str) or not rel:
        raise BundleError("清单里的文件路径不对")
    if "\\" in rel or rel.startswith("/") or re.match(r"^[A-Za-z]:", rel) or ".." in PurePosixPath(rel).parts:
        raise BundleError(f"清单里的文件路径不安全:{rel}")
    path = Path(folder).joinpath(*PurePosixPath(rel).parts)
    if not path.resolve().is_relative_to(Path(folder).resolve()):
        raise BundleError(f"清单里的文件路径不安全:{rel}")
    if not path.is_file():
        raise BundleError(f"角色包缺文件:{rel}")
    return path


def _load_json(path: Path, what: str):
    if path.stat().st_size > MAX_JSON_BYTES:
        raise BundleError(f"{what}太大了")
    try:
        return json.loads(path.read_bytes().decode("utf-8-sig"))
    except ValueError as e:
        raise BundleError(f"{what}不是合法的 JSON:{e}") from e


def _version(value: dict, what: str) -> None:
    v = value.get("version")
    if not isinstance(v, int) or isinstance(v, bool):
        raise BundleError(f"{what}没写格式版本")
    if v > VERSION:
        raise BundleError(f"这个{what}是新版 AnimaVN 导出的(格式 v{v}),先更新 AnimaVN 再导入")
    if v < 1:
        raise BundleError(f"{what}的格式版本不对")


def _key(value, what: str) -> str:
    if not isinstance(value, str) or not _KEY.match(value):
        raise BundleError(f"清单里{what}的编号不对")
    return value


def _list(value, what: str) -> list:
    if value is None:
        return []
    if not isinstance(value, list):
        raise BundleError(f"清单里的{what}不是列表")
    return value


def check_pack(folder: Path, pack, *, kind: str | None = None) -> dict:
    """pack.json 的内容:格式、种类、每一行的文件都在"""
    if not is_pack_manifest(pack):
        raise BundleError("pack.json 不是 AnimaVN 素材包")
    _version(pack, "素材包")
    if pack.get("kind") not in PACK_KINDS:
        raise BundleError(f"不认识的素材包种类:{pack.get('kind')}")
    if kind is not None and pack["kind"] != kind:
        raise BundleError("清单里写的包种类和 pack.json 对不上")
    _key(pack.get("key"), "包")
    if not isinstance(pack.get("pack"), dict) or not isinstance(pack["pack"].get("name"), str):
        raise BundleError("pack.json 里没有包的名字")
    keys = set()
    for item in _list(pack.get("items"), "素材"):
        if not isinstance(item, dict):
            raise BundleError("pack.json 里的素材不对")
        keys.add(_key(item.get("key"), "素材"))
        if item.get("file") is not None:
            safe_path(folder, item["file"])
    if len(keys) != len(_list(pack.get("items"), "素材")):
        raise BundleError("pack.json 里有重复的素材编号")
    for layout in _list(pack.get("layouts"), "摆法"):
        if not isinstance(layout, dict):
            raise BundleError("pack.json 里的摆法不对")
    for rec in _list(pack.get("word_records"), "认词记录"):
        if not isinstance(rec, dict):
            raise BundleError("pack.json 里的认词记录不对")
    return pack


def read_pack(folder: Path) -> dict:
    """单包(.animapack 解开的文件夹)"""
    folder = Path(folder)
    return check_pack(folder, _load_json(safe_path(folder, PACK_MANIFEST), "素材包清单"))


def read_manifest(folder: Path) -> Manifest:
    """角色包(.animavn 解开的文件夹)"""
    folder = Path(folder)
    data = _load_json(safe_path(folder, MANIFEST), "角色包清单")
    if not is_bundle_manifest(data):
        raise BundleError("不是 AnimaVN 角色包")
    _version(data, "角色包")
    out = Manifest(folder=folder, data=data)

    for entry in _list(data.get("cards"), "角色卡"):
        if not isinstance(entry, dict):
            raise BundleError("清单里的角色卡不对")
        key = _key(entry.get("key"), "角色卡")
        card = _load_json(safe_path(folder, entry.get("file")), "角色卡")
        if not isinstance(card, dict):
            raise BundleError("角色卡不是一个对象")
        if entry.get("avatar") is not None:
            safe_path(folder, entry["avatar"])
        out.cards[key] = card
    if not out.cards:
        raise BundleError("角色包里没有角色卡")
    if data.get("main_card") not in out.cards:
        raise BundleError("清单里的主卡不在角色卡里")

    for entry in _list(data.get("packs"), "素材包"):
        if not isinstance(entry, dict):
            raise BundleError("清单里的素材包不对")
        if entry.get("kind") not in PACK_KINDS:
            raise BundleError(f"不认识的素材包种类:{entry.get('kind')}")
        key = _key(entry.get("key"), "素材包")
        pack = check_pack(folder, _load_json(safe_path(folder, entry.get("file")), "素材包清单"), kind=entry["kind"])
        if pack["key"] != key:
            raise BundleError("清单里的包编号和 pack.json 对不上")
        out.packs[key] = pack

    if data.get("preview") is not None:
        safe_path(folder, data["preview"])
    preset = data.get("preset")
    if preset is not None:
        if not isinstance(preset, dict):
            raise BundleError("清单里的预设不对")
        body = _load_json(safe_path(folder, preset.get("file")), "预设")
        if not isinstance(body, dict):
            raise BundleError("预设不是一个对象")
        out.preset = body

    check_refs(out)
    return out


def check_refs(m: Manifest) -> None:
    """卡、包、角色位之间的 key 对得上(restore 之前再查一遍:清单在读和建之间可能被改过)"""
    data = m.data
    cards, packs = set(m.cards), m.packs
    group = data.get("state_group")
    if group is not None:
        if not isinstance(group, dict) or not isinstance(group.get("row"), dict):
            raise BundleError("清单里的状态组不对")
        if group["row"].get("main_card_id") not in cards:
            raise BundleError("状态组的主卡不在角色卡里")
        for s in _list(group.get("states"), "状态"):
            if not isinstance(s, dict) or s.get("card") not in cards:
                raise BundleError("状态组里有不在角色包里的卡")
    for r in _list(data.get("roles"), "角色位"):
        if not isinstance(r, dict) or r.get("card") not in cards:
            raise BundleError("角色位指着不在角色包里的卡")
    for b in _list(data.get("bindings"), "绑定"):
        if not isinstance(b, dict) or b.get("card") not in cards:
            raise BundleError("绑定指着不在角色包里的卡")
        pack = packs.get(b.get("pack"))
        if pack is None or pack["kind"] != b.get("kind"):
            raise BundleError("绑定指着不在角色包里的素材包")
    for name in ("card_prefs", "word_records", "pairings"):
        for row in _list(data.get(name), name):
            if not isinstance(row, dict):
                raise BundleError(f"清单里的 {name} 不对")
    for p in _list(data.get("card_prefs"), "按卡设置"):
        if p.get("card") not in cards:
            raise BundleError("按卡设置指着不在角色包里的卡")
