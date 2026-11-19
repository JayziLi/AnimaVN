"""自带角色(app/seed.py):空库第一次启动种进去的 DeepSeek娘、Claude娘、Gemini娘 —— 日中对照的卡、各自的立绘包、
按卡设置里语言是日语;背景挂自带的「现代日常」,曲子各挂一个默认音乐包(A / B / C)。自带场景包(现代日常、校园、
三个音乐包)首启都建好。老库更新:只补没给过的角色和场景包,以前给的自带角色没挂过背景和曲子的补挂一次。"""

import re

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import bindings, seed
from app.db import Base
from app.models import AppSetting, CardPref, PackSprite, SceneAsset, ScenePack, SpritePack, TavernCard
from app.seed import seed_default_tavern_data
from app.storage import refs

KANA = re.compile(r"[ぁ-ゖァ-ヺー]")
ALL_CHARACTERS = ["Claude娘", "DeepSeek娘", "Gemini娘"]
MUSIC_OF = {
    "DeepSeek娘": "AnimaVN-默认音乐包A · 钢琴流行",
    "Claude娘": "AnimaVN-默认音乐包B · 八音盒治愈",
    "Gemini娘": "AnimaVN-默认音乐包C · 爵士都市",
}
SCENE_PACKS = {"现代日常", "校园", *MUSIC_OF.values()}
RECORD = {
    "seeded": ["deepseek-chan", "claude-chan", "gemini-chan"],
    "scenes": ["campus", "modern-daily", "music-a", "music-b", "music-c"],
    "scene_bound": ["deepseek-chan", "claude-chan", "gemini-chan"],
}


def _fresh_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def _card(db, name):
    return db.scalars(select(TavernCard).where(TavernCard.name == name)).one()


def _pack(db, name):
    return db.scalars(select(ScenePack).where(ScenePack.name == name)).one()


def _labels(db, pack):
    return set(db.scalars(select(SceneAsset.label).where(SceneAsset.pack_id == pack.id)))


def test_seeds_bilingual_deepseek_with_language_set_to_japanese():
    db = _fresh_db()
    seed_default_tavern_data(db)
    card = _card(db, "DeepSeek娘")
    assert "日语配音" in card.character_version
    # 开场白、备用开场白、示例都是一行日语一行中文
    for text in [card.first_mes, *card.alternate_greetings, card.mes_example]:
        assert KANA.search(text)
    # 语言设成日语:没装声音也写日中对照(前端 plugins/lang.ts)
    pref = db.get(CardPref, (card.id, "plugin.lang"))
    assert pref is not None and pref.value == {"lang": "ja"}
    # 立绘包照旧挂上
    pack_id = bindings.primary(db, card.id, bindings.SPRITE)
    assert pack_id and len(db.scalars(select(PackSprite).where(PackSprite.pack_id == pack_id)).all()) == 10


def test_seeds_claude_and_gemini_with_their_own_sprite_packs():
    db = _fresh_db()
    seed_default_tavern_data(db)
    assert sorted(c.name for c in db.scalars(select(TavernCard))) == ALL_CHARACTERS
    gemini = _card(db, "Gemini娘")
    # 自带的是全年龄版
    for word in ("擦边", "色色"):
        assert word not in gemini.description
    assert gemini.character_book and len(gemini.character_book["entries"]) == 11
    counts = {"Claude娘": 10, "Gemini娘": 15}
    packs = set()
    for name, count in counts.items():
        card = _card(db, name)
        assert "日语配音" in card.character_version
        assert db.get(CardPref, (card.id, "plugin.lang")).value == {"lang": "ja"}
        pack_id = bindings.primary(db, card.id, bindings.SPRITE)
        sprites = db.scalars(select(PackSprite).where(PackSprite.pack_id == pack_id)).all()
        assert len(sprites) == count, name
        # 脸的位置随包带着
        assert all(s.face_scan and s.face_scan.get("face") for s in sprites), name
        packs.add(pack_id)
    packs.add(bindings.primary(db, _card(db, "DeepSeek娘").id, bindings.SPRITE))
    assert len(packs) == 3


def test_each_character_starts_in_the_bundled_background_with_her_own_music():
    db = _fresh_db()
    seed_default_tavern_data(db)
    daily = _pack(db, "现代日常")
    bg_labels = _labels(db, daily)
    for name, music_name in MUSIC_OF.items():
        card = _card(db, name)
        music = _pack(db, music_name)
        assert bindings.scene_parts(db, card.id) == {"bg": [daily.id], "bgm": [music.id]}, name
        # 每个开场白开头点名的背景和曲子都是自带的包里真有的(一开局就在对的地方)
        for text in [card.first_mes, *card.alternate_greetings]:
            assert KANA.search(text)
            head = re.match(r"<bg:([^>]+)>\n<bgm:([^>]+)>\n\n", text)
            assert head, (name, text[:40])
            assert head[1] in bg_labels, (name, head[1])
            assert head[2] in _labels(db, music), (name, head[2])


def test_bundled_scene_packs_have_their_files_and_the_title_music():
    db = _fresh_db()
    seed_default_tavern_data(db)
    assert {p.name for p in db.scalars(select(ScenePack))} == SCENE_PACKS
    backgrounds = {"现代日常": 22, "校园": 11}
    assets = []
    for name, count in backgrounds.items():
        rows = db.scalars(select(SceneAsset).where(SceneAsset.pack_id == _pack(db, name).id)).all()
        assert len(rows) == count and all(a.kind == "bg" and a.mime == "image/webp" for a in rows), name
        assets += rows
    assert {"客厅", "客厅·夜", "卧室·夜", "玄关", "咖啡店"} <= _labels(db, _pack(db, "现代日常"))
    for name in MUSIC_OF.values():
        music = _pack(db, name)
        rows = db.scalars(select(SceneAsset).where(SceneAsset.pack_id == music.id)).all()
        assert len(rows) == 8 and all(a.kind == "bgm" and a.mime == "audio/mpeg" for a in rows), name
        # 三个包的情绪名基本一样,换包后 <bgm:悲伤> 照样对得上
        assert {"日常", "温馨", "俏皮", "心动", "夜晚", "悲伤", "紧张"} <= {a.label for a in rows}, name
        assert music.title_bgm_id in {a.id for a in rows}, name
        assets += rows
    for asset in assets:
        data = refs.read_bytes(refs.SCENE_ASSET, asset)
        assert data and asset.size == len(data)


def test_second_start_does_not_seed_again():
    db = _fresh_db()
    seed_default_tavern_data(db)
    seed_default_tavern_data(db)
    assert len(db.scalars(select(TavernCard)).all()) == 3
    assert len(db.scalars(select(CardPref)).all()) == 3
    assert len(db.scalars(select(ScenePack)).all()) == 5
    assert db.get(AppSetting, "seed.bundled").value == RECORD


def test_a_deleted_bundled_scene_pack_stays_deleted():
    db = _fresh_db()
    seed_default_tavern_data(db)
    campus = _pack(db, "校园")
    db.execute(SceneAsset.__table__.delete().where(SceneAsset.pack_id == campus.id))
    db.delete(campus)
    db.commit()
    seed_default_tavern_data(db)
    assert {p.name for p in db.scalars(select(ScenePack))} == SCENE_PACKS - {"校园"}


# ---- 老用户更新:库里已经有卡,只补还没给过的自带角色 ----


def _names(db):
    return sorted(c.name for c in db.scalars(select(TavernCard)))


def _old_install_db(record=None):
    """更新前的库:只带过 DeepSeek娘(那时没有背景和曲子);record = 那个版本写下的记号(None = 还没有记号的版本)"""
    db = _fresh_db()
    folder, meta = next(it for it in seed._bundled_characters() if it[0].name == "deepseek-chan")
    card = seed._seed_card(db, folder)
    seed._seed_sprites(db, card, folder, meta)
    if record is not None:
        db.add(AppSetting(key="seed.bundled", value=record))
    db.commit()
    return db


def test_update_adds_the_new_bundled_characters_to_an_existing_library():
    db = _old_install_db()
    old = _card(db, "DeepSeek娘")
    old_id, old_greeting = old.id, old.first_mes
    seed_default_tavern_data(db)
    assert _names(db) == ALL_CHARACTERS
    # 原来那张还是那张(开场白也没动),新来的带着自己的立绘包、语言设置、背景和曲子
    assert _card(db, "DeepSeek娘").id == old_id
    assert _card(db, "DeepSeek娘").first_mes == old_greeting
    card = _card(db, "Gemini娘")
    pack_id = bindings.primary(db, card.id, bindings.SPRITE)
    assert len(db.scalars(select(PackSprite).where(PackSprite.pack_id == pack_id)).all()) == 15
    assert db.get(CardPref, (card.id, "plugin.lang")).value == {"lang": "ja"}
    assert bindings.scene_parts(db, card.id)["bgm"] == [_pack(db, MUSIC_OF["Gemini娘"]).id]
    # 再启动一次不会再来一张
    seed_default_tavern_data(db)
    assert _names(db) == ALL_CHARACTERS
    assert len(db.scalars(select(SpritePack)).all()) == 3


def test_update_gives_old_bundled_characters_the_bundled_background_and_music():
    """老版本给的 DeepSeek娘 没有背景和曲子:更新后补挂「现代日常」和音乐包 A,场景包也都建好"""
    db = _old_install_db({"seeded": ["deepseek-chan", "gemini-chan"]})
    seed_default_tavern_data(db)
    card = _card(db, "DeepSeek娘")
    assert bindings.scene_parts(db, card.id) == {
        "bg": [_pack(db, "现代日常").id],
        "bgm": [_pack(db, MUSIC_OF["DeepSeek娘"]).id],
    }
    assert {p.name for p in db.scalars(select(ScenePack))} == SCENE_PACKS
    assert db.get(AppSetting, "seed.bundled").value == RECORD


def test_update_keeps_the_scene_packs_a_player_chose():
    """玩家自己给 DeepSeek娘 挂过场景包(哪怕只挂了曲子):不换成默认的"""
    db = _old_install_db({"seeded": ["deepseek-chan", "gemini-chan"]})
    mine = ScenePack(name="我自己的音乐")
    db.add(mine)
    db.flush()
    card = _card(db, "DeepSeek娘")
    bindings.replace_scene(db, card.id, [], [mine.id])
    db.commit()
    seed_default_tavern_data(db)
    assert bindings.scene_parts(db, card.id) == {"bg": [], "bgm": [mine.id]}


def test_old_bundled_character_removed_later_gets_its_scenes_only_once():
    """补挂只做一次:玩家后来把背景和曲子都撤了,下次启动不会再挂回去"""
    db = _old_install_db({"seeded": ["deepseek-chan", "gemini-chan"]})
    seed_default_tavern_data(db)
    card = _card(db, "DeepSeek娘")
    bindings.replace_scene(db, card.id, [], [])
    db.commit()
    seed_default_tavern_data(db)
    assert bindings.scene_parts(db, card.id) == {"bg": [], "bgm": []}


def test_update_does_not_bring_back_a_bundled_character_deleted_before():
    """老用户早就把 DeepSeek娘 删了、只留自己的卡:更新后只多出新角色"""
    db = _fresh_db()
    db.add(TavernCard(name="我自己的卡"))
    db.commit()
    seed_default_tavern_data(db)
    assert _names(db) == ["Claude娘", "Gemini娘", "我自己的卡"]


def test_new_bundled_character_deleted_after_update_stays_deleted():
    db = _old_install_db()
    seed_default_tavern_data(db)
    db.delete(_card(db, "Gemini娘"))
    db.commit()
    seed_default_tavern_data(db)
    assert _names(db) == ["Claude娘", "DeepSeek娘"]


def test_update_does_not_add_a_second_card_with_the_same_name():
    """库里已经有一张叫 Gemini娘 的卡(自己导入的,或者新装时已经带上):不再放一张,以后也不放,也不给它挂场景包"""
    db = _old_install_db()
    db.add(TavernCard(name="Gemini娘", description="我自己导入的"))
    db.commit()
    seed_default_tavern_data(db)
    seed_default_tavern_data(db)
    assert _names(db) == ALL_CHARACTERS
    mine = _card(db, "Gemini娘")
    assert mine.description == "我自己导入的"
    assert bindings.scene_parts(db, mine.id) == {"bg": [], "bgm": []}
    assert sorted(p.name for p in db.scalars(select(SpritePack))) == ["Claude娘 · 礼裙", "DeepSeek娘 · 女仆 v2"]


def test_a_broken_record_adds_nothing_and_is_rewritten():
    db = _old_install_db("oops")
    seed_default_tavern_data(db)
    assert _names(db) == ["DeepSeek娘"]
    assert db.scalars(select(ScenePack)).first() is None
    assert bindings.scene_parts(db, _card(db, "DeepSeek娘").id) == {"bg": [], "bgm": []}
    assert db.get(AppSetting, "seed.bundled").value == RECORD


def test_characters_added_later_are_seeded_from_the_record():
    """记号里只记着 DeepSeek娘(= 上次启动时只有她):这次多出来的角色补进来,记号跟着更新"""
    db = _old_install_db({"seeded": ["deepseek-chan"]})
    seed_default_tavern_data(db)
    assert _names(db) == ALL_CHARACTERS
    assert db.get(AppSetting, "seed.bundled").value == RECORD
