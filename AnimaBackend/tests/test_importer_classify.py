"""导入计划(app/importer/classify.py):照暂存目录里的文件,定下要建哪些卡和包、绑到哪张卡、哪些没认出来。

规则见实施计划第 3 段 B4(1–10 条),每条一个用例;最后三个综合用例:酒馆卡 + 平铺表情 zip、
「角色素材\\刻晴」那种目录、带 import.json 的 CG 文件夹(import.json + 子文件夹)。
目录树都是合成的:图用 cv2.imencode 生成的小 PNG / JPEG(每个文件内容不同),音频只有文件头。
"""

import hashlib
import io
import json
import zipfile
import zlib

import cv2
import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import bindings
from app.db import Base
from app.importer.classify import ImportPlan, PlanGroup, build_plan, folder_kind
from app.importer.staging import stage
from app.models import CgAsset, CgPack, PackSprite, SceneAsset, ScenePack, SpritePack, TavernCard
from tests.fixtures.cards.make_cards import b64, png


# ── 素材 ──


def _color(seed: str) -> tuple[int, int, int]:
    n = zlib.crc32(seed.encode("utf-8"))
    return n & 255, (n >> 8) & 255, (n >> 16) & 255


def img(seed: str) -> bytes:
    """内容各不相同的小 PNG"""
    return cv2.imencode(".png", np.full((6, 8, 3), _color(seed), np.uint8))[1].tobytes()


def jpg(seed: str) -> bytes:
    arr = np.full((9, 16, 3), _color(seed), np.uint8)
    arr[0, 0] = (zlib.crc32(seed.encode()) >> 24) & 255
    return cv2.imencode(".jpg", arr)[1].tobytes()


def mp3(seed: str) -> bytes:
    return b"ID3\x04\x00\x00\x00\x00\x00\x00" + seed.encode("utf-8") + bytes(32)


def m4a(seed: str) -> bytes:
    return b"\x00\x00\x00\x20ftypM4A " + seed.encode("utf-8") + bytes(32)


def wav(seed: str) -> bytes:
    return b"RIFF\x00\x00\x00\x00WAVEfmt " + seed.encode("utf-8") + bytes(16)


def card_png(name: str, **fields) -> bytes:
    return png(("chara", b64({"spec": "chara_card_v2", "data": {"name": name, **fields}})))


def card_json(name: str, **fields) -> bytes:
    return json.dumps({"spec": "chara_card_v2", "data": {"name": name, **fields}}, ensure_ascii=False).encode()


def js(value) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def zipped(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ── 夹具 ──


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def plan_of(tmp_path, db):
    def build(files: dict[str, bytes], target: str | None = None, kind: str | None = None) -> ImportPlan:
        tree = stage(list(files.items()), tmp_path / "staging")
        return build_plan(tree, db, target, kind)

    return build


def add_card(db, name: str, **fields) -> TavernCard:
    card = TavernCard(name=name, **fields)
    db.add(card)
    db.flush()
    return card


def groups(plan: ImportPlan, type_: str) -> list[PlanGroup]:
    return [g for g in plan.groups if g.type == type_]


def only(plan: ImportPlan, type_: str) -> PlanGroup:
    found = groups(plan, type_)
    assert len(found) == 1, [(g.type, g.name) for g in plan.groups]
    return found[0]


def named(plan: ImportPlan, name: str) -> PlanGroup:
    found = [g for g in plan.groups if g.name == name]
    assert len(found) == 1, [(g.type, g.name) for g in plan.groups]
    return found[0]


def labels(group: PlanGroup) -> list[str]:
    """按 files 的顺序列出名字(立绘、场景包)"""
    return [group.detail["labels"][p] for p in group.files]


def has_line(plan: ImportPlan, *parts: str) -> bool:
    return any(all(p in line for p in parts) for line in plan.skipped)


# ── 规则 1:跳过 ──


def test_rule1_hidden_and_unrelated_files_are_skipped(plan_of):
    plan = plan_of(
        {
            "Seraphina/expressions/joy.png": img("joy"),
            "Seraphina/expressions/.cache.png": img("cache"),
            "Seraphina/expressions/_old/sad.png": img("old sad"),
            "Seraphina/_备份/joy.png": img("backup"),
            "Seraphina/.git/config": b"[core]",
            "Seraphina/notes.txt": b"hello",
            "Seraphina/readme.md": b"# hi",
            "Seraphina/expressions/list.html": b"<html>",
        }
    )
    sprite = only(plan, "sprite_pack")
    assert sprite.files == ["Seraphina/expressions/joy.png"]
    assert plan.unknown == []
    assert has_line(plan, "「.」或「_」开头", "_备份", "_old")
    assert has_line(plan, "跳过 3 个无关文件")


def test_rule1_files_named_like_images_that_are_not_images_are_reported_as_broken(plan_of):
    """Chub 的表情 zip 里有时是起名 joy.png 的 HTML 错误页:不算「无关文件」,单独说图打不开、可能下载时坏了"""
    plan = plan_of(
        {
            "Seraphina/expressions/joy.png": img("joy"),
            "Seraphina/expressions/sad.png": b"<!DOCTYPE html><html>404</html>",
            "Seraphina/expressions/anger.JPG": b"<html>error</html>",
            "Seraphina/notes.txt": b"hello",
        }
    )
    assert only(plan, "sprite_pack").files == ["Seraphina/expressions/joy.png"]
    assert plan.unknown == []
    assert has_line(plan, "2 张图打不开,没导入(文件名是图片,内容不是;可能下载时坏了):", "sad.png", "anger.JPG")
    assert has_line(plan, "跳过 1 个无关文件(notes.txt)")
    assert not has_line(plan, "无关文件", "sad.png")


def test_rule1_many_broken_images_are_listed_with_a_count(plan_of):
    plan = plan_of({"x/joy.png": img("joy"), **{f"x/{n}.png": b"<html></html>" for n in ("a", "b", "c", "d")}}, kind="sprite")
    assert has_line(plan, "4 张图打不开", "a.png、b.png、c.png 等")
    assert not has_line(plan, "无关文件")


def test_rule1_voice_references_are_not_recognised_this_time(plan_of):
    plan = plan_of(
        {
            "刻晴/立绘/微笑.png": img("smile"),
            "刻晴/语音参考/audio_ja/vo_01.wav": wav("1"),
            "刻晴/语音参考/picks.json": js({"ja:微笑": {"no": 1, "local": "vo_01.wav"}}),
            "refs.json": js({"character": "刻晴", "refs": []}),
            "AI Hobbyist/【中立】你好。.wav": wav("2"),
            "AI Hobbyist/【吃惊】什么?.wav": wav("3"),
        }
    )
    assert [g.type for g in plan.groups] == ["sprite_pack"]
    assert plan.unknown == []
    assert has_line(plan, "声音包这次不认", "语音参考", "refs.json", "AI Hobbyist")


# ── 规则 2:卡 ──


def test_rule2_each_card_owns_the_assets_in_its_own_folder(plan_of):
    plan = plan_of(
        {
            "chub/A/card.png": card_png("Ann", description="怪盗", first_mes="嗨"),
            "chub/A/expressions/joy.png": img("a joy"),
            "chub/B/b.json": card_json("Ben"),
            "chub/B/sprites/joy.png": img("b joy"),
            "chub/B/backgrounds/park.jpg": jpg("b park"),
        }
    )
    ann, ben = groups(plan, "card")
    assert (ann.name, ann.files, ann.owner) == ("Ann", ["chub/A/card.png"], None)
    assert ann.detail["card"]["name"] == "Ann" and ann.detail["card"]["first_mes"] == "嗨"
    assert ann.detail["card"]["avatar"].startswith("data:image/png;base64,")
    assert (ben.name, ben.files) == ("Ben", ["chub/B/b.json"])
    sprites = {g.owner: g.name for g in groups(plan, "sprite_pack")}
    assert sprites == {ann.key: "Ann", ben.key: "Ben"}
    assert only(plan, "scene_pack").owner == ben.key


def test_rule2_a_single_card_owns_everything(plan_of):
    plan = plan_of(
        {
            "card.png": card_png("Seraphina"),
            "stuff/expressions/joy.png": img("joy"),
            "其他/背景/森林.jpg": jpg("forest"),
        }
    )
    card = only(plan, "card")
    assert {g.owner for g in plan.groups if g.type != "card"} == {card.key}


def test_rule2_without_cards_assets_go_to_the_target_card_or_stay_unbound(plan_of, db):
    files = {"expressions/joy.png": img("joy"), "背景/森林.jpg": jpg("forest")}
    target = add_card(db, "刻晴")
    assert {g.owner for g in plan_of(files, target=target.id).groups} == {"target"}
    assert {g.owner for g in plan_of(files).groups} == {None}


def test_rule2_assets_between_two_cards_are_not_guessed(plan_of):
    plan = plan_of(
        {
            "a.png": card_png("Ann"),
            "b.png": card_png("Ben"),
            "expressions/joy.png": img("joy"),
        }
    )
    assert only(plan, "sprite_pack").owner is None


def test_rule2_dragging_onto_a_slot_treats_card_pngs_as_plain_images(plan_of, db):
    target = add_card(db, "刻晴")
    plan = plan_of({"a.png": card_png("Ann"), "b.png": img("b")}, target=target.id, kind="sprite")
    assert [g.type for g in plan.groups] == ["sprite_pack"]
    assert sorted(only(plan, "sprite_pack").files) == ["a.png", "b.png"]


# ── 规则 3:文件夹按名字认 ──


@pytest.mark.parametrize(
    ("name", "kind", "outfit"),
    [
        ("立绘", "sprite", None),
        ("立绘（玉衡星）", "sprite", "玉衡星"),
        ("立绘(女仆)", "sprite", "女仆"),
        ("立绘 (女仆)", "sprite", "女仆"),
        ("Expressions", "sprite", None),
        ("expression", "sprite", None),
        ("SPRITES", "sprite", None),
        ("sprite", "sprite", None),
        ("表情", "sprite", None),
        ("表情包", "sprite", None),
        ("背景", "bg", None),
        ("Backgrounds", "bg", None),
        ("background", "bg", None),
        ("BGs", "bg", None),
        ("bg", "bg", None),
        ("BGM", "bgm", None),
        ("Music", "bgm", None),
        ("音乐", "bgm", None),
        ("曲子", "bgm", None),
        ("BGM候选", "bgm", None),
        ("ＢＧＭ", "bgm", None),
        ("CG", "cg", None),
        ("cgs", "cg", None),
        ("Events", "cg", None),
        ("event", "cg", None),
        ("立绘候选", None, None),
        ("语音参考", None, None),
        ("场景包", None, None),
        ("bgm2", None, None),
    ],
)
def test_rule3_folder_names(name, kind, outfit):
    assert folder_kind(name) == (kind, outfit)


def test_rule3_sprite_subfolders_are_outfits(plan_of):
    plan = plan_of(
        {
            "鴻さゆみ/立绘/home/平静.png": img("home calm"),
            "鴻さゆみ/立绘/home/开心.png": img("home joy"),
            "鴻さゆみ/立绘/pink/平静.png": img("pink calm"),
            "鴻さゆみ/立绘/yukata/平静.png": img("yukata calm"),
        }
    )
    assert [g.name for g in groups(plan, "sprite_pack")] == ["鴻さゆみ · home", "鴻さゆみ · pink", "鴻さゆみ · yukata"]
    assert named(plan, "鴻さゆみ · home").files == ["鴻さゆみ/立绘/home/平静.png", "鴻さゆみ/立绘/home/开心.png"]


def test_rule3_cg_subfolders_are_compositions(plan_of):
    plan = plan_of(
        {
            "X/CG/海边/a.png": img("sea a"),
            "X/CG/海边/默认.png": img("sea base"),
            "X/CG/海边/夜晚·害羞.png": img("sea shy"),
            "X/CG/卧室/b.png": img("room b"),
            "X/CG/卧室/a.png": img("room a"),
            "X/CG/星空.png": img("sky"),
        }
    )
    cg = only(plan, "cg_pack")
    comps = {c["label"]: c for c in cg.detail["compositions"]}
    assert set(comps) == {"海边", "卧室", "星空"}
    assert comps["海边"]["file"] == "X/CG/海边/默认.png"
    assert [(v["label"], v["file"]) for v in comps["海边"]["variants"]] == [
        ("a", "X/CG/海边/a.png"),
        ("夜晚·害羞", "X/CG/海边/夜晚·害羞.png"),
    ]
    assert comps["卧室"]["file"] == "X/CG/卧室/a.png"
    assert [v["label"] for v in comps["卧室"]["variants"]] == ["b"]
    assert comps["星空"] == {"label": "星空", "desc": "", "file": "X/CG/星空.png", "aliases": [], "forms": [], "variants": []}
    assert sorted(cg.files) == sorted(
        ["X/CG/海边/a.png", "X/CG/海边/默认.png", "X/CG/海边/夜晚·害羞.png", "X/CG/卧室/b.png", "X/CG/卧室/a.png", "X/CG/星空.png"]
    )


# ── 规则 4:认不出名字的文件夹、散着的文件 ──


def test_rule4_folder_of_emotion_names_is_a_sprite_pack(plan_of):
    plan = plan_of(
        {
            "misc/01_joy.png": img("joy"),
            "misc/sad-1.png": img("sad"),
            "misc/开心.png": img("开心"),
            "misc/平静.png": img("平静"),
            "misc/random.png": img("random"),
            "photos/a.png": img("a"),
            "photos/b.png": img("b"),
            "photos/joy.png": img("photo joy"),
        }
    )
    sprite = only(plan, "sprite_pack")
    assert sorted(sprite.files) == ["misc/01_joy.png", "misc/random.png", "misc/sad-1.png", "misc/平静.png", "misc/开心.png"]
    assert plan.unknown == ["photos/a.png", "photos/b.png", "photos/joy.png"]


def test_rule4_loose_images_at_the_root_and_loose_audio(plan_of):
    plan = plan_of(
        {
            "joy.png": img("joy"),
            "anger.png": img("anger"),
            "happy.png": img("happy"),
            "a.mp3": mp3("a"),
            "songs/b.mp3": mp3("b"),
        }
    )
    assert sorted(only(plan, "sprite_pack").files) == ["anger.png", "happy.png", "joy.png"]
    scene = only(plan, "scene_pack")
    assert (scene.detail["bg"], sorted(scene.detail["bgm"])) == ([], ["a.mp3", "songs/b.mp3"])


@pytest.mark.parametrize(
    ("kind", "expect"),
    [
        ("sprite", {"sprite_pack": 2}),
        ("bg", {"scene_pack": 1}),
        ("cg", {"cg_pack": 1}),
    ],
)
def test_rule4_dragging_onto_a_slot_forces_the_kind(plan_of, db, kind, expect):
    target = add_card(db, "刻晴")
    plan = plan_of(
        {"photos/a.png": img("a"), "photos/b.png": img("b"), "背景/c.jpg": jpg("c"), "x.mp3": mp3("x")},
        target=target.id,
        kind=kind,
    )
    counts: dict[str, int] = {}
    for g in plan.groups:
        counts[g.type] = counts.get(g.type, 0) + 1
    assert counts == expect
    assert {g.owner for g in plan.groups} == {"target"}
    assert plan.unknown == ["x.mp3"]
    assert plan.forced_kind == kind and plan.target_card_id == target.id
    if kind == "bg":
        scene = only(plan, "scene_pack")
        assert (scene.name, sorted(scene.detail["bg"]), scene.detail["bgm"]) == (
            "刻晴 · 背景",
            ["photos/a.png", "photos/b.png", "背景/c.jpg"],
            [],
        )


def test_rule4_dragging_onto_the_bgm_slot(plan_of, db):
    target = add_card(db, "刻晴")
    plan = plan_of({"a.png": img("a"), "x.mp3": mp3("x"), "more/y.ogg": b"OggS\x00\x02" + bytes(30)}, target=target.id, kind="bgm")
    scene = only(plan, "scene_pack")
    assert (scene.name, scene.detail["bg"], sorted(scene.detail["bgm"])) == ("刻晴 · BGM", [], ["more/y.ogg", "x.mp3"])
    assert plan.unknown == ["a.png"]


def test_rule4_unsupported_forced_kind_is_rejected(plan_of):
    with pytest.raises(ValueError):
        plan_of({"a.png": img("a")}, kind="voice")


# ── 规则 5:角色文件夹 ──


def test_rule5_character_folder_names_the_packs_and_skips_unknown_subfolders(plan_of):
    plan = plan_of(
        {
            "刻晴/立绘/微笑.png": img("smile"),
            "刻晴/音效/a.wav": wav("a"),
            "刻晴/立绘候选/x.png": img("x"),
            "刻晴/开场白试听/index.html": b"<html>",
            "刻晴/场景包/背景/璃月港.jpg": jpg("port"),
            "刻晴/场景包/音乐/日常.mp3": mp3("daily"),
        }
    )
    assert [(g.type, g.name) for g in plan.groups] == [("sprite_pack", "刻晴"), ("scene_pack", "刻晴")]
    assert plan.unknown == []
    assert has_line(plan, "跳过了", "音效", "立绘候选", "开场白试听", "3 个文件夹(这次不认)")


# ── 规则 6:命名 ──


def test_rule6_pack_names_inside_a_character_folder(plan_of):
    plan = plan_of(
        {
            "刻晴/立绘/微笑.png": img("plain smile"),
            "刻晴/立绘（玉衡星）/微笑.png": img("smile"),
            "刻晴/背景/璃月港.jpg": jpg("port"),
            "刻晴/CG/海边.png": img("sea"),
            "香菱/BGM/日常.mp3": mp3("daily"),
        }
    )
    assert [(g.type, g.name) for g in plan.groups] == [
        ("sprite_pack", "刻晴"),
        ("sprite_pack", "刻晴 · 玉衡星"),
        ("scene_pack", "刻晴 · 背景"),
        ("scene_pack", "香菱 · BGM"),
        ("cg_pack", "刻晴 · CG"),
    ]


def test_rule6_card_name_beats_the_folder_name(plan_of):
    plan = plan_of({"sera_dl/card.png": card_png("Seraphina"), "sera_dl/expressions/joy.png": img("joy")})
    assert only(plan, "sprite_pack").name == "Seraphina"


def test_rule6_folder_name_beats_the_target_card_name(plan_of, db):
    target = add_card(db, "刻晴（中文）")
    plan = plan_of({"刻晴/立绘（玉衡星）/微笑.png": img("smile")}, target=target.id)
    assert only(plan, "sprite_pack").name == "刻晴 · 玉衡星"


def test_rule6_target_card_name_beats_the_folder_name_of_a_bare_kind_folder(plan_of, db):
    target = add_card(db, "爱弥斯")
    plan = plan_of({"CG/偷看/默认.jpg": jpg("peek")}, target=target.id)
    assert only(plan, "cg_pack").name == "爱弥斯 · CG"


def test_rule6_zip_or_folder_name_is_the_last_resort(plan_of):
    plan = plan_of({"Tae Takemi.zip": zipped({"joy.png": img("joy"), "neutral.png": img("neutral")})})
    assert only(plan, "sprite_pack").name == "Tae Takemi"
    plan = plan_of({"joy.png": img("joy"), "背景/a.jpg": jpg("a"), "CG/b.png": img("b")})
    assert [g.name for g in plan.groups] == ["立绘", "背景", "CG"]


def test_rule6_names_are_unique_within_the_plan(plan_of):
    plan = plan_of({"刻晴/立绘/微笑.png": img("a"), "刻晴/expressions/joy.png": img("b")})
    assert [g.name for g in plan.groups] == ["刻晴", "刻晴 2"]


# ── 规则 7:立绘名、版本、别名、默认差分 ──


def test_rule7_labels_versions_and_forbidden_characters(plan_of):
    plan = plan_of(
        {
            "expressions/joy.png": img("joy"),
            "expressions/joy-1.png": img("joy-1"),
            "expressions/joy.happy.png": img("joy.happy"),
            "expressions/02_admiration.png": img("admiration"),
            "expressions/【怒】.png": img("怒"),
            "expressions/[x]{y}.png": img("xy"),
            "expressions/00_微笑.png": img("微笑 a"),
            "expressions/微笑.png": img("微笑 b"),
            "expressions/" + "长" * 50 + ".png": img("long"),
        }
    )
    sprite = only(plan, "sprite_pack")
    got = {p.rsplit("/", 1)[1]: sprite.detail["labels"][p] for p in sprite.files}
    assert got == {
        "joy.png": "joy",
        "02_admiration.png": "admiration",
        "【怒】.png": "怒",
        "[x]{y}.png": "xy",
        "00_微笑.png": "微笑",
        "微笑.png": "微笑 2",
        "长" * 50 + ".png": "长" * 40,
    }
    assert sprite.detail["skipped_versions"] == ["expressions/joy-1.png", "expressions/joy.happy.png"]
    assert has_line(plan, "joy-1.png", "2 张", "备用图")


def test_rule7_dictionary_aliases_skip_words_the_pack_already_uses(plan_of):
    plan = plan_of(
        {
            "expressions/joy.png": img("joy"),
            "expressions/happy.png": img("happy"),
            "expressions/smile.png": img("smile"),
            "expressions/微笑.png": img("微笑"),
            "expressions/Love.png": img("love"),
            "expressions/blush.png": img("blush"),
        }
    )
    assert only(plan, "sprite_pack").detail["aliases"] == {"joy": ["开心", "高兴"], "Love": ["喜爱", "心动"], "blush": ["脸红"]}


@pytest.mark.parametrize(
    ("names", "default"),
    [
        (["admiration", "joy", "neutral", "sadness"], "neutral"),
        (["admiration", "joy", "sadness"], "joy"),
        (["03_生气", "00_微笑", "01_开心", "02_平静"], "微笑"),
        (["吃醋", "开心", "平静", "微笑"], "平静"),
        (["吃醋", "开心", "微笑"], "微笑"),
        (["admiration", "anger"], "admiration"),
    ],
)
def test_rule7_default_sprite_comes_first(plan_of, names, default):
    plan = plan_of({f"expressions/{n}.png": img(n) for n in names})
    sprite = only(plan, "sprite_pack")
    assert sprite.detail["default"] == default
    assert labels(sprite)[0] == default


def test_rule7_numbered_files_keep_their_numeric_order(plan_of):
    plan = plan_of({f"立绘/{n}.png": img(n) for n in ["10_疑惑", "2_开心", "00_微笑", "思考"]})
    assert labels(only(plan, "sprite_pack")) == ["微笑", "开心", "疑惑", "思考"]


# ── 规则 8:背景名、曲子名 ──


def test_rule8_backgrounds_are_named_after_their_files(plan_of):
    plan = plan_of({"背景/01_教室.jpg": jpg("a"), "背景/夜/教室.jpg": jpg("b"), "背景/璃月港·夜.jpg": jpg("c")})
    scene = only(plan, "scene_pack")
    assert sorted(scene.detail["labels"][p] for p in scene.detail["bg"]) == ["教室", "教室 2", "璃月港·夜"]
    assert scene.files == scene.detail["bg"]


def test_rule8_picks_only_import_the_chosen_songs_named_by_mood(plan_of):
    plan = plan_of(
        {
            "BGM候选/a.m4a": m4a("a"),
            "BGM候选/b.m4a": m4a("b"),
            "BGM候选/c.m4a": m4a("c"),
            "BGM候选/d.m4a": m4a("d"),
            "BGM候选/e.m4a": m4a("e"),
            "BGM候选/picks.json": js({"封面": ["a.m4a"], "日常": ["b.m4a"], "心动": ["c.m4a", "d.m4a"], "伤感": ["gone.m4a"]}),
            "BGM候选/candidates.json": js([{"mood": "封面", "file": "a.m4a"}]),
        }
    )
    scene = only(plan, "scene_pack")
    assert scene.detail["bgm"] == ["BGM候选/a.m4a", "BGM候选/b.m4a", "BGM候选/c.m4a", "BGM候选/d.m4a"]
    assert labels(scene) == ["a", "日常", "心动", "心动 2"]
    assert scene.detail["cover"] == "BGM候选/a.m4a"
    assert plan.unknown == []
    assert has_line(plan, "picks.json", "1 首没挑中")
    assert has_line(plan, "gone.m4a", "没找到")


def test_rule8_without_picks_every_song_is_imported_and_a_title_song_is_the_cover(plan_of):
    plan = plan_of({"music/01_日常.mp3": mp3("a"), "music/封面曲.mp3": mp3("b"), "music/Title Theme.mp3": mp3("c")})
    scene = only(plan, "scene_pack")
    assert labels(scene) == ["日常", "Title Theme", "封面曲"]
    assert scene.detail["cover"] == "music/封面曲.mp3"
    plan = plan_of({"音乐/伤感.ogg": b"OggS\x00\x02a", "音乐/片头曲.ogg": b"OggS\x00\x02b"})
    assert only(plan, "scene_pack").detail["cover"] == "音乐/片头曲.ogg"
    plan = plan_of({"音乐/伤感.ogg": b"OggS\x00\x02a", "音乐/日常.ogg": b"OggS\x00\x02b"})
    assert only(plan, "scene_pack").detail["cover"] is None


# ── 规则 9:CG 清单 ──


def test_rule9_cg_manifest_with_absolute_windows_paths(plan_of):
    base = "C:\\Users\\someone\\Desktop\\角色素材\\爱弥斯\\CG"
    manifest = [
        {
            "name": "河边·牵手",
            "desc": "场面:牵手|场景参考:河边",
            "file": base + "\\河边·牵手\\默认.jpg",
            "frame": "k11@_02_1_004",
            "forms": ["夜晚"],
            "variants": [
                {"label": "夜晚", "aliases": [], "file": base + "/河边·牵手/夜晚.jpg", "frame": "x"},
                {"label": "夜晚·魅惑", "aliases": ["得意"], "file": base + "\\河边·牵手\\夜晚·魅惑.jpg"},
                {"label": "夜晚·哭泣", "aliases": [], "file": base + "\\河边·牵手\\夜晚·哭泣.jpg"},
            ],
        },
        {"name": "接吻特写", "desc": "接吻", "file": base + "\\接吻特写\\默认.jpg", "forms": [], "focus": 30, "variants": []},
        {"name": "不见了", "desc": "", "file": base + "\\不见了\\默认.jpg", "variants": []},
    ]
    plan = plan_of(
        {
            "CG/import.json": js(manifest),
            "CG/import_cg.py": b"print(1)",
            "CG/河边·牵手/默认.jpg": jpg("bath"),
            "CG/河边·牵手/夜晚.jpg": jpg("bath h"),
            "CG/河边·牵手/夜晚·魅惑.jpg": jpg("bath charm"),
            "CG/接吻特写/默认.jpg": jpg("kiss"),
            "CG/接吻特写/夜晚.jpg": jpg("kiss h"),
        }
    )
    cg = only(plan, "cg_pack")
    first, second = cg.detail["compositions"]
    assert first == {
        "label": "河边·牵手",
        "desc": "场面:牵手|场景参考:河边",
        "file": "CG/河边·牵手/默认.jpg",
        "aliases": [],
        "forms": ["夜晚"],
        "variants": [
            {"label": "夜晚", "aliases": [], "file": "CG/河边·牵手/夜晚.jpg"},
            {"label": "夜晚·魅惑", "aliases": ["得意"], "file": "CG/河边·牵手/夜晚·魅惑.jpg"},
        ],
    }
    assert second == {
        "label": "接吻特写",
        "desc": "接吻",
        "file": "CG/接吻特写/默认.jpg",
        "aliases": [],
        "forms": [],
        "focus": 30,
        "variants": [],
    }
    assert has_line(plan, "夜晚·哭泣.jpg", "没找到")
    assert has_line(plan, "不见了", "没找到")
    assert has_line(plan, "清单没列", "1 张")
    assert has_line(plan, "跳过 1 个无关文件")
    assert plan.unknown == []


# ── 规则 10:重复 ──


def _sprite_pack_in_db(db, name: str, datas: list[bytes]) -> SpritePack:
    pack = SpritePack(name=name)
    db.add(pack)
    db.flush()
    for i, data in enumerate(datas):
        db.add(PackSprite(pack_id=pack.id, label=f"s{i}", image_sha=sha(data), mime="image/png", sort=i))
    db.flush()
    return pack


def test_rule10_same_files_mark_a_duplicate_pack(plan_of, db):
    a, b = img("joy"), img("neutral")
    pack = _sprite_pack_in_db(db, "Seraphina", [b, a])
    card = add_card(db, "Seraphina", description="森林守护者", first_mes="你醒了")
    bindings.replace(db, card.id, bindings.SPRITE, [pack.id], primary=pack.id)
    _sprite_pack_in_db(db, "多一张", [a, b, img("other")])

    scene = ScenePack(name="森林")
    cgp = CgPack(name="森林 · CG")
    db.add_all([scene, cgp])
    db.flush()
    db.add_all(
        [
            SceneAsset(pack_id=scene.id, kind="bg", label="森林", data_sha=sha(jpg("forest")), mime="image/jpeg"),
            SceneAsset(pack_id=scene.id, kind="bgm", label="日常", data_sha=sha(mp3("daily")), mime="audio/mpeg"),
            CgAsset(pack_id=cgp.id, label="篝火", data_sha=sha(img("fire")), mime="image/png"),
        ]
    )
    db.flush()

    plan = plan_of(
        {
            "card.png": card_png("Seraphina", description="森林守护者", first_mes="你醒了"),
            "expressions/joy.png": a,
            "expressions/neutral.png": b,
            "backgrounds/森林.jpg": jpg("forest"),
            "bgm/日常.mp3": mp3("daily"),
            "CG/篝火.png": img("fire"),
        }
    )
    assert only(plan, "card").duplicate_of == {"id": card.id, "name": "Seraphina"}
    assert only(plan, "sprite_pack").duplicate_of == {"id": pack.id, "name": "Seraphina", "card_count": 1}
    assert only(plan, "scene_pack").duplicate_of == {"id": scene.id, "name": "森林", "card_count": 0}
    assert only(plan, "cg_pack").duplicate_of == {"id": cgp.id, "name": "森林 · CG", "card_count": 0}


def test_rule10_different_contents_are_not_duplicates(plan_of, db):
    _sprite_pack_in_db(db, "Seraphina", [img("joy")])
    add_card(db, "Seraphina", description="别的描述", first_mes="你醒了")
    plan = plan_of(
        {
            "card.png": card_png("Seraphina", description="森林守护者", first_mes="你醒了"),
            "expressions/joy.png": img("joy"),
            "expressions/neutral.png": img("neutral"),
        }
    )
    assert [g.duplicate_of for g in plan.groups] == [None, None]


def test_rule10_rows_still_holding_their_bytes_in_the_database_are_hashed(plan_of, db):
    data = img("joy")
    pack = SpritePack(name="旧包")
    db.add(pack)
    db.flush()
    db.add(PackSprite(pack_id=pack.id, label="joy", image=data, image_sha=None, mime="image/png"))
    db.flush()
    plan = plan_of({"expressions/joy.png": data})
    assert only(plan, "sprite_pack").duplicate_of == {"id": pack.id, "name": "旧包", "card_count": 0}


def test_rule10_songs_that_get_converted_are_compared_as_they_would_be_stored(plan_of, db):
    """WAV / OGG / FLAC 导入时转成 m4a(app/importer/audio.py):查重按转好的那份比,不按原件"""
    pytest.importorskip("av")
    from app.importer import audio
    from tests.test_importer_audio import real_wav

    song = real_wav()
    stored = audio.compress_bgm(song, audio.IMPORT_BITRATE)
    scene = ScenePack(name="旧场景")
    db.add(scene)
    db.flush()
    db.add(SceneAsset(pack_id=scene.id, kind="bgm", label="晚安", data_sha=sha(stored), mime="audio/mp4"))
    db.flush()
    plan = plan_of({"bgm/晚安.wav": song})
    assert only(plan, "scene_pack").duplicate_of == {"id": scene.id, "name": "旧场景", "card_count": 0}


# ── 综合 ──


def test_tavern_card_with_a_flat_chub_expression_zip(plan_of):
    names = ["joy", "joy-1", "neutral", "admiration", "anger", "love", "surprise"]
    plan = plan_of(
        {
            "Seraphina.png": card_png("Seraphina", description="森林守护者"),
            "expressions.zip": zipped({f"Seraphina/{n}.png": img(n) for n in names}),
        }
    )
    card, sprite = plan.groups
    assert (card.type, card.name, card.owner) == ("card", "Seraphina", None)
    assert (sprite.type, sprite.name, sprite.owner) == ("sprite_pack", "Seraphina", card.key)
    assert labels(sprite) == ["neutral", "admiration", "anger", "joy", "love", "surprise"]
    assert sprite.detail["default"] == "neutral"
    assert sprite.detail["aliases"] == {
        "neutral": ["平静", "默认"],
        "admiration": ["钦佩", "崇拜"],
        "anger": ["生气", "愤怒"],
        "joy": ["开心", "高兴"],
        "love": ["喜爱", "心动"],
        "surprise": ["惊讶", "吃惊"],
    }
    assert sprite.detail["skipped_versions"] == ["expressions/Seraphina/joy-1.png"]
    assert (plan.unknown, plan.target_card_id, plan.forced_kind) == ([], None, None)
    assert card.key != sprite.key and len({g.key for g in plan.groups}) == 2


def test_character_folder_like_keqing(plan_of, db):
    target = add_card(db, "刻晴")
    songs = ["原神", "杯中明月", "晚安_璃月", "小小的光", "无虑无猜的岁月", "霆霓快雨"]
    files = {
        "刻晴/刻晴角色卡.md": "# 刻晴".encode(),
        "刻晴/立绘（玉衡星）/00_微笑.png": img("a smile"),
        "刻晴/立绘（玉衡星）/01_开心.png": img("a joy"),
        "刻晴/立绘（玉衡星）/02_喜爱.png": img("a love"),
        "刻晴/立绘（玉衡星·平涂）/00_微笑.png": img("b smile"),
        "刻晴/立绘（玉衡星·平涂）/01_开心.png": img("b joy"),
        "刻晴/背景/刻晴的房间.jpg": jpg("room"),
        "刻晴/背景/刻晴的房间·夜.jpg": jpg("room night"),
        "刻晴/背景/璃月港·夜.jpg": jpg("port"),
        **{f"刻晴/BGM候选/{s}.m4a": m4a(s) for s in songs},
        "刻晴/BGM候选/candidates.json": js([{"mood": "封面", "cn": "原神", "file": "原神.m4a"}]),
        "刻晴/BGM候选/picks.json": js(
            {"封面": ["原神.m4a"], "日常": ["杯中明月.m4a"], "温馨": ["晚安_璃月.m4a"], "心动": ["小小的光.m4a", "无虑无猜的岁月.m4a"]}
        ),
        "刻晴/语音参考/audio_ja/vo_keqing_01.wav": wav("1"),
        "刻晴/语音参考/gen_zh/vo_keqing_01.wav": wav("2"),
        "刻晴/语音参考/index.html": b"<html>",
        "刻晴/语音参考/picks.json": js({"ja:微笑": {"no": 1, "local": "vo_keqing_01.wav"}}),
    }
    plan = plan_of(files, target=target.id)
    assert [(g.type, g.name, g.owner) for g in plan.groups] == [
        ("sprite_pack", "刻晴 · 玉衡星", "target"),
        ("sprite_pack", "刻晴 · 玉衡星·平涂", "target"),
        ("scene_pack", "刻晴", "target"),
    ]
    official = named(plan, "刻晴 · 玉衡星")
    assert labels(official) == ["微笑", "开心", "喜爱"]
    assert (official.detail["default"], official.detail["aliases"], official.detail["skipped_versions"]) == ("微笑", {}, [])
    scene = named(plan, "刻晴")
    assert [scene.detail["labels"][p] for p in scene.detail["bg"]] == ["刻晴的房间", "刻晴的房间·夜", "璃月港·夜"]
    assert [scene.detail["labels"][p] for p in scene.detail["bgm"]] == ["原神", "日常", "温馨", "心动", "心动 2"]
    assert scene.detail["cover"] == "刻晴/BGM候选/原神.m4a"
    assert scene.files == scene.detail["bg"] + scene.detail["bgm"]
    assert plan.unknown == []
    assert has_line(plan, "语音参考", "声音包这次不认")
    assert has_line(plan, "跳过 2 个无关文件")
    assert has_line(plan, "1 首没挑中")
    assert all(g.duplicate_of is None for g in plan.groups)


def test_cg_folder_like_a_real_export(plan_of, db):
    target = add_card(db, "爱弥斯")
    base = "C:\\Users\\someone\\Desktop\\角色素材\\爱弥斯\\CG\\"
    comps = {"雨中撑伞": ["夜晚", "夜晚·害羞"], "接吻特写": ["夜晚", "夜晚·魅惑"]}
    manifest = [
        {
            "name": name,
            "desc": f"{name} 的说明",
            "file": f"{base}{name}\\默认.jpg",
            "frame": "k11",
            "forms": ["夜晚"],
            "variants": [{"label": v, "aliases": ["得意"] if "魅惑" in v else [], "file": f"{base}{name}\\{v}.jpg", "frame": "k"} for v in vs],
        }
        for name, vs in comps.items()
    ]
    files = {"CG/import.json": js(manifest), "CG/import_cg.py": b"import json"}
    for name, vs in comps.items():
        files[f"CG/{name}/默认.jpg"] = jpg(name)
        for v in vs:
            files[f"CG/{name}/{v}.jpg"] = jpg(name + v)
    plan = plan_of(files, target=target.id)
    cg = only(plan, "cg_pack")
    assert (cg.name, cg.owner, cg.duplicate_of) == ("爱弥斯 · CG", "target", None)
    got = [(c["label"], c["desc"], c["forms"], c["file"], [(v["label"], v["aliases"], v["file"]) for v in c["variants"]]) for c in cg.detail["compositions"]]
    assert got == [
        (
            "雨中撑伞",
            "雨中撑伞 的说明",
            ["夜晚"],
            "CG/雨中撑伞/默认.jpg",
            [("夜晚", [], "CG/雨中撑伞/夜晚.jpg"), ("夜晚·害羞", [], "CG/雨中撑伞/夜晚·害羞.jpg")],
        ),
        (
            "接吻特写",
            "接吻特写 的说明",
            ["夜晚"],
            "CG/接吻特写/默认.jpg",
            [("夜晚", [], "CG/接吻特写/夜晚.jpg"), ("夜晚·魅惑", ["得意"], "CG/接吻特写/夜晚·魅惑.jpg")],
        ),
    ]
    assert len(cg.files) == 6
    assert plan.unknown == []
    assert has_line(plan, "跳过 1 个无关文件")
    assert not has_line(plan, "没找到")
