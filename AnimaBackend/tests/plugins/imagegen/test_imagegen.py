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
    centers,
    join,
    sleeves,
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


def test_body_for_v5_with_two_people_uses_positions():
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
    assert p["v4_prompt"]["use_coords"] is True
    assert [c["centers"][0]["x"] for c in p["v4_prompt"]["caption"]["char_captions"]] == [0.35, 0.65]
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
    out = assemble(Plan(scene="tea house", people=(Person("刻晴", "smile"),)), {"刻晴": keqing},
                   Style("flat color", artists="artist:foo, artist:bar"), model=nai.V45_FULL, quality="")
    assert out.prompt == "1girl, solo, artist:foo, artist:bar, tea house, flat color"
    assert out.chars[0].prompt == "girl, keqing (genshin impact), purple hair, twintails, purple dress, smile"
    ref = assemble(Plan(people=(Person("刻晴", "smile"),)), {"刻晴": Look(**{**keqing.__dict__, "ref": True})},
                   Style(), model=nai.V45_FULL)
    assert ref.chars[0].prompt == "girl, keqing (genshin impact), purple dress, smile"


def tags_of(text: str) -> set[str]:
    return {t.strip() for t in text.split(",")}


def test_first_person_drops_the_player_and_dresses_his_hands():
    plan = Plan(scene="street, night, pov hands, holding hands",
                people=(Person("Wikira", "looking back, smile"), Person("玩家", "walking")), pov=True)
    out = assemble(plan, {"Wikira": WIKIRA, "玩家": PLAYER}, Style("flat color"), model=nai.V45_FULL, quality="")
    assert out.prompt == "1girl, pov, street, night, pov hands, holding hands, black sleeves, flat color"
    assert [c.prompt.split(", ")[0] for c in out.chars] == ["girl"]
    neg = tags_of(out.negative)
    assert "multiple boys" in neg and "1boy" not in neg and "solo" not in out.prompt
    # 袖子是玩家的手的:她自己的反向挡掉,别串到她身上
    assert "black sleeves" in tags_of(out.chars[0].negative)


def test_first_person_without_hands_adds_no_sleeves():
    out = assemble(Plan(scene="cafe, close-up", people=(Person("Wikira", "leaning forward"),), pov=True),
                   {"Wikira": WIKIRA, "玩家": PLAYER}, Style(), model=nai.V5_FULL, quality="")
    assert out.prompt == "1girl, pov, cafe, close-up"
    assert sleeves("white t-shirt, jeans") == "white sleeves" and sleeves("hoodie") == ""
    waist = assemble(Plan(scene="pov hands on her waist", people=(Person("Wikira", "arms around neck"),), pov=True),
                     {"Wikira": WIKIRA, "玩家": PLAYER}, Style(), model=nai.V45_FULL, quality="")
    assert waist.prompt == "1girl, pov, pov hands on her waist, black sleeves"


def test_join_drops_empties_and_duplicates():
    assert join("a, b", "", "B, c,, ") == "a, b, c"


def test_one_girl_gets_solo_and_her_look():
    out = assemble(Plan(scene="beach, sunset", people=(Person("Wikira", "sitting, smile"),)), {"Wikira": WIKIRA},
                   Style("rough sketch, monochrome"), model=nai.V5_FULL, uc="lowres")
    assert out.prompt.startswith("1girl, solo, beach, sunset, rough sketch, monochrome, very aesthetic")
    assert out.chars[0].prompt == "girl, adult, pink hair, side braid, off-shoulder blouse, long skirt, sitting, smile"
    assert out.chars[0].x == 0.5
    for guard in ("lowres", ADULT_GUARD.split(",")[0], "1boy", "2girls"):
        assert guard in out.negative
    assert out.model == nai.V5_FULL


def test_couple_with_player_dresses_him_on_ordinary_days():
    plan = Plan(scene="park", people=(Person("Wikira", "hug"), Person("Lj", "hug")))
    out = assemble(plan, {"Wikira": WIKIRA, "Lj": PLAYER}, Style(), model=nai.V5_CURATED)
    assert out.prompt.startswith("1girl, 1boy, couple, park")
    assert [c.x for c in out.chars] == [0.35, 0.65]
    assert "black shirt" in out.chars[1].prompt and "fully clothed" in out.chars[1].prompt
    assert "shirtless" in out.chars[1].negative
    assert "1boy" not in out.negative.split(", ")[:3]  # 两个人时不挡男的


def test_nsfw_scene_says_hetero_and_leaves_clothes_alone():
    plan = Plan(scene="bed", people=(Person("Wikira", "lying"), Person("Lj", "")), nsfw=True)
    out = assemble(plan, {"Wikira": WIKIRA, "Lj": PLAYER}, Style(), model=nai.V5_FULL)
    assert "hetero" in out.prompt and "fully clothed" not in out.chars[1].prompt
    # nsfw 场面没写这一刻穿什么:不加平时的衣服
    assert "long skirt" not in out.chars[0].prompt and "black shirt" not in out.chars[1].prompt


def test_clothes_of_the_moment_replace_the_usual_outfit():
    plan = Plan(scene="bedroom", people=(Person("Wikira", "lying", clothes="pajamas"), Person("Lj", "sitting", clothes="t-shirt")))
    out = assemble(plan, {"Wikira": WIKIRA, "Lj": PLAYER}, Style(), model=nai.V5_CURATED)
    assert out.chars[0].prompt == "girl, adult, pink hair, side braid, pajamas, lying"
    assert "t-shirt" in out.chars[1].prompt and "black shirt" not in out.chars[1].prompt
    assert "fully clothed" not in out.chars[1].prompt


def test_sfw_only_switches_to_curated_and_blocks_nsfw():
    plan = Plan(scene="bed", people=(Person("Wikira", "lying"),), nsfw=True)
    out = assemble(plan, {"Wikira": WIKIRA}, Style(), model=nai.V5_FULL, sfw_only=True)
    assert out.model == nai.V5_CURATED
    assert SFW_GUARD.split(",")[0] in out.negative and "hetero" not in out.prompt


def test_nobody_is_scenery_and_unknown_people_guess_gender_from_tags():
    assert assemble(Plan(scene="sea"), {}, Style(), model=nai.V5_CURATED).prompt.startswith("no humans, scenery, sea")
    out = assemble(Plan(people=(Person("店员", "1boy, apron"),)), {}, Style(), model=nai.V5_CURATED)
    assert out.prompt.startswith("1boy, solo")


def test_three_people_spread_out():
    assert centers(3) == [0.2, 0.5, 0.8]


# ── 指导模型回的 JSON ──


def test_parse_fenced_json_and_coerce_fields():
    text = '```json\n{"draw": "true", "at": 99, "importance": 5, "reason": "第一次牵手", "title": "河堤牵手", "description": "河堤上第一次牵手",' \
           ' "scene": ["riverbank", "sunset"], "people": [{"who": "Wikira", "tags": ["holding hands", "blush"], "clothes": "yukata"}, "Lj"], "nsfw": "false"}\n```'
    r = writer.to_result(writer.parse_json(text), mode="auto", n_lines=10)
    assert r.draw is True and r.at == 9 and r.importance == 3
    assert r.plan.scene == "riverbank, sunset"
    assert r.plan.people == (Person("Wikira", "holding hands, blush", "yukata"), Person("Lj", ""))
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
        assert system.startswith("我自己写的说明书") and word in system and '"pov"' in system


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
    assert "Lj(玩家,男)" in user.content and "想看什么:她坐在沙滩上" in user.content
    auto = writer.messages_for(writer.Context(cast=[], lines=[writer.Line(None, "a")], since=2, last="牵手"), "auto")
    assert '"draw"' in auto[0].content and "0. (旁白)a" in auto[1].content and "2 条回复以前" in auto[1].content


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
    assert out["picture"]["people"] == [{"who": "Wikira", "tags": "smile", "clothes": ""}]
    assert out["ms"] == 1234 and out["connection"] == "导演" and out["draw"] is True
    assert asked[0][:2] == ("导演", "off")
    # 默认第一人称;改成第三人称时说明和结果都跟着变
    assert out["picture"]["pov"] is True and "第一人称" in asked[0][2][0].content
    third = client.post(
        "/api/imagegen/plan",
        json={"connection_id": conn["id"], "camera": "third", "cast": [{"name": "Wikira"}], "lines": [{"text": "好美"}]},
    ).json()
    assert third["picture"]["pov"] is False and "第三人称" in asked[1][2][0].content


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
