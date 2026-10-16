"""按文件头认导入进来的文件是什么,不看扩展名(设计 6.4:Chub 的「.png」可能是 HTML 错误页)。

kind_of(path) 的结果:
- card_png    PNG,里面有非空的 chara 或 ccv3 tEXt 块(酒馆卡)
- card_json   JSON 对象:spec 以 chara_card 开头,或者有 name 且有 description / first_mes(V1 平铺)
- image       PNG / JPEG / GIF / WebP(和上传接口收的一样,app/assets/common.py 的 sniff_image_mime)
- audio       MP3 / AAC / M4A / OGG / WAV / FLAC(同 app/api/scenes.py 的 sniff_audio_mime;ftyp 是 AVIF / HEIC 这类图的除外)
- cg_manifest JSON 数组,每一项都是带 name 和 file 的对象(「角色素材/<角色>/CG/import.json」)
- bgm_picks   名字叫 picks.json、值都是文件名列表的 JSON 对象(「BGM候选/picks.json」:{"封面": ["原神.m4a"], …})
- voice_refs  有 character 和 refs 列表的 JSON 对象(语音机上的 refs.json;这次不导,只在报告里提一句)
- other       别的(包括没解开的第三层 zip、坏掉的 JSON、文本)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from app.api.scenes import sniff_audio_mime
from app.assets.common import sniff_image_mime
from app.importer.cards import CARD_KEYS, PNG_SIGNATURE, iter_png_text

Kind = Literal["card_png", "card_json", "image", "audio", "cg_manifest", "bgm_picks", "voice_refs", "other"]

HEAD = 64
# 再大的 JSON 不当清单 / 卡读(Risu 那种把图 base64 塞进卡里的也到不了这么大)
MAX_JSON_BYTES = 64 * 1024 * 1024
# ftyp 盒子里这些品牌是图,不是 m4a
_IMAGE_BRANDS = {b"avif", b"avis", b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1"}
_BOM = b"\xef\xbb\xbf"


def kind_of(path: Path) -> Kind:
    try:
        with open(path, "rb") as f:
            head = f.read(HEAD)
            if head.startswith(PNG_SIGNATURE):
                f.seek(len(PNG_SIGNATURE))
                # 同名的块后一个算数(同前端);块按长度跳过,不读图像数据
                text = dict(iter_png_text(f))
                return "card_png" if any(text.get(k) for k in CARD_KEYS) else "image"
        if sniff_image_mime(head):
            return "image"
        if head[4:8] == b"ftyp" and head[8:12] in _IMAGE_BRANDS:
            return "other"
        if sniff_audio_mime(head):
            return "audio"
        if head.removeprefix(_BOM).lstrip(b" \t\r\n")[:1] in (b"{", b"["):
            return _json_kind(path)
    except OSError:
        pass
    return "other"


def _no_constants(name: str):
    raise ValueError(name)


def _json_kind(path: Path) -> Kind:
    if path.stat().st_size > MAX_JSON_BYTES:
        return "other"
    try:
        text = path.read_bytes().decode("utf-8")
        value = json.loads(text.removeprefix("﻿"), parse_constant=_no_constants)
    except ValueError:  # 不是 UTF-8 也算(UnicodeDecodeError 是 ValueError)
        return "other"
    if isinstance(value, dict):
        spec = value.get("spec")
        if isinstance(spec, str) and spec.startswith("chara_card"):
            return "card_json"
        if isinstance(value.get("name"), str) and ("description" in value or "first_mes" in value):
            return "card_json"
        if isinstance(value.get("character"), str) and isinstance(value.get("refs"), list):
            return "voice_refs"
        if path.name.casefold() == "picks.json" and value and all(_names(v) for v in value.values()):
            return "bgm_picks"
        return "other"
    if isinstance(value, list) and value and all(isinstance(x, dict) and "name" in x and "file" in x for x in value):
        return "cg_manifest"
    return "other"


def _names(v) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)
