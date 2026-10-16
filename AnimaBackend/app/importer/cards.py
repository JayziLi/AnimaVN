"""读酒馆角色卡(PNG 的 tEXt 块 / 裸 JSON),结果和前端导入卡时 POST 给 /api/tavern/cards 的那份一字不差。

前端的做法(frontend/src/debug/lib/cardParser.ts 的 parseCardFile + cardStore.ts 的 cardToStored,
DebugApp.tsx 的 loadCard 再补上头像),这里逐条照搬:
- PNG:只读 tEXt 块(键和正文都按 latin1),同名的后一个盖前一个,读到 IEND 为止;先读 ccv3、再读 chara
  (空串当没有);base64 → UTF-8(去掉开头的 BOM)→ JSON。头像 = 整个 PNG 的 data URL。
- JSON:UTF-8(去掉 BOM)→ JSON;头像只认卡里 avatar 字段的 data:image… (酒馆卡常年写字面量 "none")。
- 字段:V2 / V3 读 data,V1 读根上;不是字符串的当空串,数组里不是字符串的扔掉;
  creator_notes 是空的就退回根上的 creatorcomment(V1);spec 没写当 chara_card_v1;
  世界书照 characterBook.ts 读了又原样写回:不是对象、entries 不是数组的当没有,entries 里只留对象,
  entries 排到最后。V3 多出来的字段(nickname、assets、group_only_greetings……)前端不收,这里也不收。
对拍:tests/fixtures/cards/ 里的合成卡,两边都和 *.expected.json 比(tests/test_importer_cards.py、
frontend/src/debug/lib/cardParser.fixtures.test.ts)。

和前端不一样的地方(都是前端会建卡失败、这里给个说得通的结果):认 PNG 看文件头而不是扩展名;
extensions 是数组时当空对象(建卡接口只收对象);整个 JSON 是数组时报错(前端会建出一张空卡)。
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import re
import struct
from collections.abc import Iterator
from typing import BinaryIO

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CARD_KEYS = ("ccv3", "chara")  # ccv3 是新规格,chara 是向后兼容的镜像
# 前端 String.prototype.trim 在 latin1 范围里去掉的空白(\x85 它不算,Python 的 strip 算)
_JS_TRIM = " \t\n\v\f\r\xa0"
_B64_JUNK = re.compile(r"[\t\n\f\r ]")  # atob 会跳过的 ASCII 空白
_B64_BAD = re.compile(r"[^A-Za-z0-9+/]")


class CardError(ValueError):
    """不是能读的角色卡;消息是给人看的中文"""


def iter_png_text(f: BinaryIO) -> Iterator[tuple[str, str]]:
    """PNG 里的 tEXt 块(键, 正文),都按 latin1 解;别的块按长度跳过不读。f 要停在签名后面"""
    while True:
        head = f.read(8)
        if len(head) < 8:
            return
        length, kind = struct.unpack(">I4s", head)
        if kind == b"tEXt":
            body = f.read(length)
            nul = body.find(b"\x00")
            if nul != -1:
                yield body[:nul].decode("latin1"), body[nul + 1 :].decode("latin1")
            f.seek(4, 1)  # CRC
        elif kind == b"IEND":
            return
        else:
            f.seek(length + 4, 1)


def png_text(data: bytes) -> dict[str, str]:
    """整个 PNG 的 tEXt 块;同名的后一个盖前一个(同前端的 Map.set)"""
    if not data.startswith(PNG_SIGNATURE):
        raise CardError("不是合法的 PNG 文件")
    f = io.BytesIO(data)
    f.seek(len(PNG_SIGNATURE))
    return dict(iter_png_text(f))


def _atob(text: str) -> bytes:
    """浏览器 atob 的宽松 base64:跳过 ASCII 空白,末尾的 = 可有可无"""
    s = _B64_JUNK.sub("", text)
    if len(s) % 4 == 0 and s.endswith("="):
        s = s[:-2] if s.endswith("==") else s[:-1]
    if len(s) % 4 == 1 or _B64_BAD.search(s):
        raise CardError("角色卡数据不是合法的 base64")
    try:
        return base64.b64decode(s + "=" * (-len(s) % 4))
    except binascii.Error as e:
        raise CardError("角色卡数据不是合法的 base64") from e


def _utf8(data: bytes) -> str:
    """同 TextDecoder('utf-8'):坏字节换成 U+FFFD,开头的 BOM 去掉"""
    text = data.decode("utf-8", errors="replace")
    return text[1:] if text.startswith("﻿") else text


def _no_constants(name: str):
    raise ValueError(f"JSON 里不能有 {name}")


def _json(text: str):
    try:
        return json.loads(text, parse_constant=_no_constants)
    except ValueError as e:
        raise CardError(f"角色卡不是合法的 JSON:{e}") from e


def _str(v) -> str:
    return v if isinstance(v, str) else ""


def _strs(v) -> list[str]:
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def _data_url(v) -> str | None:
    return v if isinstance(v, str) and v.startswith("data:image") else None


def _book(v) -> dict | None:
    """characterBook.ts 的 serializeBook(parseBook(v)):没改过的条目原样写回,entries 排到最后"""
    if not isinstance(v, dict) or not isinstance(v.get("entries"), list):
        return None
    rest = {k: x for k, x in v.items() if k != "entries"}
    return {**rest, "entries": [e for e in v["entries"] if isinstance(e, dict)]}


def normalize(raw, avatar: str | None = None) -> dict:
    """卡的 JSON 对象 → 建卡接口收的那份(cardToStored + avatar);avatar 不给就用卡里的 data URL"""
    if not isinstance(raw, dict):
        raise CardError("角色卡内容不是一个对象")
    d = raw.get("data")
    if d is None:
        d = raw  # V1 平铺
    if not isinstance(d, dict):
        d = {}
    ext = d.get("extensions")
    return {
        "name": _str(d.get("name")),
        "description": _str(d.get("description")),
        "personality": _str(d.get("personality")),
        "scenario": _str(d.get("scenario")),
        "first_mes": _str(d.get("first_mes")),
        "mes_example": _str(d.get("mes_example")),
        "system_prompt": _str(d.get("system_prompt")),
        "post_history_instructions": _str(d.get("post_history_instructions")),
        "creator_notes": _str(d.get("creator_notes")) or _str(raw.get("creatorcomment")),
        "alternate_greetings": _strs(d.get("alternate_greetings")),
        "tags": _strs(d.get("tags")),
        "creator": _str(d.get("creator")),
        "character_version": _str(d.get("character_version")),
        "character_book": _book(d.get("character_book")),
        "extensions": ext if isinstance(ext, dict) else {},
        "spec": _str(raw.get("spec")) or "chara_card_v1",
        "avatar": avatar if avatar is not None else _data_url(d.get("avatar")),
    }


def parse_card(data: bytes) -> dict:
    """一张卡文件(PNG 或 JSON)→ 建卡接口收的那份。读不出卡就抛 CardError"""
    if data.startswith(PNG_SIGNATURE):
        chunks = png_text(data)
        for key in CARD_KEYS:
            payload = chunks.get(key)
            if payload:
                raw = _json(_utf8(_atob(payload.strip(_JS_TRIM))))
                return normalize(raw, "data:image/png;base64," + base64.b64encode(data).decode("ascii"))
        found = ", ".join(chunks) or "无"
        raise CardError(f"PNG 里没有找到角色卡数据(chara / ccv3 chunk)。读到的 chunk: {found}")
    return normalize(_json(_utf8(data)))
