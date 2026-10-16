"""生成这个目录里的合成酒馆卡(导入器对拍用,素材架构第 3 段 B3)。

    python tests/fixtures/cards/make_cards.py        (在 AnimaBackend 目录里跑)

卡是手搓的:最小的 1×1 PNG + tEXt 块(chara / ccv3,base64 的 JSON),或者裸 JSON(V1 平铺 / V2 / V3)。
期望结果 *.expected.json 是前端算出来的(导入卡时 POST 的那份):在 frontend 目录里
    UPDATE_CARD_FIXTURES=1 npx vitest run src/debug/lib/cardParser.fixtures.test.ts
后端 tests/test_importer_cards.py、前端 cardParser.fixtures.test.ts 都和它逐字段比。
no_card.png 没有期望结果:两边都要报「没有找到角色卡数据」。
"""

import base64
import json
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIGNATURE = b"\x89PNG\r\n\x1a\n"


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(*texts: tuple[str, str]) -> bytes:
    """1×1 的 RGBA PNG;tEXt 块照酒馆的写法放在 IEND 前面"""
    out = SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(b"\x00\xff\x80\x00\xff"))
    for key, text in texts:
        out += chunk(b"tEXt", key.encode("latin1") + b"\x00" + text.encode("latin1"))
    return out + chunk(b"IEND", b"")


def b64(card: dict) -> str:
    return base64.b64encode(json.dumps(card, ensure_ascii=False).encode("utf-8")).decode("ascii")


def write_json(name: str, card, bom: bool = False) -> None:
    data = json.dumps(card, ensure_ascii=False, indent=1).encode("utf-8")
    (HERE / name).write_bytes((b"\xef\xbb\xbf" if bom else b"") + data)


BOOK = {
    "name": "璃月见闻",
    "entries": [
        {
            "id": 3,
            "keys": ["玉衡", "七星"],
            "secondary_keys": [],
            "comment": "玉衡星",
            "content": "刻晴是璃月七星之一的玉衡星。",
            "constant": False,
            "selective": True,
            "insertion_order": 100,
            "enabled": True,
            "position": "before_char",
            "extensions": {"position": 0, "depth": 4, "probability": 100, "useProbability": True, "group": ""},
        },
        {"keys": ["帝君"], "content": "岩王帝君。", "enabled": False, "insertion_order": 50, "use_regex": True},
    ],
    "scan_depth": 3,
    "extensions": {"chub": {"alt_expressions": {}}},
}

V2_KEQING = {
    "name": "Keqing (root mirror)",
    "description": "根上的镜像,应该被 data 盖过",
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "刻晴",
        "description": "璃月七星之一,玉衡星。\n做事雷厉风行。",
        "personality": "认真、要强",
        "scenario": "璃月港的午后",
        "first_mes": "*刻晴抱着一摞公文走过来*\n「你来得正好。」",
        "mes_example": "<START>\n{{user}}: 休息一下吧\n{{char}}: 「……就一会儿。」",
        "system_prompt": "",
        "post_history_instructions": "保持角色。",
        "creator_notes": "原神同人卡,合成的测试样本",
        "alternate_greetings": ["「又见面了。」", "「今天的公文还没批完。」"],
        "tags": ["原神", "Genshin", "女性"],
        "creator": "AnimaVN 测试",
        "character_version": "1.2",
        "character_book": BOOK,
        "extensions": {"talkativeness": "0.5", "fav": False, "depth_prompt": {"prompt": "", "depth": 4, "role": "system"}},
    },
}

V2_OLD = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {"name": "旧名字", "description": "chara 块里的旧版本", "first_mes": "旧的开场白"},
}

V3_NEW = {
    "spec": "chara_card_v3",
    "spec_version": "3.0",
    "data": {
        "name": "星绘 ✨ ほしえ",
        "nickname": "小星",
        "description": "ccv3 块里的新版本 🌟",
        "personality": "",
        "scenario": "",
        "first_mes": "「欢迎回来!」",
        "mes_example": "",
        "creator_notes": "",
        "system_prompt": "你是星绘。",
        "post_history_instructions": "",
        "alternate_greetings": [],
        "group_only_greetings": ["「大家好~」"],
        "tags": ["原创", "🌟"],
        "creator": "",
        "character_version": "",
        "extensions": {"world": "星庇所"},
        "assets": [{"type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png"}],
        "creation_date": 1760000000,
    },
}

V1_FLAT = {
    "name": "Seraphina",
    "description": "A guardian of the forest glade.",
    "personality": "caring, protective",
    "scenario": "{{user}} wakes up in the glade.",
    "first_mes": "*Seraphina smiles* You're awake.",
    "mes_example": "",
    "creatorcomment": "V1 卡的作者注释放在 creatorcomment",
    "avatar": "none",
    "talkativeness": "0.5",
    "tags": ["fantasy", 3, "guardian"],
    "data": None,
}

V2_AVATAR = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "creatorcomment": "根上的 creatorcomment:data.creator_notes 是空串时退回这里",
    "data": {
        "name": "DeepSeek娘",
        "description": "鲸鱼娘",
        "personality": "",
        "scenario": "",
        "first_mes": "主人好~",
        "mes_example": "",
        "creator_notes": "",
        "system_prompt": "",
        "post_history_instructions": "",
        "alternate_greetings": ["a", None, "b", 7],
        "tags": [],
        "creator": "",
        "character_version": "",
        "character_book": {"entries": [BOOK["entries"][1], "不是条目", 5, ["数组也不是"]], "name": "小书"},
        "extensions": {},
        "avatar": "data:image/png;base64," + base64.b64encode(png()).decode("ascii"),
    },
}

V3_BOM = {
    "spec": "chara_card_v3",
    "spec_version": "3.0",
    "data": {
        "name": "鴻さゆみ",
        "description": "日语名字、文件带 BOM",
        "first_mes": "おかえりなさい。",
        "character_book": {"entries": "坏掉的世界书"},
        "avatar": "none",
        "extensions": {"depth_prompt": {"prompt": "", "depth": 4}},
    },
}


def main() -> None:
    (HERE / "v2_chara.png").write_bytes(png(("Software", "AnimaVN fixtures"), ("chara", b64(V2_KEQING))))
    # ccv3 优先(不管块的先后);payload 里夹着换行和首尾空格,前端 atob 前会 trim、会跳过换行
    wrapped = b64(V3_NEW)
    wrapped = "  " + "\n".join(wrapped[i : i + 76] for i in range(0, len(wrapped), 76)) + "\n"
    (HERE / "v3_ccv3_and_chara.png").write_bytes(png(("chara", b64(V2_OLD)), ("ccv3", wrapped)))
    # ccv3 是空串:当它不存在,读 chara
    (HERE / "ccv3_empty.png").write_bytes(png(("ccv3", ""), ("chara", b64(V2_OLD))))
    (HERE / "no_card.png").write_bytes(png(("Software", "just a picture")))
    write_json("v1_flat.json", V1_FLAT)
    write_json("v2_with_avatar.json", V2_AVATAR)
    write_json("v3_bom.json", V3_BOM, bom=True)


if __name__ == "__main__":
    main()
