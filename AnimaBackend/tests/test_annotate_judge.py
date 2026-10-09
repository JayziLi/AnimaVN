"""Jev 标注的题目怎么出、答案怎么变成标注(纯函数,不发请求)。"""

from app.annotate.judge import (
    CG_OFF,
    CG_OFF_FALLBACK,
    CONTEXT_LINES,
    DEFAULT_PROMPTS,
    KEEP,
    KEEP_FALLBACK,
    AnnotateInput,
    Choice,
    Line,
    SceneState,
    Thresholds,
    build_request,
    decide,
)

SPRITES = [
    Choice("微笑", ("开心",), "嘴角上扬,心情不错"),
    Choice("害羞", (), "脸红,不敢看人"),
    Choice("生气", (), ""),
]
BGS = [Choice("教室", (), "白天的教室"), Choice("食堂", (), "学校食堂"), Choice("操场")]
BGMS = [Choice("日常", (), "轻松"), Choice("紧张", (), "危机、对峙")]


def make_input(lines, targets, **overrides) -> AnnotateInput:
    base = {
        "char": "星绘",
        "user": "Lj",
        "prev": "——去食堂",
        "lines": lines,
        "targets": targets,
        "emotions": SPRITES,
        "bgs": BGS,
        "bgms": BGMS,
        "scene": SceneState(bg="教室", bgm="日常"),
    }
    base.update(overrides)
    return AnnotateInput(**base)


LINES = [
    Line("两人走进了食堂。", None),
    Line("「哇,今天有咖喱!」", "星绘"),
    Line("「小心烫。」", "店员"),
]


def test_state_holds_the_reply_up_to_the_last_target():
    state, _ = build_request(make_input(LINES, [1]))
    assert state["说明"] == DEFAULT_PROMPTS["state"].replace("{{char}}", "星绘").replace("{{user}}", "Lj")
    assert state["本条回复"] == [
        {"句": 1, "类型": "旁白", "内容": "两人走进了食堂。"},
        {"句": 2, "类型": "引号里的话", "内容": "「哇,今天有咖喱!」"},
    ]
    assert state["玩家上一句"] == "——去食堂"
    assert state["现在的场景"] == "教室"
    assert state["现在的背景音乐"] == "日常"


def test_long_replies_only_carry_the_recent_lines():
    lines = [Line(f"第{i}句旁白。", None) for i in range(40)]
    state, _ = build_request(make_input(lines, [30], bgs=[], bgms=[]))
    assert [x["句"] for x in state["本条回复"]] == list(range(31 - CONTEXT_LINES, 32))
    assert f"前面的 {30 - CONTEXT_LINES} 句省略了" in state["说明"]
    short, _ = build_request(make_input(lines, [5], bgs=[], bgms=[]))
    assert "省略" not in short["说明"]


def test_dialogue_asks_speaker_and_emotion():
    _, q = build_request(make_input(LINES, [1]))
    assert set(q) == {"s2", "e2"}
    assert q["s2"]["instructions"] == "第 2 句 「哇,今天有咖喱!」 是谁说的?"
    assert q["s2"]["criteria"]["user"].startswith("玩家「Lj」说的话")
    assert q["e2"]["criteria"] == {
        "微笑": "嘴角上扬,心情不错(也叫:开心)",
        "害羞": "脸红,不敢看人",
        "生气": "生气",
    }


def test_scene_and_music_are_one_choice_with_a_keep_option():
    _, q = build_request(make_input(LINES, [0]))
    assert set(q) == {"bg1", "bgm1"}
    bg = q["bg1"]
    assert bg["type"] == "choice"
    assert "还在「教室」就选「不换」" in bg["instructions"]
    # 「不换」排第一,现在这个不单列
    assert list(bg["criteria"]) == [KEEP, "食堂", "操场"]
    assert bg["criteria"][KEEP] == "还在「教室」(白天的教室):没换地方,白天夜晚也没变"
    assert list(q["bgm1"]["criteria"]) == [KEEP, "紧张"]
    assert q["bgm1"]["criteria"][KEEP] == "现在这首「日常」(轻松)还合适"


def test_the_first_line_is_asked_about_the_scene_even_when_it_is_dialogue():
    lines = [Line("「早上好!」", "星绘"), Line("她伸了个懒腰。", None)]
    _, q = build_request(make_input(lines, [0, 1]))
    assert set(q) == {"s1", "e1", "bg1", "bgm1", "bg2", "bgm2"}


def test_only_the_jev_kinds_are_asked():
    # 只有背景是 Jev:不问谁说的、表情、音乐
    _, q = build_request(make_input(LINES, [0, 1], ask_speaker=False, emotions=[], bgms=[]))
    assert set(q) == {"bg1"}
    # 只有玩家台词是 Jev:只问谁说的
    _, q = build_request(make_input(LINES, [0, 1], emotions=[], bgs=[], bgms=[]))
    assert set(q) == {"s2"}
    # 只有一个背景:没得换
    _, q = build_request(make_input(LINES, [0], bgs=BGS[:1], bgms=[]))
    assert q == {}


def test_scene_and_music_are_not_asked_again_once_changed_in_this_reply():
    changed = SceneState(bg="食堂", bgm="紧张", bg_changed=True, bgm_changed=True)
    state, q = build_request(make_input(LINES, [0], scene=changed))
    assert q == {}
    assert "现在的场景" not in state and "现在的背景音乐" not in state


def test_named_npc_lines_are_not_asked():
    _, q = build_request(make_input(LINES, [2]))
    assert q == {}


def test_edited_prompts_replace_the_defaults():
    prompts = {
        "state": "{{char}} 和 {{user}} 的故事。",
        "emotion": "第 {{n}} 句,{{char}} 的表情?",
        "speaker_none": "心里话",
        "bg": "第 {{n}} 句在哪?现在在「{{current}}」",
        "bg_keep": "就在{{current}}{{current_desc}}",
    }
    state, q = build_request(make_input(LINES, [0, 1], prompts=prompts))
    assert state["说明"] == "星绘 和 Lj 的故事。"
    assert q["e2"]["instructions"] == "第 2 句,星绘 的表情?"
    assert q["s2"]["criteria"]["none"] == "心里话"
    assert q["s2"]["criteria"]["char"] == "星绘本人说出口的话"
    assert q["bg1"]["instructions"] == "第 1 句在哪?现在在「教室」"
    assert q["bg1"]["criteria"][KEEP] == "就在教室(白天的教室)"


def test_keep_option_is_renamed_when_an_asset_is_called_that():
    bgs = [Choice(KEEP), Choice("食堂")]
    _, q = build_request(make_input(LINES, [0], bgs=bgs, bgms=[], scene=SceneState(bg="食堂")))
    assert list(q["bg1"]["criteria"]) == [KEEP_FALLBACK, KEEP]


def answer(choice, prob=0.9, confidence=None):
    return {"type": "choice", "choice": choice, "confidence": confidence if confidence is not None else prob,
            "probabilities": {choice: prob}}


def test_decide_takes_emotion_for_the_characters_lines():
    out = decide(make_input(LINES, [1]), {"s2": answer("char", 0.97), "e2": answer("微笑", 0.6)})
    assert [(d.index, d.speaker, d.emotion, d.bg, d.bgm) for d in out] == [(1, "char", "微笑", None, None)]
    assert out[0].confidence == {"speaker": 0.97, "emotion": 0.6}


def test_decide_only_believes_not_the_character_when_sure():
    inp = make_input(LINES, [1])
    unsure = decide(inp, {"s2": answer("other", 0.79), "e2": answer("害羞")})
    assert (unsure[0].speaker, unsure[0].emotion) == ("char", "害羞")
    sure = decide(inp, {"s2": answer("user", 0.8), "e2": answer("害羞")})
    assert (sure[0].speaker, sure[0].emotion) == ("user", None)
    # 门槛可调
    strict = decide(make_input(LINES, [1], thresholds=Thresholds(speaker=0.95)), {"s2": answer("user", 0.9)})
    assert strict[0].speaker == "char"


def test_decide_switches_only_when_not_keep_and_sure_enough():
    inp = make_input(LINES, [0])
    moved = decide(inp, {"bg1": answer("食堂", 0.6), "bgm1": answer(KEEP, 0.9)})
    assert (moved[0].bg, moved[0].bgm) == ("食堂", None)
    assert moved[0].speaker is None and moved[0].emotion is None
    unsure = decide(inp, {"bg1": answer("食堂", 0.59), "bgm1": answer("紧张", 0.7)})
    assert (unsure[0].bg, unsure[0].bgm) == (None, "紧张")
    # 门槛可调
    picky = decide(make_input(LINES, [0], thresholds=Thresholds(bg=0.9, bgm=0.9)),
                   {"bg1": answer("食堂", 0.8), "bgm1": answer("紧张", 0.8)})
    assert (picky[0].bg, picky[0].bgm) == (None, None)


def test_decide_uses_the_chosen_options_probability():
    # confidence 和 probabilities 不一样时以选中那项的概率为准
    out = decide(make_input(LINES, [0]), {"bg1": answer("食堂", prob=0.65, confidence=0.3)})
    assert out[0].bg == "食堂"


def test_decide_keeps_only_the_first_change_when_judging_several_lines():
    lines = [Line("两人走进了食堂。", None), Line("窗外突然打起了雷。", None), Line("灯灭了。", None)]
    out = decide(
        make_input(lines, [2, 0, 1]),
        {
            "bg1": answer("食堂"), "bgm1": answer(KEEP),
            "bg2": answer("操场"), "bgm2": answer("紧张"),
            "bg3": answer("食堂"), "bgm3": answer("日常"),
        },
    )
    assert [(d.index, d.bg, d.bgm) for d in out] == [(0, "食堂", None), (1, None, "紧张"), (2, None, None)]


def test_decide_ignores_answers_it_did_not_ask_for_or_does_not_know():
    inp = make_input(LINES, [1])
    out = decide(inp, {"s2": answer("char"), "e2": answer("不存在的表情")})
    assert (out[0].speaker, out[0].emotion) == ("char", None)
    missing = decide(inp, {})
    assert (missing[0].speaker, missing[0].emotion) == ("char", None)
    same_place = decide(make_input(LINES, [0]), {"bg1": answer("教室")})
    assert same_place[0].bg is None


# ── CG ──

CGS = [
    Choice("海边散步", (), "傍晚的海边,两人并肩走在沙滩上"),
    Choice("海边烟花", (), "夜晚的海边,两人一起抬头看烟花"),
    Choice("撑伞", (), "下雨天,她和你撑着同一把伞"),
]


def cg_input(targets, cg=None, **overrides):
    return make_input(
        LINES, targets, emotions=[], bgs=[], bgms=[], cgs=CGS, ask_speaker=False,
        scene=SceneState(cg=cg, place="海边(傍晚的沙滩)"), **overrides,
    )


def test_cg_is_asked_for_every_line_with_the_place_and_the_current_picture():
    state, q = build_request(cg_input([0, 1, 2], cg="撑伞"))
    assert set(q) == {"cg1", "cg2", "cg3"}
    assert state["现在的地点(背景)"] == "海边(傍晚的沙滩)"
    assert state["现在的画面"] == "CG「撑伞」:下雨天,她和你撑着同一把伞"
    # 现在的那张不单列,用「不换」代替;「不显示CG」排在它后面
    assert list(q["cg1"]["criteria"]) == [KEEP, CG_OFF, "海边散步", "海边烟花"]
    assert "第 1 句" in q["cg1"]["instructions"]


def test_cg_without_a_picture_has_no_keep_option():
    state, q = build_request(cg_input([0]))
    assert state["现在的画面"] == "没有 CG(显示立绘和背景)"
    assert list(q["cg1"]["criteria"]) == [CG_OFF, "海边散步", "海边烟花", "撑伞"]


def test_cg_sums_similar_pictures_before_comparing_with_the_threshold():
    # 两张海边的各 0.4:单看哪张都过不了 0.6,加起来 0.8 就换成高的那张
    split = {"type": "choice", "choice": "海边散步", "confidence": 0.42,
             "probabilities": {"海边散步": 0.42, "海边烟花": 0.38, CG_OFF: 0.2}}
    out = decide(cg_input([0]), {"cg1": split})
    assert (out[0].cg, out[0].cg_off) == ("海边散步", False)
    assert out[0].confidence["cg"] == 0.8


def test_cg_keeps_or_turns_off_or_stays_put_when_unsure():
    keep = decide(cg_input([0], cg="撑伞"), {"cg1": answer(KEEP, 0.9)})
    assert (keep[0].cg, keep[0].cg_off, keep[0].confidence) == (None, False, {})
    off = decide(cg_input([0], cg="撑伞"), {"cg1": answer(CG_OFF, 0.7)})
    assert (off[0].cg, off[0].cg_off) == (None, True)
    # 本来就没有 CG:「不显示CG」什么都不用做
    nothing = decide(cg_input([0]), {"cg1": answer(CG_OFF, 0.95)})
    assert (nothing[0].cg, nothing[0].cg_off) == (None, False)
    unsure = decide(cg_input([0], cg="撑伞"), {"cg1": answer("海边烟花", 0.5)})
    assert (unsure[0].cg, unsure[0].cg_off) == (None, False)
    picky = decide(cg_input([0], thresholds=Thresholds(cg=0.9)), {"cg1": answer("海边烟花", 0.85)})
    assert picky[0].cg is None


def test_cg_options_with_reserved_names_get_renamed():
    cgs = [Choice(CG_OFF), Choice(KEEP), Choice("撑伞")]
    _, q = build_request(make_input(LINES, [0], emotions=[], bgs=[], bgms=[], cgs=cgs, ask_speaker=False,
                                    scene=SceneState(cg="撑伞")))
    assert list(q["cg1"]["criteria"])[:2] == [KEEP_FALLBACK, CG_OFF_FALLBACK]
