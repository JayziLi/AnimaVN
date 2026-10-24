"""生图卡带:组 NovelAI 请求体、拼提示词、读指导模型回的 JSON、接口(不访问网络:NovelAI 和指导模型都换成假的)。"""

import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.plugins.imagegen import api as imagegen_api
from app.plugins.imagegen import nai, writer
from app.plugins.imagegen.assemble import (
    ADULT_GUARD,
    SFW_GUARD,
    Look,
    Person,
    Plan,
    Style,
    assemble,
    explicit,
    join,
)
from app.plugins.imagegen.models import IMAGE_REF, UPLOAD_REF
from app.storage import refs


def png_bytes(color=(200, 120, 160)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 32), color).save(buf, "PNG")
    return buf.getvalue()


def sprite_png(w=100, h=300) -> bytes:
    """透明底、中间一块粉色的立绘"""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    im.paste((230, 150, 190, 255), (w // 4, h // 4, w * 3 // 4, h * 3 // 4))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def decoded(b64: str) -> Image.Image:
    import base64

    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


# ── 请求体 ──


def test_body_for_v5_with_two_people_lets_novelai_place_them_unless_asked():
    body = nai.build_body(
        nai.Request(
            prompt="1girl, 1boy, couple, beach",
            negative="lowres",
            width=1344,
            height=768,
            seed=7,
            model=nai.V5_CURATED,
            chars=(nai.CharPrompt("girl, pink hair", "", 0.35, 0.5), nai.CharPrompt("boy", "long hair", 0.65, 0.5)),
        )
    )
    p = body["parameters"]
    assert body["model"] == nai.V5_CURATED and body["input"] == "1girl, 1boy, couple, beach"
    assert p["params_version"] == 4 and p["seed"] == 7 and p["extra_noise_seed"] == 7
    # 默认不给坐标(AI's Choice):10-18 指导模型定的坐标常把两个人挤在一起画糊
    assert p["v4_prompt"]["use_coords"] is False and p["use_coords"] is False
    assert p["v4_negative_prompt"]["caption"]["char_captions"][1]["char_caption"] == "long hair"
    assert p["characterPrompts"][0]["prompt"] == "girl, pink hair"


def test_body_for_v45_single_person_has_no_positions():
    p = nai.build_body(nai.Request("1girl", "", 832, 1216, 1, model=nai.V45_FULL, chars=(nai.CharPrompt("girl"),)))["parameters"]
    assert p["params_version"] == 3 and p["use_coords"] is False


def test_noise_schedule_variety_and_rescale_follow_the_web_page():
    v45 = nai.build_body(
        nai.Request("1girl", "", 832, 1216, 1, model=nai.V45_FULL, noise_schedule="exponential", cfg_rescale=0.3, variety=True)
    )["parameters"]
    assert v45["noise_schedule"] == "exponential" and v45["cfg_rescale"] == 0.3
    # Variety+ 照网页:58 × √(面积 / 832×1216)
    assert v45["skip_cfg_above_sigma"] == 58
    big = nai.build_body(nai.Request("1girl", "", 1664, 2432, 1, model=nai.V45_FULL, variety=True))["parameters"]
    assert big["skip_cfg_above_sigma"] == 116
    # 没选噪声调度按采样器的默认;V5 固定 karras、没有 Variety+
    assert nai.build_body(nai.Request("x", "", 832, 1216, 1, model=nai.V45_FULL, sampler="k_dpmpp_2m"))["parameters"]["noise_schedule"] == "exponential"
    v5 = nai.build_body(nai.Request("x", "", 832, 1216, 1, model=nai.V5_FULL, noise_schedule="exponential", variety=True))["parameters"]
    assert v5["noise_schedule"] == "karras" and "skip_cfg_above_sigma" not in v5


def test_presets_are_the_web_pages_text_for_each_model():
    assert nai.uc_preset(nai.V5_CURATED, "light").endswith("0::ai-generated::")
    assert nai.uc_preset(nai.V45_CURATED, "heavy").startswith("blurry, lowres, upscaled")
    assert nai.uc_preset(nai.V45_FULL, "none") == "" and nai.uc_preset(nai.V45_FULL, "furry") == ""
    assert nai.quality_tags(nai.V5_FULL, "light") == "very aesthetic, amazing quality, no text"
    # V4.5 没有 Light:用 Standard;Curated 的 Standard 多两个词
    assert nai.quality_tags(nai.V45_FULL, "light") == "very aesthetic, masterpiece, no text"
    assert nai.quality_tags(nai.V45_CURATED, "standard").endswith("rating:general")
    assert nai.quality_tags(nai.V5_FULL, "none") == ""


def test_free_range_is_one_megapixel_and_28_steps():
    assert nai.is_free(1344, 768, 23) and nai.is_free(1024, 1024, 28)
    assert not nai.is_free(1536, 1024, 23) and not nai.is_free(1344, 768, 29)


def test_reference_is_sent_only_to_v45():
    ref = nai.Reference(image=b"PNG")
    v45 = nai.build_body(nai.Request("1girl", "", 832, 1216, 1, model=nai.V45_FULL, reference=ref))["parameters"]
    assert v45["director_reference_images"] == ["UE5H"]
    assert v45["director_reference_descriptions"][0]["caption"]["base_caption"] == "character"
    assert v45["director_reference_strength_values"] == [1.0]
    styled = nai.build_body(nai.Request("1girl", "", 832, 1216, 1, model=nai.V45_CURATED, reference=nai.Reference(b"x", style=True)))
    assert styled["parameters"]["director_reference_descriptions"][0]["caption"]["base_caption"] == "character&style"
    v5 = nai.build_body(nai.Request("1girl", "", 832, 1216, 1, model=nai.V5_FULL, reference=ref))["parameters"]
    assert "director_reference_images" not in v5


def test_reference_canvas_pads_to_a_size_novelai_takes():
    tall = Image.open(io.BytesIO(nai.reference_canvas(sprite_png(100, 300)))).convert("RGB")
    assert tall.size == (1024, 1536)
    # 透明的地方垫白、四周补黑、人在中间
    assert tall.getpixel((512, 768)) == (230, 150, 190)
    assert tall.getpixel((512, 100)) == (255, 255, 255)
    assert tall.getpixel((5, 768)) == (0, 0, 0)
    assert Image.open(io.BytesIO(nai.reference_canvas(sprite_png(300, 200)))).size == (1536, 1024)
    assert Image.open(io.BytesIO(nai.reference_canvas(sprite_png(200, 200)))).size == (1472, 1472)
    with pytest.raises(nai.NaiError):
        nai.reference_canvas(b"not an image")


def test_unzip_takes_the_png():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("image_0.png", b"PNGDATA")
    assert nai.unzip_png(buf.getvalue()) == b"PNGDATA"
    with pytest.raises(nai.NaiError):
        nai.unzip_png(b"not a zip")


# ── 拼提示词 ──

WIKIRA = Look(tags="adult, pink hair, side braid", gender="female", outfit="off-shoulder blouse, long skirt")
PLAYER = Look(tags="faceless male, short black hair", gender="male", player=True, outfit="black shirt")


def test_name_tag_goes_first_artists_after_count_and_reference_drops_the_face():
    keqing = Look(tags="purple hair, twintails", outfit="purple dress", name_tag="keqing (genshin impact)")
    she = Person("刻晴", "smile", clothes="white hanfu", look="purple hair, hair down")
    out = assemble(Plan(scene="tea house", people=(she,)), {"刻晴": keqing},
                   Style("flat color", artists="artist:foo, artist:bar"), model=nai.V45_FULL, quality="")
    assert out.prompt == "1girl, solo, artist:foo, artist:bar, tea house, flat color"
    # 角色名标签照旧由代码加;长相和衣服是指导模型写的这一刻的,卡上的(twintails、purple dress)不补
    assert out.chars[0].prompt == "girl, keqing (genshin impact), purple hair, hair down, white hanfu, smile"
    # 带参考图也写这一刻的长相(10-22 对比:不写的话发型变化画不出来);老画面带参考图时照旧不补卡上的长相
    with_ref = {"刻晴": Look(**{**keqing.__dict__, "ref": True})}
    ref = assemble(Plan(people=(she,)), with_ref, Style(), model=nai.V45_FULL)
    assert ref.chars[0].prompt == "girl, keqing (genshin impact), purple hair, hair down, white hanfu, smile"
    old = assemble(Plan(people=(Person("刻晴", "smile"),)), with_ref, Style(), model=nai.V45_FULL)
    assert old.chars[0].prompt == "girl, keqing (genshin impact), purple dress, smile"


def tags_of(text: str) -> set[str]:
    return {t.strip() for t in text.split(",")}


def test_first_person_drops_the_player_and_adds_nothing_for_his_hands():
    plan = Plan(scene="street, night, pov hands, holding hands",
                people=(Person("Wikira", "looking back, smile", look=""), Person("玩家", "walking", look="")), pov=True)
    out = assemble(plan, {"Wikira": WIKIRA, "玩家": PLAYER}, Style("flat color"), model=nai.V45_FULL, quality="")
    # 10-22 起不按玩家的衣服补袖子颜色
    assert out.prompt == "1girl, pov, street, night, pov hands, holding hands, flat color"
    assert [c.prompt for c in out.chars] == ["girl, looking back, smile"] and out.chars[0].negative == ""
    neg = tags_of(out.negative)
    assert "multiple boys" in neg and "1boy" not in neg and "solo" not in out.prompt


def test_join_drops_empties_and_duplicates():
    assert join("a, b", "", "B, c,, ") == "a, b, c"


def test_the_writers_look_and_clothes_are_drawn_as_written():
    """10-22 Wikira 那张:剧情里光着脚,以前代码照样补 pantyhose, flats。现在长相衣服全听指导模型的"""
    she = Person("Wikira", "sitting on sofa, curled toes", clothes="casual dress, cardigan, barefoot", look="adult, pink hair, hair down")
    out = assemble(Plan(scene="living room, night", people=(she,)), {"Wikira": WIKIRA},
                   Style("rough sketch, monochrome"), model=nai.V5_FULL, uc="lowres")
    assert out.prompt.startswith("1girl, solo, living room, night, rough sketch, monochrome, very aesthetic")
    assert out.chars[0].prompt == "girl, adult, pink hair, hair down, casual dress, cardigan, barefoot, sitting on sofa, curled toes"
    assert out.chars[0].x == 0.5
    for guard in ("lowres", ADULT_GUARD.split(",")[0], "1boy", "2girls"):
        assert guard in out.negative
    assert out.model == nai.V5_FULL
    # 指导模型什么都没写也不补卡上的
    bare = assemble(Plan(people=(Person("Wikira", "sitting", look=""),)), {"Wikira": WIKIRA}, Style(), model=nai.V5_FULL)
    assert bare.chars[0].prompt == "girl, sitting"


def test_old_pictures_still_get_the_card_look_and_usual_outfit():
    """10-22 以前存的画面没有 look:「换一张」照老规矩补,画出来和以前一样"""
    out = assemble(Plan(people=(Person("Wikira", "sitting, smile"),)), {"Wikira": WIKIRA}, Style(), model=nai.V5_FULL)
    assert out.chars[0].prompt == "girl, adult, pink hair, side braid, off-shoulder blouse, long skirt, sitting, smile"
    pajamas = assemble(Plan(people=(Person("Wikira", "lying", clothes="pajamas"),)), {"Wikira": WIKIRA}, Style(), model=nai.V5_FULL)
    assert pajamas.chars[0].prompt == "girl, adult, pink hair, side braid, pajamas, lying"
    # nsfw 场面没写这一刻穿什么:不加平时的衣服
    bed = assemble(Plan(scene="bed", people=(Person("Wikira", "lying"),), nsfw=True), {"Wikira": WIKIRA}, Style(), model=nai.V5_FULL)
    assert "long skirt" not in bed.chars[0].prompt


def test_couple_and_the_player_gets_no_extra_clothes():
    plan = Plan(scene="park", people=(Person("Wikira", "hug", look=""), Person("Lj", "hug", clothes="black shirt", look="faceless male")))
    out = assemble(plan, {"Wikira": WIKIRA, "Lj": PLAYER}, Style(), model=nai.V5_CURATED)
    assert out.prompt.startswith("1girl, 1boy, couple, park")
    assert {(c.x, c.y) for c in out.chars} == {(0.5, 0.5)}  # 不给坐标
    # 10-22 起不补 fully clothed、不挡 shirtless
    assert out.chars[1].prompt == "boy, faceless male, black shirt, hug" and out.chars[1].negative == ""
    assert "1boy" not in out.negative.split(", ")[:3]  # 两个人时不挡男的
    old = assemble(Plan(people=(Person("Wikira", "hug"), Person("Lj", "hug"))), {"Wikira": WIKIRA, "Lj": PLAYER}, Style(), model=nai.V5_CURATED)
    assert "fully clothed" not in old.chars[1].prompt and "black shirt" in old.chars[1].prompt


def test_explicit_tags_make_it_nsfw_without_asking_the_writer():
    nude = Plan(scene="bed", people=(Person("Wikira", "lying, spread legs", clothes="nude", look=""), Person("Lj", "sex", look="")))
    out = assemble(nude, {"Wikira": WIKIRA, "Lj": PLAYER}, Style(), model=nai.V5_FULL)
    assert "hetero" in out.prompt and "nsfw" in tags_of(out.prompt) and "uncensored" in tags_of(out.prompt)
    # 整词才算:sexy、analog 不算
    assert not explicit(Plan(scene="sexy pose, analog clock", people=(Person("Wikira", "smile", look="medium breasts"),)))
    assert not assemble(nude, {"Wikira": WIKIRA}, Style(), model=nai.V5_FULL, sfw_only=True).prompt.count("nsfw")


def test_sfw_only_switches_to_curated_and_blocks_nsfw():
    plan = Plan(scene="bed", people=(Person("Wikira", "lying"),), nsfw=True)
    out = assemble(plan, {"Wikira": WIKIRA}, Style(), model=nai.V5_FULL, sfw_only=True)
    assert out.model == nai.V5_CURATED
    assert SFW_GUARD.split(",")[0] in out.negative and "hetero" not in out.prompt


def test_nobody_is_scenery_and_unknown_people_guess_gender_from_tags():
    assert assemble(Plan(scene="sea"), {}, Style(), model=nai.V5_CURATED).prompt.startswith("no humans, scenery, sea")
    out = assemble(Plan(people=(Person("店员", "1boy, apron"),)), {}, Style(), model=nai.V5_CURATED)
    assert out.prompt.startswith("1boy, solo")


# ── 指导模型回的 JSON ──


def test_parse_fenced_json_and_coerce_fields():
    text = '```json\n{"draw": "true", "at": 99, "importance": 5, "reason": "第一次牵手", "title": "河堤牵手", "description": "河堤上第一次牵手",' \
           ' "scene": ["riverbank", "sunset"], "people": [{"who": "Wikira", "look": ["pink hair", "wet hair"], "tags": ["holding hands", "blush"],' \
           ' "clothes": "yukata"}, "Lj"], "nsfw": "true"}\n```'
    r = writer.to_result(writer.parse_json(text), mode="auto", n_lines=10)
    assert r.draw is True and r.at == 9 and r.importance == 3
    assert r.plan.scene == "riverbank, sunset"
    # look 一律是字符串(没写是空串),None 只留给老画面
    assert r.plan.people == (Person("Wikira", "holding hands, blush", "yukata", "pink hair, wet hair"), Person("Lj", look=""))
    # nsfw 不再听它的(10-22:不让模型管 nsfw)
    assert r.plan.nsfw is False and r.title == "河堤牵手" and r.description == "河堤上第一次牵手"


def test_not_drawing_needs_no_picture_but_drawing_does():
    assert writer.to_result({"draw": False, "reason": "闲聊"}, mode="auto", n_lines=3).draw is False
    with pytest.raises(writer.WriterError):
        writer.to_result({"description": "空的"}, mode="manual")
    with pytest.raises(writer.WriterError):
        writer.parse_json("我觉得这里不用画")


def test_camera_setting_decides_pov_unless_the_writer_may_choose():
    data = {"scene": "cafe", "people": [{"who": "Wikira"}], "pov": False}
    assert writer.to_result(data, mode="manual").plan.pov is True
    assert writer.to_result({**data, "pov": True}, mode="manual", camera="third").plan.pov is False
    assert writer.to_result(data, mode="manual", camera="auto").plan.pov is False
    assert writer.to_result({**data, "pov": "true"}, mode="manual", camera="auto").plan.pov is True


def test_camera_note_follows_the_skill_even_when_rewritten():
    ctx = writer.Context(cast=[], lines=[writer.Line(None, "a")], focus=0)
    for camera, word in (("pov", "第一人称"), ("third", "第三人称"), ("auto", "你来挑")):
        system = writer.messages_for(writer.Context(**{**ctx.__dict__, "camera": camera}), "manual", "我自己写的说明书")[0].content
        assert system.startswith("我自己写的说明书") and word in system
        # 镜头放在字段前面(10-22 用户)
        assert system.index("镜头") < system.index("字段：")
        # 镜头定死时格式里不让它写 pov(以前示例写着 pov true,和第三人称打架)
        assert ('"pov"' in system) == (camera == "auto")
    # 第一人称不提手(10-22 用户:一提手,每张都画手)
    for note in writer.CAMERA_NOTES.values():
        assert "手" not in note.replace("玩家", "") and "pov hands" not in note


def test_format_asks_for_the_storyboard_before_the_english():
    for mode in ("manual", "auto"):
        fmt = writer.format_for(mode, "third")
        order = [fmt.index(f'"{k}"') for k in ("until", "description", "composition", "scene", "people", "look", "clothes", "tags")]
        assert order == sorted(order) and '"x"' not in fmt and '"nsfw"' not in fmt
        assert fmt.index("字段：") < fmt.index("{")
    assert writer.format_for("auto", "pov").index('"draw"') < writer.format_for("auto", "pov").index('"description"')
    assert "at：" in writer.format_for("auto", "pov") and "at：" not in writer.format_for("manual", "pov")
    assert '"draw"' not in writer.format_for("manual", "pov")


def test_writer_composition_is_read_and_coordinates_are_ignored():
    data = {"scene": "alley", "composition": "A girl crouches by a glowing vending machine.",
            "people": [{"who": "星绘", "x": 0.3}, {"who": "Lj"}]}
    r = writer.to_result(data, mode="manual", camera="third")
    assert r.plan.composition == "A girl crouches by a glowing vending machine."
    assert r.plan.people == (Person("星绘", look=""), Person("Lj", look=""))  # 写了坐标也不用


def test_composition_goes_in_whole_after_the_scene():
    plan = Plan(scene="night, alley, wide shot", composition="A lone vending machine glows, {the girl} crouching in its light.",
                people=(Person("Wikira", "squatting"), Person("Lj", "standing")))
    out = assemble(plan, {"Wikira": WIKIRA, "Lj": PLAYER}, Style("flat color"), model=nai.V45_FULL, quality="masterpiece")
    assert out.prompt == ("1girl, 1boy, couple, night, alley, wide shot, "
                          "A lone vending machine glows, the girl crouching in its light., flat color, masterpiece")
    bare = assemble(Plan(scene="park", people=(Person("Wikira", "sitting"),)), {"Wikira": WIKIRA}, Style("flat color"),
                    model=nai.V45_FULL, quality="")
    assert bare.prompt == "1girl, solo, park, flat color"


def test_until_is_kept_between_the_start_and_the_last_line():
    data = {"scene": "cafe", "people": [{"who": "Wikira"}]}
    assert writer.to_result({**data, "until": 5}, mode="manual", n_lines=8, focus=2).until == 5
    assert writer.to_result({**data, "until": 1}, mode="manual", n_lines=8, focus=2).until == 2
    assert writer.to_result({**data, "until": 30}, mode="manual", n_lines=8, focus=2).until == 7
    assert writer.to_result(data, mode="manual", n_lines=8, focus=2).until is None
    auto = writer.to_result({**data, "draw": True, "at": 4, "until": "3"}, mode="auto", n_lines=10)
    assert (auto.at, auto.until) == (4, 4)


def test_nsfw_picture_says_nsfw_in_the_prompt():
    plan = Plan(scene="bed", people=(Person("Wikira", "lying"),), nsfw=True)
    assert "nsfw" in assemble(plan, {"Wikira": WIKIRA}, Style(), model=nai.V45_FULL).prompt.split(", ")
    calm = Plan(scene="bed", people=(Person("Wikira", "lying"),))
    assert "nsfw" not in assemble(calm, {"Wikira": WIKIRA}, Style(), model=nai.V45_FULL).prompt.split(", ")


def test_sfw_only_card_never_gets_nsfw():
    r = writer.to_result({"scene": "bed", "nsfw": True}, mode="manual", sfw_only=True)
    assert r.plan.nsfw is False


def test_messages_mark_the_focus_line_and_keep_the_format_fixed():
    ctx = writer.Context(
        cast=[writer.Who("Wikira", look="pink hair"), writer.Who("Lj", gender="male", player=True)],
        lines=[writer.Line(None, "海风吹过。"), writer.Line("Wikira", "「好美……」")],
        focus=1,
        place="海边",
        want="她坐在沙滩上",
        sfw_only=True,
    )
    system, user = writer.messages_for(ctx, "manual", skill="自己改的说明书")
    assert system.content.startswith("自己改的说明书") and writer.SFW_NOTE in system.content
    assert '"people"' in system.content  # 输出格式改不掉
    assert "1. [>] Wikira:「好美……」" in user.content and "0. (旁白)海风吹过。" in user.content
    assert '"until"' in system.content
    assert "Lj(玩家,男)" in user.content and user.content.endswith("想看什么:她坐在沙滩上")
    # 卡上的长相只当参考
    assert "出场人物参考描述:\nWikira 的参考长相(平时的样子):pink hair" in user.content
    assert "角色现在的状态" not in user.content and "前情" not in user.content
    auto = writer.messages_for(writer.Context(cast=[], lines=[writer.Line(None, "a")], since=2, last="牵手"), "auto")
    assert '"draw"' in auto[0].content and "0. (旁白)a" in auto[1].content and "2 条回复以前" in auto[1].content
    assert "画的是:牵手" in auto[1].content


def test_writer_hears_what_was_drawn_before_and_after():
    lines = [writer.Line(None, str(i)) for i in range(6)]
    drawn = [writer.Drawn(None, "路灯靠肩", "她靠在你肩上"), writer.Drawn(-3, "更早", "x"), writer.Drawn(1, "巷中贩卖机", "她指着贩卖机"),
             writer.Drawn(4, "分享一口可可", "递可可", clothes="星绘穿 white coat"), writer.Drawn(9, "更晚", "y")]
    user = writer.messages_for(writer.Context(cast=[], lines=lines, focus=2, drawn=drawn), "manual")[1].content
    assert "已经画过的 CG:\n- 上一张(上一条回复):【路灯靠肩】她靠在你肩上" in user
    assert "- 这条回复更前面:【更早】x" in user and "- 这条回复更后面:【更晚】y" in user
    assert "- 第 1 句(在玩家读到的这句前面):【巷中贩卖机】她指着贩卖机" in user
    assert "- 第 4 句(在玩家读到的这句后面):【分享一口可可】递可可(星绘穿 white coat)" in user
    # 只有上一张时一句话说完(10-22 用户:「强调上一张是这个就好」);有了它,自动那行就不再重复「画的是」
    auto = writer.messages_for(writer.Context(cast=[], lines=lines, since=1, last="旧的", drawn=drawn[:1]), "auto")[1].content
    assert "画的是" not in auto and "上一张 CG:【路灯靠肩】她靠在你肩上" in auto and "- " not in auto


NOTE = writer.Note(
    place="客厅,夜里,台灯暖光",
    people=(writer.NotePerson("Wikira", "adult, pink hair", "casual dress, barefoot", "(变了:袜子脱了,光着脚)抱着抱枕"),
            writer.NotePerson("Lj", "faceless male", "black shirt")),
    story="Lj 给她按脚,她坦白早就知道他喜欢脚。",
)
CAST = [writer.Who("Wikira", look="adult, pink hair", outfit="casual dress, pantyhose, flats"),
        writer.Who("Lj", gender="male", look="faceless male", outfit="black shirt", player=True)]


def test_state_comes_first_then_the_story_then_the_reference():
    ctx = writer.Context(cast=CAST, lines=[writer.Line("Wikira", "「可以帮我涂吗？」")], place="客厅夜", user_text="恋足", note=NOTE)
    user = writer.messages_for(ctx, "auto")[1].content
    order = [user.index(s) for s in ("画面里可能出现的人", "角色现在的状态(上一条回复结束时):", "Wikira —— 长相:adult, pink hair",
                                    "前情:Lj 给她按脚", "现在的地点:客厅夜", "玩家刚说:恋足", "这条回复(按句编号):",
                                    "出场人物参考描述:", "Wikira 的参考衣服(平时的样子):casual dress, pantyhose, flats")]
    assert order == sorted(order)
    assert "  衣服:casual dress, barefoot\n  特殊:(变了:袜子脱了,光着脚)抱着抱枕" in user
    assert "Lj —— 长相:faceless male\n  衣服:black shirt\n\n" in user  # 没有特殊的不写那一行


def test_note_messages_carry_the_last_note_and_the_reply():
    ctx = writer.NoteContext(cast=CAST, lines=[writer.Line(None, "她脱掉了袜子。")], prev=NOTE, place="客厅夜", user_text="恋足")
    system, user = writer.note_messages(ctx)
    assert system.content.startswith(writer.SKILL_NOTE) and system.content.endswith(writer.FORMAT_NOTE)
    assert "上一次的笔记:\n地点:客厅,夜里,台灯暖光" in user.content and "前情:Lj 给她按脚" in user.content
    assert "背景图:客厅夜" in user.content and "玩家这次说:恋足" in user.content and "0. (旁白)她脱掉了袜子。" in user.content
    assert user.content.index("这条回复(按句编号):") < user.content.index("出场人物参考描述:")
    first = writer.note_messages(writer.NoteContext(cast=CAST, lines=[writer.Line(None, "a")]), skill="自己写的")
    assert first[0].content.startswith("自己写的") and "上一次的笔记:还没有,这是第一次。" in first[1].content


def test_note_is_read_leniently_but_must_say_something():
    note = writer.to_note({"place": "卧室", "people": [{"who": "Wikira", "look": ["pink hair", "wet hair"], "clothes": "bath towel"},
                                                      {"who": ""}, "Lj"], "story": "洗完澡出来"})
    assert note.people == (writer.NotePerson("Wikira", "pink hair, wet hair", "bath towel", ""),)
    assert note.place == "卧室" and note.story == "洗完澡出来"
    with pytest.raises(writer.WriterError):
        writer.to_note({"place": "卧室"})


# ── 接口 ──


@pytest.fixture
def fake_nai(monkeypatch):
    sent = []

    async def generate(token, body, tries=3, wait=2.0):
        sent.append((token, body))
        return png_bytes()

    monkeypatch.setattr(nai, "generate", generate)
    return sent


def generate_payload(card_id=None, **over):
    body = {
        "card_id": card_id,
        "chat_id": "c1",
        "entry_id": "e1",
        "swipe": 0,
        "line": 3,
        "title": "河堤回眸",
        "description": "河堤上回头笑",
        "picture": {"scene": "riverbank", "people": [{"who": "Wikira", "tags": "looking back, smile"}]},
        "looks": {"Wikira": {"tags": "pink hair", "outfit": "blouse", "gender": "female"}},
        "style": {"tags": "rough sketch"},
    }
    body.update(over)
    return body


def test_token_is_write_only(client: TestClient, monkeypatch):
    monkeypatch.delenv("NOVELAI_TOKEN", raising=False)
    assert client.get("/api/imagegen/status").json() == {"has_token": False, "source": None}
    assert client.put("/api/imagegen/token", json={"token": " pst-abc "}).json() == {"has_token": True, "source": "settings"}
    assert client.get("/api/settings/secret.novelai_token").status_code == 400
    assert "pst-abc" not in client.get("/api/imagegen/status").text
    assert client.put("/api/imagegen/token", json={"token": ""}).json()["has_token"] is False


def test_generate_needs_a_token(client: TestClient, fake_nai, monkeypatch):
    monkeypatch.delenv("NOVELAI_TOKEN", raising=False)
    r = client.post("/api/imagegen/generate", json=generate_payload())
    assert r.status_code == 400 and "token" in r.json()["detail"]
    assert fake_nai == []


def test_paid_sizes_are_refused_unless_allowed(client: TestClient, fake_nai):
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    r = client.post("/api/imagegen/generate", json=generate_payload(width=1536, height=1024))
    assert r.status_code == 400 and "Anlas" in r.json()["detail"]
    assert client.post("/api/imagegen/generate", json=generate_payload(width=1536, height=1024, allow_paid=True)).status_code == 200


def test_generate_stores_the_image_and_keeps_it_referenced(client: TestClient, fake_nai, make_card):
    card = make_card(name="Wikira")
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    r = client.post("/api/imagegen/generate", json=generate_payload(card["id"], seed=42))
    assert r.status_code == 200, r.text
    img = r.json()
    token, body = fake_nai[0]
    assert token == "pst-x" and body["parameters"]["seed"] == 42
    assert img["prompt"].startswith("1girl, solo, riverbank, rough sketch")
    assert img["chars"][0]["prompt"] == "girl, pink hair, blouse, looking back, smile"
    assert img["params"]["model"] == nai.V5_CURATED and img["line"] == 3
    assert client.get(f"/api/blobs/{img['sha']}").content == png_bytes()
    assert IMAGE_REF in refs.all_refs()
    listed = client.get(f"/api/imagegen/images?card_id={card['id']}").json()
    assert [x["id"] for x in listed] == [img["id"]]


def test_presets_follow_the_model_that_is_finally_used(client: TestClient, fake_nai):
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    over = {"model": nai.V45_FULL, "quality": "standard", "uc_preset": "light", "uc": "extra arms", "sfw_only": True}
    r = client.post("/api/imagegen/generate", json=generate_payload(**over, sampler="k_euler", noise_schedule="polyexponential"))
    assert r.status_code == 200, r.text
    img = r.json()
    # 只画全年龄换成 V4.5 Curated:质量词、反向预设都用 Curated 的原文,玩家写的接在预设后面
    assert img["params"]["model"] == nai.V45_CURATED
    assert img["prompt"].endswith(nai.quality_tags(nai.V45_CURATED, "standard"))
    assert img["negative"].startswith(nai.uc_preset(nai.V45_CURATED, "light") + ", extra arms")
    p = fake_nai[0][1]["parameters"]
    assert p["sampler"] == "k_euler" and p["noise_schedule"] == "polyexponential"
    assert img["params"]["uc_preset"] == "light" and img["params"]["noise_schedule"] == "polyexponential"
    # 旧的前端发 quality: false、反向写在 uc 里,照旧
    old = client.post("/api/imagegen/generate", json=generate_payload(quality=False, uc="lowres")).json()
    assert "masterpiece" not in old["prompt"] and old["negative"].startswith("lowres")
    assert client.post("/api/imagegen/generate", json=generate_payload(sampler="plms")).status_code == 400


def test_defaults_list_the_presets(client: TestClient):
    d = client.get("/api/imagegen/defaults").json()
    assert set(d["uc_presets"][nai.V5_CURATED]) == {"heavy", "light", "human"}
    assert set(d["quality_presets"][nai.V45_FULL]) == {"standard"}


def test_keep_puts_it_into_the_cards_own_cg_pack_once(client: TestClient, fake_nai, make_card):
    card = make_card(name="Wikira")
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    img = client.post("/api/imagegen/generate", json=generate_payload(card["id"])).json()
    kept = client.post(f"/api/imagegen/images/{img['id']}/keep")
    assert kept.status_code == 200, kept.text
    k = kept.json()
    assert k["pack_name"] == "AI 生图 · Wikira" and k["label"] == "河堤回眸"
    assert client.get(f"/api/tavern/cards/{card['id']}/cg-packs").json()["pack_ids"] == [k["pack_id"]]
    assets = client.get(f"/api/cg-packs/{k['pack_id']}/assets").json()
    assert [a["label"] for a in assets] == ["河堤回眸"]
    assert client.get(f"/api/cg-packs/{k['pack_id']}/assets/{k['asset_id']}/file").content == png_bytes()
    # 再点一次不多建;另一张同名的加编号,进同一个包
    assert client.post(f"/api/imagegen/images/{img['id']}/keep").json()["asset_id"] == k["asset_id"]
    img2 = client.post("/api/imagegen/generate", json=generate_payload(card["id"])).json()
    k2 = client.post(f"/api/imagegen/images/{img2['id']}/keep").json()
    assert k2["pack_id"] == k["pack_id"] and k2["label"] == "河堤回眸 2"
    # 收藏建的包标成 AI 生成(素材页放进「AI 生成」那一栏,不和导入的 CG 混)
    assert [(p["id"], p["generated"]) for p in client.get("/api/cg-packs").json()] == [(k["pack_id"], True)]


def test_keep_marks_an_older_keep_pack_as_generated(client: TestClient, fake_nai, make_card):
    """第 1 步以前建的收藏包没有标记:再收藏一张时按说明找到它,顺手补上"""
    card = make_card(name="Wikira")
    old = client.post("/api/cg-packs", json={"name": "AI 生图 · Wikira", "description": imagegen_api.KEEP_PACK_NOTE}).json()
    assert old["generated"] is False
    client.put(f"/api/tavern/cards/{card['id']}/cg-packs", json={"pack_ids": [old["id"]]})
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    img = client.post("/api/imagegen/generate", json=generate_payload(card["id"])).json()
    k = client.post(f"/api/imagegen/images/{img['id']}/keep").json()
    assert k["pack_id"] == old["id"]
    assert client.get("/api/cg-packs").json()[0]["generated"] is True


def test_the_private_migration_looks_for_the_same_note():
    """私有迁移 private.2026_10_imagegen_generated 按这句说明补标已有的收藏包,两边要一字不差"""
    step = pytest.importorskip("app.migrations.private.imagegen_generated")
    assert step.KEEP_PACK_NOTE == imagegen_api.KEEP_PACK_NOTE


def _card_with_sprites(client, make_card, make_sprite_pack):
    card = make_card(name="Wikira")
    base = f"/api/sprite-packs/{make_sprite_pack('Wikira 立绘', card['id'])['id']}/sprites"
    first = client.post(base, json={"label": "平静"}).json()
    second = client.post(base, json={"label": "微笑"}).json()
    for sprite, (w, h) in ((first, (100, 300)), (second, (300, 300))):
        r = client.put(f"{base}/{sprite['id']}/image", files={"file": ("a.png", sprite_png(w, h), "image/png")})
        assert r.status_code == 200, r.text
    return card, first, second


def test_v45_uses_the_cards_default_sprite_as_reference(client: TestClient, fake_nai, make_card, make_sprite_pack):
    card, first, _ = _card_with_sprites(client, make_card, make_sprite_pack)
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    looks = {"Wikira": {"tags": "pink hair", "outfit": "blouse", "name_tag": "", "ref": {"kind": "sprite"}}}
    r = client.post("/api/imagegen/generate", json=generate_payload(card["id"], model=nai.V45_FULL, looks=looks))
    assert r.status_code == 200, r.text
    p = fake_nai[0][1]["parameters"]
    assert decoded(p["director_reference_images"][0]).size == (1024, 1536)
    img = r.json()
    # 长相交给参考图,衣服照写
    assert img["chars"][0]["prompt"] == "girl, blouse, looking back, smile"
    assert img["params"]["reference"] == {"who": "Wikira", "kind": "sprite", "id": None, "style": False}


def test_a_chosen_sprite_is_used_instead_of_the_default(client: TestClient, fake_nai, make_card, make_sprite_pack):
    card, _, second = _card_with_sprites(client, make_card, make_sprite_pack)
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    looks = {"Wikira": {"tags": "pink hair", "ref": {"kind": "sprite", "id": second["id"], "style": True}}}
    client.post("/api/imagegen/generate", json=generate_payload(card["id"], model=nai.V45_FULL, looks=looks))
    p = fake_nai[0][1]["parameters"]
    assert decoded(p["director_reference_images"][0]).size == (1472, 1472)
    assert p["director_reference_descriptions"][0]["caption"]["base_caption"] == "character&style"


def test_reference_is_left_out_on_v5_or_when_she_is_not_drawn(client: TestClient, fake_nai, make_card, make_sprite_pack):
    card, _, _ = _card_with_sprites(client, make_card, make_sprite_pack)
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    looks = {"Wikira": {"tags": "pink hair", "ref": {"kind": "sprite"}}}
    v5 = client.post("/api/imagegen/generate", json=generate_payload(card["id"], looks=looks)).json()
    assert "director_reference_images" not in fake_nai[0][1]["parameters"]
    assert v5["chars"][0]["prompt"].startswith("girl, pink hair") and "V4.5" in v5["params"]["reference_note"]
    scenery = {"scene": "riverbank at dusk", "people": []}
    client.post("/api/imagegen/generate", json=generate_payload(card["id"], model=nai.V45_FULL, looks=looks, picture=scenery))
    assert "director_reference_images" not in fake_nai[1][1]["parameters"]


def test_no_sprite_falls_back_to_the_written_look(client: TestClient, fake_nai, make_card):
    card = make_card(name="Wikira")
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    looks = {"Wikira": {"tags": "pink hair", "ref": {"kind": "sprite"}}}
    img = client.post("/api/imagegen/generate", json=generate_payload(card["id"], model=nai.V45_FULL, looks=looks)).json()
    assert "director_reference_images" not in fake_nai[0][1]["parameters"]
    assert img["chars"][0]["prompt"].startswith("girl, pink hair") and "找不到参考图" in img["params"]["reference_note"]


def test_an_uploaded_reference_is_kept_referenced_and_used(client: TestClient, fake_nai, make_card):
    card = make_card(name="Wikira")
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    bad = client.post("/api/imagegen/refs", files={"file": ("a.txt", b"hello", "text/plain")})
    assert bad.status_code == 400
    up = client.post("/api/imagegen/refs", data={"card_id": card["id"]}, files={"file": ("a.png", sprite_png(), "image/png")})
    assert up.status_code == 200, up.text
    ref = up.json()
    assert UPLOAD_REF in refs.all_refs() and client.get(f"/api/blobs/{ref['sha']}").content == sprite_png()
    looks = {"Wikira": {"tags": "pink hair", "ref": {"kind": "upload", "id": ref["id"]}}}
    client.post("/api/imagegen/generate", json=generate_payload(card["id"], model=nai.V45_CURATED, looks=looks))
    assert decoded(fake_nai[0][1]["parameters"]["director_reference_images"][0]).size == (1024, 1536)
    assert client.delete(f"/api/imagegen/refs/{ref['id']}").status_code == 204


def test_plan_asks_the_chosen_connection_with_thinking_off(client: TestClient, make_connection, monkeypatch):
    conn = make_connection(name="导演", api_type="openai_compatible", base_url="http://x/v1", api_key="k", model="flash")
    asked = []

    async def fake_ask(c, messages, thinking="off"):
        asked.append((c.name, thinking, messages))
        return '{"description": "海边", "scene": "beach", "people": [{"who": "Wikira", "tags": "smile"}]}', 1234

    monkeypatch.setattr(writer, "ask", fake_ask)
    r = client.post(
        "/api/imagegen/plan",
        json={"connection_id": conn["id"], "cast": [{"name": "Wikira"}], "lines": [{"speaker": "Wikira", "text": "好美"}], "focus": 0},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["picture"]["people"] == [{"who": "Wikira", "tags": "smile", "clothes": "", "look": ""}]
    assert out["ms"] == 1234 and out["connection"] == "导演" and out["draw"] is True
    assert asked[0][:2] == ("导演", "off")
    # 默认第一人称;改成第三人称时说明和结果都跟着变
    assert out["picture"]["pov"] is True and "第一人称" in asked[0][2][0].content
    third = client.post(
        "/api/imagegen/plan",
        json={"connection_id": conn["id"], "camera": "third", "cast": [{"name": "Wikira"}], "lines": [{"text": "好美"}]},
    ).json()
    assert third["picture"]["pov"] is False and "第三人称" in asked[1][2][0].content
    # 带上上一条回复的状态笔记
    note = {"place": "海边", "people": [{"who": "Wikira", "look": "wet hair", "clothes": "swimsuit", "notes": "刚游完泳"}], "story": "去海边玩"}
    client.post("/api/imagegen/plan", json={"connection_id": conn["id"], "cast": [{"name": "Wikira"}], "lines": [{"text": "a"}], "note": note})
    user = asked[2][2][1].content
    assert "Wikira —— 长相:wet hair\n  衣服:swimsuit\n  特殊:刚游完泳" in user and "前情:去海边玩" in user


def test_note_asks_the_writer_and_returns_the_state(client: TestClient, make_connection, monkeypatch):
    conn = make_connection(name="导演", api_type="openai_compatible", base_url="http://x/v1", api_key="k", model="flash")
    asked = []

    async def fake_ask(c, messages, thinking="off"):
        asked.append(messages)
        return ('{"place": "客厅,夜里", "people": [{"who": "Wikira", "look": "pink hair", "clothes": ["casual dress", "barefoot"],'
                ' "notes": "(变了:光着脚)"}], "story": "她让他涂指甲。"}', 900)

    monkeypatch.setattr(writer, "ask", fake_ask)
    prev = {"place": "客厅", "people": [{"who": "Wikira", "look": "pink hair", "clothes": "casual dress, pantyhose"}], "story": "按脚"}
    body = {"connection_id": conn["id"], "cast": [{"name": "Wikira", "look": "pink hair", "outfit": "casual dress, pantyhose"}],
            "lines": [{"text": "她脱掉了袜子。"}], "prev": prev, "place": "客厅夜", "user_text": "恋足"}
    r = client.post("/api/imagegen/note", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["people"] == [{"who": "Wikira", "look": "pink hair", "clothes": "casual dress, barefoot", "notes": "(变了:光着脚)"}]
    assert out["place"] == "客厅,夜里" and out["story"] == "她让他涂指甲。" and out["ms"] == 900 and out["connection"] == "导演"
    assert "上一次的笔记:" in asked[0][1].content and "0. (旁白)她脱掉了袜子。" in asked[0][1].content

    async def nothing(c, messages, thinking="off"):
        return '{"place": "客厅"}', 5

    monkeypatch.setattr(writer, "ask", nothing)
    assert client.post("/api/imagegen/note", json=body).status_code == 502


def test_generate_draws_the_writers_look_and_keeps_old_pictures_working(client: TestClient, fake_nai):
    client.put("/api/imagegen/token", json={"token": "pst-x"})
    picture = {"scene": "living room", "people": [{"who": "Wikira", "tags": "sitting", "clothes": "barefoot", "look": "pink hair, hair down"}]}
    img = client.post("/api/imagegen/generate", json=generate_payload(picture=picture)).json()
    assert img["chars"][0]["prompt"] == "girl, pink hair, hair down, barefoot, sitting"
    assert img["picture"]["people"][0]["look"] == "pink hair, hair down"
    # 老画面(没有 look)「换一张」照老规矩补卡上的
    old = client.post("/api/imagegen/generate", json=generate_payload()).json()
    assert old["chars"][0]["prompt"] == "girl, pink hair, blouse, looking back, smile"


def test_plan_reports_what_the_model_said_when_it_is_not_json(client: TestClient, make_connection, monkeypatch):
    make_connection(name="聊天")

    async def fake_ask(c, messages, thinking="off"):
        return "这里不需要画", 10

    monkeypatch.setattr(writer, "ask", fake_ask)
    conn_id = client.get("/api/connections").json()[0]["id"]
    r = client.post("/api/imagegen/plan", json={"connection_id": conn_id, "lines": [{"text": "a"}]})
    assert r.status_code == 502 and "这里不需要画" in r.json()["detail"]


def test_ask_falls_back_to_the_connections_own_thinking(monkeypatch):
    import asyncio

    from app.llm.errors import LLMError
    from app.models import ApiConnection

    calls = []

    class Fake:
        def __init__(self, thinking):
            self.thinking = thinking

        async def complete(self, messages, model):
            calls.append(self.thinking)
            if self.thinking == "off":
                raise LLMError("这个模型关不掉思考")
            return "{}"

    monkeypatch.setattr(writer, "provider_for", lambda c: Fake(c.thinking))
    conn = ApiConnection(name="opus", api_type="anthropic", api_key="k", model="claude", thinking=None)
    text, _ = asyncio.run(writer.ask(conn, [], "off"))
    assert text == "{}" and calls == ["off", None]


def test_look_reads_the_card(client: TestClient, make_card, make_connection, monkeypatch):
    card = make_card(name="Wikira", description="粉色长发,侧边细辫,紫色眼睛")
    make_connection()
    seen = []

    async def fake_ask(c, messages, thinking="off"):
        seen.append(messages[1].content)
        return '{"name_tag": "", "tags": "adult, pink hair, side braid, purple eyes", "outfit": "blouse, skirt", "gender": "female"}', 5

    monkeypatch.setattr(writer, "ask", fake_ask)
    conns = client.get("/api/connections").json()
    r = client.post("/api/imagegen/look", json={"card_id": card["id"], "connection_id": conns[0]["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["tags"].startswith("adult, pink hair") and r.json()["outfit"] == "blouse, skirt" and "侧边细辫" in seen[0]
    assert r.json()["name_tag"] == ""


def test_look_names_a_known_character(client: TestClient, make_card, make_connection, monkeypatch):
    card = make_card(name="刻晴", description="原神里璃月七星之一")
    make_connection()

    async def fake_ask(c, messages, thinking="off"):
        assert "keqing (genshin impact)" in messages[0].content
        return '{"name_tag": "keqing (genshin impact)", "tags": "purple hair", "outfit": "", "gender": "female"}', 5

    monkeypatch.setattr(writer, "ask", fake_ask)
    r = client.post("/api/imagegen/look", json={"card_id": card["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["name_tag"] == "keqing (genshin impact)"


def test_imagegen_api_module_does_not_print_tokens():
    assert "print(" not in open(imagegen_api.__file__, encoding="utf-8").read()
