"""导入时的小字典(app/importer/aliases.py;设计稿 1.7):酒馆表情包的英文名 → 自动加的中文别名,和认表情用的词表。
私有的那一行在 test_importer_aliases_private.py(公开版连它一起删)。"""

import json
from pathlib import Path

from app.importer import aliases

REPO = Path(__file__).resolve().parents[2]


def test_dictionary_is_the_design_table():
    table = json.loads((REPO / "AnimaBackend/app/importer/expression_aliases.json").read_text("utf-8"))
    # 设计稿 1.7:GoEmotions 28 个,再接「其他常见英文名」(私有的那一行不在这份里,见 expression_aliases.private.json)
    assert list(table) == (
        "neutral joy amusement excitement optimism gratitude relief approval admiration love caring desire pride "
        "embarrassment nervousness fear surprise realization curiosity confusion sadness disappointment remorse "
        "grief anger annoyance disapproval disgust "
        "smile smirk wink shy blush happy sad angry cry pout worried think awkward question curious relaxed bored "
        "serious suspicious victory sleep jealous"
    ).split()
    assert table["neutral"] == ["平静", "默认"]
    assert table["joy"] == ["开心", "高兴"]
    assert table["disgust"] == ["厌恶", "嫌弃"]
    assert table["smile"] == ["微笑"] and table["jealous"] == ["吃醋"] and table["sleep"] == ["困"]


def test_private_file_is_merged_when_present_and_ignored_when_missing(tmp_path):
    public = tmp_path / "public.json"
    public.write_text(json.dumps({"joy": ["开心"], "Smile": ["微笑"]}), "utf-8")
    private = tmp_path / "private.json"
    private.write_text(json.dumps({"pout": ["嘟嘴"], "joy": ["高兴", "开心"]}), "utf-8")
    assert aliases.load(public, private) == {"joy": ["开心", "高兴"], "smile": ["微笑"], "pout": ["嘟嘴"]}
    assert aliases.load(public, tmp_path / "missing.json") == {"joy": ["开心"], "smile": ["微笑"]}


def test_shipped_dictionary_and_vocabulary():
    assert aliases.chinese_aliases("JOY") == ["开心", "高兴"]
    assert aliases.chinese_aliases("微笑") == []
    vocab = aliases.vocabulary()
    # 小字典的英文名和中文别名、内置 16 种表情和它们的别名,都按 casefold 存
    for word in ("admiration", "崇拜", "smirk", "坏笑", "平静", "忧郁", "melancholic", "talk", "jealous"):
        assert word in vocab
    assert "玉衡星" not in vocab
