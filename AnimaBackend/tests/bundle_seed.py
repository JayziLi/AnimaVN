"""第 3 步(角色打包带走)几个测试共用的库:一张主卡 + 一张状态卡,立绘包、场景包、CG 包、配对表、认词记录、
预设绑定、按卡设置、声音(第 4 步起跟着走;文件已经在文件仓库里,当作导出前拉过了)、secret.*(不该被带走)都齐。

    ids = seed(db)   # 返回各样东西的编号,db 已提交

图用 cv2 合成(内容各不相同),曲子是假的 MP3 头。
"""

from __future__ import annotations

import base64
import zlib

import cv2
import numpy as np
from sqlalchemy.orm import Session

from app import bindings
from app.models import (
    AppSetting,
    CardPref,
    CardState,
    CardStateGroup,
    CgAsset,
    CgPack,
    PackSprite,
    Pairing,
    PairingRow,
    PromptPreset,
    SceneAsset,
    ScenePack,
    SpritePack,
    SpritePackLayout,
    TavernCard,
    TtsConnection,
    VoiceEmotion,
    VoiceProfile,
    WordRecord,
)
from app.storage import refs
from app.storage.blobs import CKPT_MIME, PTH_MIME, store

SECRET = "sk-very-secret-key"


def png(seed: str) -> bytes:
    n = zlib.crc32(seed.encode("utf-8"))
    return cv2.imencode(".png", np.full((6, 8, 3), (n & 255, (n >> 8) & 255, (n >> 16) & 255), np.uint8))[1].tobytes()


def mp3(seed: str) -> bytes:
    return b"ID3\x04\x00\x00\x00\x00\x00\x00" + seed.encode("utf-8") + bytes(32)


def wav(seed: str) -> bytes:
    return b"RIFF\x00\x00\x00\x00WAVEfmt " + seed.encode("utf-8") + bytes(16)


VOICE_FILES = {
    "gpt": b"gpt-model " * 50,
    "sovits": b"sovits-model " * 50,
    "calm": wav("平静"),
    "happy": wav("开心"),
    "aux": wav("辅助"),
}


def data_url(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _card(db: Session, name: str, avatar: bytes | None, **fields) -> TavernCard:
    card = TavernCard(
        name=name,
        description=f"{name}的描述",
        first_mes="你好",
        alternate_greetings=["再见"],
        tags=["测试"],
        character_book={"name": "书", "entries": [{"keys": ["剑"], "content": "她用剑"}]},
        extensions={"talkativeness": "0.5", "depth_prompt": {"prompt": "x", "depth": 4}},
        spec="chara_card_v2",
        avatar=data_url(avatar) if avatar else None,
        **fields,
    )
    db.add(card)
    db.flush()
    return card


def seed(db: Session) -> dict:
    ids: dict = {}
    main = _card(db, "刻晴", png("avatar"))
    state = _card(db, "刻晴", png("avatar"))
    lonely = _card(db, "路人", None)
    ids.update(main=main.id, state=state.id, lonely=lonely.id)

    group = CardStateGroup(main_card_id=main.id)
    db.add(group)
    db.flush()
    db.add_all(
        [
            CardState(card_id=main.id, group_id=group.id, name="普通", sort=0, show_in_pick=False),
            CardState(card_id=state.id, group_id=group.id, name="夜晚", sort=1, show_in_pick=True),
        ]
    )
    ids["group"] = group.id

    # 立绘包:两张,第二张和卡头像是同一张图(文件只放一份)
    sp = SpritePack(name="刻晴 · 玉衡星", description="官方立绘")
    db.add(sp)
    db.flush()
    s1 = PackSprite(pack_id=sp.id, label="微笑", aliases=["smile"], description="默认", sort=0, mime="image/png",
                    effect={"motion": "hop", "bubble": None, "sound": None}, face_scan={"face": [1, 2, 3, 4]})
    s2 = PackSprite(pack_id=sp.id, label="生气", aliases=[], sort=1, mime="image/png", enabled=False)
    db.add_all([s1, s2])
    db.flush()
    refs.save(refs.SPRITE, s1, png("微笑"), "image/png", db)
    refs.save(refs.SPRITE, s2, png("avatar"), "image/png", db)
    db.add(SpritePackLayout(pack_id=sp.id, auto=False, zoom=1.2, dx=0.1, dy=-0.05))
    db.add(WordRecord(list_ref=f"pack:{sp.id}", word="开心", item=s1.id, source="model", guessed=True, score=0.8))
    ids.update(sprite_pack=sp.id, s1=s1.id, s2=s2.id)

    # 场景包:背景 1 的默认曲在同包,背景 2 的默认曲在另一个(不导出的)场景包里
    other = ScenePack(name="别人的场景")
    sc = ScenePack(name="璃月")
    db.add_all([other, sc])
    db.flush()
    far = SceneAsset(pack_id=other.id, kind="bgm", label="远方", mime="audio/mpeg", size=40)
    db.add(far)
    db.flush()
    refs.save(refs.SCENE_ASSET, far, mp3("远方"), "audio/mpeg", db)
    bgm = SceneAsset(pack_id=sc.id, kind="bgm", label="日常", mime="audio/mpeg", size=44, sort=0)
    db.add(bgm)
    db.flush()
    refs.save(refs.SCENE_ASSET, bgm, mp3("日常"), "audio/mpeg", db)
    bg1 = SceneAsset(pack_id=sc.id, kind="bg", label="港口", mime="image/png", sort=0, focus_x=30, bgm_id=bgm.id)
    bg2 = SceneAsset(pack_id=sc.id, kind="bg", label="远山", mime="image/png", sort=1, bgm_id=far.id)
    db.add_all([bg1, bg2])
    db.flush()
    refs.save(refs.SCENE_ASSET, bg1, png("港口"), "image/png", db)
    refs.save(refs.SCENE_ASSET, bg2, png("远山"), "image/png", db)
    sc.title_bgm_id = bgm.id
    ids.update(scene_pack=sc.id, other_scene=other.id, bgm=bgm.id, far=far.id, bg1=bg1.id, bg2=bg2.id)

    # CG 包:一张构图 + 一张差分
    cg = CgPack(name="刻晴 · CG", generated=False)
    db.add(cg)
    db.flush()
    comp = CgAsset(pack_id=cg.id, label="花火", description="一起看花火", mime="image/png", size=70, forms=["普通"])
    db.add(comp)
    db.flush()
    var = CgAsset(pack_id=cg.id, parent_id=comp.id, label="微笑", mime="image/png", size=70)
    db.add(var)
    db.flush()
    refs.save(refs.CG_ASSET, comp, png("花火"), "image/png", db)
    refs.save(refs.CG_ASSET, var, png("花火微笑"), "image/png", db)
    ids.update(cg_pack=cg.id, comp=comp.id, var=var.id)

    # 配对表:立绘名单 × CG 构图
    pairing = Pairing(follower="cg", list_ref=f"pack:{sp.id}", target=comp.id, card_id="")
    db.add(pairing)
    db.flush()
    db.add_all(
        [
            PairingRow(pairing_id=pairing.id, item=s1.id, value=var.id, source="name"),
            PairingRow(pairing_id=pairing.id, item=s2.id, value=None, source="local", guessed=True),
        ]
    )
    # 指着不在的声音的配对表不带
    db.add(Pairing(follower="voice", list_ref=f"pack:{sp.id}", target="v" * 32, card_id=""))
    ids["pairing"] = pairing.id

    # 声音(第 4 步):语音机在另一台电脑;文件已经拉进仓库(指纹记好了),路径还是语音机上的
    conn = TtsConnection(name="台式机", base_url="http://10.0.0.2:9880")
    db.add(conn)
    db.flush()
    blobs = store()
    sha = {k: blobs.put(v, CKPT_MIME if k == "gpt" else PTH_MIME if k == "sovits" else "audio/wav", db) for k, v in VOICE_FILES.items()}
    voice = VoiceProfile(
        name="刻晴声音",
        aliases=["刻晴"],
        connection_id=conn.id,
        gpt_weights="G:/models/keqing-e10.ckpt",
        sovits_weights="G:/models/keqing_e10_s460.pth",
        text_lang="ja",
        speed=1.1,
        params={"top_k": 12},
        gpt_sha=sha["gpt"],
        gpt_size=len(VOICE_FILES["gpt"]),
        gpt_name="keqing-e10.ckpt",
        sovits_sha=sha["sovits"],
        sovits_size=len(VOICE_FILES["sovits"]),
        sovits_name="keqing_e10_s460.pth",
        source="自己练的",
    )
    db.add(voice)
    db.flush()
    calm = VoiceEmotion(profile_id=voice.id, label="平静", aliases=["calm"], ref_path="D:/refs/【平静】你好.wav",
                        prompt_text="你好", ref_sha=sha["calm"], sort=0)
    happy = VoiceEmotion(profile_id=voice.id, label="开心", ref_path="D:/refs/【开心】太好了.wav", prompt_text="太好了",
                         ref_sha=sha["happy"], aux_refs=["D:/refs/aux.wav"], aux_shas=[sha["aux"]], sort=1)
    db.add_all([calm, happy])
    db.flush()
    # 语音的配对表:立绘名单 × 这个声音
    vp = Pairing(follower="voice", list_ref=f"pack:{sp.id}", target=voice.id, card_id="")
    db.add(vp)
    db.flush()
    db.add_all(
        [
            PairingRow(pairing_id=vp.id, item=s1.id, value=happy.id, source="name"),
            PairingRow(pairing_id=vp.id, item=s2.id, value=None, source="local", guessed=True),
        ]
    )
    ids.update(voice=voice.id, calm=calm.id, happy=happy.id, voice_pairing=vp.id, tts=conn.id)

    for card in (main, state):
        bindings.replace(db, card.id, bindings.SPRITE, [sp.id], sp.id)
        bindings.replace_scene(db, card.id, [sc.id], [sc.id])
        bindings.replace(db, card.id, bindings.CG, [cg.id])
        bindings.replace(db, card.id, bindings.VOICE, [voice.id], voice.id)

    # 预设、预设绑定、按卡设置、秘密
    preset = PromptPreset(name="刻晴 DeepSeek", prompts=[{"identifier": "main", "content": "保持角色"}],
                          prompt_order=[{"character_id": 100000, "order": [{"identifier": "main", "enabled": True}]}],
                          formats={"wi_format": "{0}"}, params={"temperature": 0.9}, squash_system_messages=True)
    other_preset = PromptPreset(name="别的预设")
    db.add_all([preset, other_preset])
    db.flush()
    ids.update(preset=preset.id, other_preset=other_preset.id)
    db.add(AppSetting(key="preset.bindings", value={"cards": {main.id: preset.id, state.id: preset.id,
                                                              lonely.id: other_preset.id}, "default": other_preset.id}))
    db.add(AppSetting(key="secret.jev_key", value=SECRET))
    db.add(AppSetting(key="plugin.sprite", value={"tag": "[表情:{x}]"}))
    db.add(CardPref(card_id=main.id, key="plugin.imagegen",
                    value={"look": "purple hair", "ref": {"kind": "sprite", "id": s1.id, "sha": None, "style": False}}))
    db.add(CardPref(card_id=state.id, key="plugin.cg", value={"jev": {"threshold": 0.75}}))
    db.add(CardPref(card_id=main.id, key="beta.voice-sfx", value={"on": True}))
    db.commit()
    return ids
