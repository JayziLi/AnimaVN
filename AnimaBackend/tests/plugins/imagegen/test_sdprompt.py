"""本地 SD 的提示词:NovelAI 写法转 A1111 写法、各段的顺序、LoRA、保护词"""

import pytest

from app.plugins.imagegen.assemble import ADULT_GUARD, SFW_GUARD, Look, Person, Plan, Style
from app.plugins.imagegen.backends.base import LoraUse
from app.plugins.imagegen.sdprompt import SD_QUALITY, SD_UC, lora_tag, sd_prompt, to_sd_tags

XH = Person(who="星绘", tags="smile, waving", clothes="school uniform", look="long hair, blue eyes")
MIRA = Person(who="Mira", tags="sitting", clothes="suit", look="short hair")
LOOKS = {"星绘": Look(), "Mira": Look(gender="male", name_tag="mira (example)")}


def tags_of(text: str) -> list[str]:
    return [t.strip() for t in text.split(",")]


# ---- to_sd_tags ----


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        # 角色名里的括号是字面的,不转义 A1111 会当成加权
        ("keqing (genshin impact)", r"keqing \(genshin impact\)"),
        # 已经转义的不重复转
        (r"keqing \(genshin impact\)", r"keqing \(genshin impact\)"),
        # 已经是 A1111 加权写法的不动
        ("(smile:1.2)", "(smile:1.2)"),
        ("(smile:.8), hat", "(smile:.8), hat"),
        # 加权里面的角色名照样转义
        ("(keqing (genshin impact):1.2)", r"(keqing \(genshin impact\):1.2)"),
        # 落单的括号也转义,不然后面整串都被算进加权
        ("a (b", r"a \(b"),
        ("a) b", r"a\) b"),
    ],
)
def test_literal_parens(raw, want):
    assert to_sd_tags(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("1.4::smile::", "(smile:1.4)"),
        ("1.4::a, b::", "(a, b:1.4)"),
        ("2::a::", "(a:2)"),
        ("0.50::a::, b", "(a:0.5), b"),
        (".5::a::", "(a:0.5)"),
        ("1.2:: a, b ::", "(a, b:1.2)"),
        # 转义要先做:权重里的角色名
        ("1.4::keqing (genshin impact)::", r"(keqing \(genshin impact\):1.4)"),
    ],
)
def test_nai_weight(raw, want):
    assert to_sd_tags(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("a, 0::b::, c", "a, c"),
        ("a, -1::b, d::, c", "a, c"),
        ("0::b::, c", "c"),
        ("a, -0.5::b::", "a"),
        ("0::b::", ""),
        # 空的权重也别留一对括号
        ("a, 1.4::::, c", "a, c"),
    ],
)
def test_zero_or_negative_weight_is_dropped(raw, want):
    assert to_sd_tags(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("{smile}", "(smile:1.05)"),
        ("{{smile}}", "((smile:1.05):1.05)"),
        ("{{{a}}}, b", "(((a:1.05):1.05):1.05), b"),
        ("{a, b}", "(a, b:1.05)"),
        ("{a {b}}", "(a (b:1.05):1.05)"),
        ("{keqing (genshin impact)}", r"(keqing \(genshin impact\):1.05)"),
        ("1.4::{a}::", "((a:1.05):1.4)"),
        ("a, {}, b", "a, b"),
    ],
)
def test_braces(raw, want):
    assert to_sd_tags(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("artist:foo, bar", "foo, bar"),
        ("1.2::artist:foo::", "(foo:1.2)"),
        ("{artist:foo}", "(foo:1.05)"),
        ("artist:foo (bar)", r"foo \(bar\)"),
        # 加权一个叫 artist 的标签,不是画师前缀
        ("(artist:1.2)", "(artist:1.2)"),
    ],
)
def test_artist_prefix(raw, want):
    assert to_sd_tags(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        (",, a,,  b , ,c,", "a, b, c"),
        ("  a  b  ", "a b"),
        ("", ""),
        (" , ", ""),
    ],
)
def test_tidy(raw, want):
    assert to_sd_tags(raw) == want


def test_converting_twice_changes_nothing():
    once = to_sd_tags("keqing (genshin impact), 1.4::a, b::, {{c}}, artist:d")
    assert to_sd_tags(once) == once


# ---- lora_tag ----


@pytest.mark.parametrize(
    ("use", "want"),
    [
        (LoraUse("style_x", 0.8), "<lora:style_x:0.8>"),
        (LoraUse("style_x"), "<lora:style_x:1>"),
        (LoraUse("style_x", 5), "<lora:style_x:2>"),
        (LoraUse("style_x", -1), "<lora:style_x:0>"),
        (LoraUse("a<b>:c\nd\r", 1), "<lora:abcd:1>"),
        (LoraUse("  style x  ", 1), "<lora:style x:1>"),
        (LoraUse("", 1), ""),
        (LoraUse("<:>\n", 1), ""),
    ],
)
def test_lora_tag(use, want):
    assert lora_tag(use) == want


# ---- sd_prompt ----


def test_order_of_all_parts():
    plan = Plan(scene="classroom, sunset", people=(XH,), composition="She stands by the window, looking back.")
    style = Style(tags="flat color", artists="artist:foo")
    pos, _ = sd_prompt(plan, {"星绘": Look()}, style, quality="masterpiece", loras=(LoraUse("style_x", 0.8),))
    assert pos == (
        "1girl, solo, long hair, blue eyes, school uniform, smile, waving, foo, classroom, sunset, "
        "She stands by the window, looking back., flat color, masterpiece, <lora:style_x:0.8>"
    )


def test_gender_word_is_taken_off_each_person():
    pos, _ = sd_prompt(Plan(people=(XH, MIRA)), LOOKS, Style())
    tags = tags_of(pos)
    assert "girl" not in tags and "boy" not in tags
    assert tags[:3] == ["1girl", "1boy", "couple"]


def test_people_come_right_after_count_with_name_tag_escaped():
    pos, _ = sd_prompt(Plan(people=(MIRA,)), {"Mira": LOOKS["Mira"]}, Style())
    assert pos == r"1boy, solo, mira \(example\), short hair, suit, sitting"


def test_two_people_keep_their_order():
    pos, _ = sd_prompt(Plan(people=(XH, MIRA)), LOOKS, Style())
    assert pos.index("long hair") < pos.index("short hair")


def test_trigger_word_goes_right_after_count():
    pos, _ = sd_prompt(Plan(people=(XH,)), {"星绘": Look()}, Style(), loras=(LoraUse("style_x", 1, trigger="xh style"),))
    assert pos.startswith("1girl, solo, xh style, long hair")


def test_tags_said_twice_appear_once():
    plan = Plan(scene="smile, park", people=(XH,))
    pos, _ = sd_prompt(plan, {"星绘": Look()}, Style(tags="park"), quality="smile")
    assert tags_of(pos).count("smile") == 1 and tags_of(pos).count("park") == 1


def test_lora_tags_are_last_joined_by_space_and_not_escaped():
    loras = (LoraUse("style (v2)", 0.7), LoraUse("other", 1))
    pos, _ = sd_prompt(Plan(people=(XH,)), {"星绘": Look()}, Style(), quality="masterpiece", loras=loras)
    assert pos.endswith(", masterpiece, <lora:style (v2):0.7> <lora:other:1>")


def test_sends_exactly_the_loras_it_is_given():
    # 开关由调用方过滤:传进来几个就发几个
    pos, _ = sd_prompt(Plan(people=(XH,)), {"星绘": Look()}, Style(), loras=(LoraUse("only_this", 1),))
    assert pos.count("<lora:") == 1 and "<lora:only_this:1>" in pos
    pos, _ = sd_prompt(Plan(people=(XH,)), {"星绘": Look()}, Style())
    assert "<lora:" not in pos


def test_empty_lora_name_is_skipped():
    pos, _ = sd_prompt(Plan(people=(XH,)), {"星绘": Look()}, Style(), loras=(LoraUse("<>", 1),))
    assert "lora" not in pos and not pos.endswith(",")


def test_nai_syntax_in_any_part_is_converted():
    plan = Plan(scene="{classroom}", people=(Person(who="星绘", tags="1.3::smile::", look="keqing (genshin impact)"),))
    pos, neg = sd_prompt(plan, {"星绘": Look()}, Style(artists="artist:foo"), uc="{{bad hands}}")
    assert r"keqing \(genshin impact\)" in pos and "(smile:1.3)" in pos and "(classroom:1.05)" in pos
    assert "artist:" not in pos and tags_of(pos).count("foo") == 1
    assert "((bad hands:1.05):1.05)" in neg


def test_first_person_does_not_draw_the_player():
    looks = {"我": Look(gender="male", player=True), "星绘": Look()}
    plan = Plan(people=(Person(who="我", tags="grabbing", look="black jacket"), XH), pov=True)
    pos, neg = sd_prompt(plan, looks, Style())
    assert pos.startswith("1girl, pov, long hair")
    assert "black jacket" not in pos and "grabbing" not in pos and "1boy" not in pos
    # 玩家的手要画得到,反向不挡 1boy
    assert "1boy" not in tags_of(neg) and "multiple boys" in tags_of(neg)


def test_scenery_without_people():
    pos, neg = sd_prompt(Plan(scene="beach, night"), {}, Style(), quality="masterpiece")
    assert pos == "no humans, scenery, beach, night, masterpiece"
    assert ADULT_GUARD in neg


def test_nothing_at_all_still_gives_a_prompt():
    pos, neg = sd_prompt(Plan(), {}, Style())
    assert pos == "no humans, scenery"
    assert ADULT_GUARD in neg


def test_nsfw_words_follow_the_same_rule_as_novelai():
    plan = Plan(people=(Person(who="Mira", tags="topless", look="short hair"),))
    pos, _ = sd_prompt(plan, {"Mira": LOOKS["Mira"]}, Style())
    assert tags_of(pos)[:4] == ["1boy", "solo", "nsfw", "uncensored"]
    pos, _ = sd_prompt(plan, {"Mira": LOOKS["Mira"]}, Style(), sfw_only=True)
    assert "nsfw" not in tags_of(pos) and "uncensored" not in tags_of(pos)


def test_negative_has_presets_style_each_person_and_guards():
    looks = {"星绘": Look(negative="freckles"), "Mira": Look(gender="male", negative="beard")}
    _, neg = sd_prompt(Plan(people=(XH, MIRA)), looks, Style(negative="sketch"), uc="lowres")
    tags = tags_of(neg)
    for word in ("lowres", "sketch", "freckles", "beard", "loli", "child", "chibi", "aged down"):
        assert word in tags


def test_guard_stays_when_negative_is_empty_otherwise():
    _, neg = sd_prompt(Plan(people=(XH,)), {"星绘": Look()}, Style())
    assert ADULT_GUARD in neg


@pytest.mark.parametrize(
    ("uc", "char_negative"),
    [
        # 写了权重 0 的同名标签:去重会吃掉后面的保护词,转换再把这一段删掉
        ("0::loli, child, chibi, aged down::", ""),
        # 没写完的权重,和后面的角色反向凑成一对,把保护词夹在中间删掉
        ("0::oops", "tail::"),
    ],
)
def test_guard_survives_weight_tricks(uc, char_negative):
    looks = {"星绘": Look(negative=char_negative)}
    _, neg = sd_prompt(Plan(people=(XH,)), looks, Style(), uc=uc)
    tags = tags_of(neg)
    for word in ("loli", "child", "chibi", "aged down"):
        assert word in tags


def test_sfw_only_guard_is_there_and_survives():
    _, neg = sd_prompt(Plan(people=(XH,)), {"星绘": Look(negative="tail::")}, Style(), uc="0::oops", sfw_only=True)
    tags = tags_of(neg)
    for word in tags_of(SFW_GUARD):
        assert word in tags


# ---- 预设 ----


def test_quality_presets():
    assert set(SD_QUALITY) == {"standard", "light", "none"}
    assert SD_QUALITY["none"] == ""
    assert "masterpiece" in SD_QUALITY["standard"] and "masterpiece" in SD_QUALITY["light"]


def test_uc_presets():
    assert set(SD_UC) == {"heavy", "light", "human", "none"}
    assert SD_UC["none"] == ""
    assert all("lowres" in SD_UC[k] for k in ("heavy", "light", "human"))
    # 反向预设自己是普通标签,转换前后一样
    assert all(to_sd_tags(v) == v for v in SD_UC.values())
