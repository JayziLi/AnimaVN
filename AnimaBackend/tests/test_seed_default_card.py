"""自带角色(app/seed.py):空库第一次启动种进去的 DeepSeek娘 和 Gemini娘 —— 日中对照的卡、各自的立绘包、按卡设置里语言是日语。"""

import re

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import bindings, seed
from app.db import Base
from app.models import AppSetting, CardPref, PackSprite, SpritePack, TavernCard
from app.seed import seed_default_tavern_data

KANA = re.compile(r"[ぁ-ゖァ-ヺー]")


def _fresh_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def test_seeds_bilingual_deepseek_with_language_set_to_japanese():
    db = _fresh_db()
    seed_default_tavern_data(db)
    card = db.scalars(select(TavernCard).where(TavernCard.name == "DeepSeek娘")).one()
    assert "日语配音" in card.character_version
    # 开场白、备用开场白、示例都是一行日语一行中文;不带场景包,所以没有 <bg> / <bgm>
    for text in [card.first_mes, *card.alternate_greetings, card.mes_example]:
        assert KANA.search(text)
        assert "<bg" not in text
    # 语言设成日语:没装声音也写日中对照(前端 plugins/lang.ts)
    pref = db.get(CardPref, (card.id, "plugin.lang"))
    assert pref is not None and pref.value == {"lang": "ja"}
    # 立绘包照旧挂上
    pack_id = bindings.primary(db, card.id, bindings.SPRITE)
    assert pack_id and len(db.scalars(select(PackSprite).where(PackSprite.pack_id == pack_id)).all()) == 10


def test_seeds_gemini_as_the_second_bundled_character():
    db = _fresh_db()
    seed_default_tavern_data(db)
    assert {c.name for c in db.scalars(select(TavernCard))} == {"DeepSeek娘", "Gemini娘"}
    card = db.scalars(select(TavernCard).where(TavernCard.name == "Gemini娘")).one()
    assert "日语配音" in card.character_version
    # 开场白一行日语一行中文;不带场景包,所以没有 <bg> / <bgm>
    for text in [card.first_mes, *card.alternate_greetings]:
        assert KANA.search(text)
        assert "<bg" not in text
    # 自带的是全年龄版
    for word in ("擦边", "色色"):
        assert word not in card.description
    assert card.character_book and len(card.character_book["entries"]) == 11
    pref = db.get(CardPref, (card.id, "plugin.lang"))
    assert pref is not None and pref.value == {"lang": "ja"}
    # 她自己的立绘包,15 个表情,脸的位置随包带着
    pack_id = bindings.primary(db, card.id, bindings.SPRITE)
    sprites = db.scalars(select(PackSprite).where(PackSprite.pack_id == pack_id)).all()
    assert len(sprites) == 15
    assert all(s.face_scan and s.face_scan.get("face") for s in sprites)
    assert pack_id != bindings.primary(db, db.scalars(select(TavernCard).where(TavernCard.name == "DeepSeek娘")).one().id, bindings.SPRITE)


def test_second_start_does_not_seed_again():
    db = _fresh_db()
    seed_default_tavern_data(db)
    seed_default_tavern_data(db)
    assert len(db.scalars(select(TavernCard)).all()) == 2
    assert len(db.scalars(select(CardPref)).all()) == 2


# ---- 老用户更新:库里已经有卡,只补还没给过的自带角色 ----


def _names(db):
    return sorted(c.name for c in db.scalars(select(TavernCard)))


def _old_install_db():
    """更新前的库:只带过 DeepSeek娘,还没有「给过哪些自带角色」的记号"""
    db = _fresh_db()
    folder, meta = next(it for it in seed._bundled_characters() if it[0].name == "deepseek-chan")
    card = seed._seed_card(db, folder)
    seed._seed_sprites(db, card, folder, meta)
    db.commit()
    return db


def test_update_adds_the_new_bundled_character_to_an_existing_library():
    db = _old_install_db()
    old_id = db.scalars(select(TavernCard)).one().id
    seed_default_tavern_data(db)
    assert _names(db) == ["DeepSeek娘", "Gemini娘"]
    # 原来那张没动,新来的带着自己的立绘包和语言设置
    assert db.scalars(select(TavernCard).where(TavernCard.name == "DeepSeek娘")).one().id == old_id
    card = db.scalars(select(TavernCard).where(TavernCard.name == "Gemini娘")).one()
    pack_id = bindings.primary(db, card.id, bindings.SPRITE)
    assert len(db.scalars(select(PackSprite).where(PackSprite.pack_id == pack_id)).all()) == 15
    assert db.get(CardPref, (card.id, "plugin.lang")).value == {"lang": "ja"}
    # 再启动一次不会再来一张
    seed_default_tavern_data(db)
    assert _names(db) == ["DeepSeek娘", "Gemini娘"]
    assert len(db.scalars(select(SpritePack)).all()) == 2


def test_update_does_not_bring_back_a_bundled_character_deleted_before():
    """老用户早就把 DeepSeek娘 删了、只留自己的卡:更新后只多出新角色"""
    db = _fresh_db()
    db.add(TavernCard(name="我自己的卡"))
    db.commit()
    seed_default_tavern_data(db)
    assert _names(db) == ["Gemini娘", "我自己的卡"]


def test_new_bundled_character_deleted_after_update_stays_deleted():
    db = _old_install_db()
    seed_default_tavern_data(db)
    db.delete(db.scalars(select(TavernCard).where(TavernCard.name == "Gemini娘")).one())
    db.commit()
    seed_default_tavern_data(db)
    assert _names(db) == ["DeepSeek娘"]


def test_update_does_not_add_a_second_card_with_the_same_name():
    """库里已经有一张叫 Gemini娘 的卡(自己导入的,或者新装时已经带上):不再放一张,以后也不放"""
    db = _old_install_db()
    db.add(TavernCard(name="Gemini娘", description="我自己导入的"))
    db.commit()
    seed_default_tavern_data(db)
    seed_default_tavern_data(db)
    assert _names(db) == ["DeepSeek娘", "Gemini娘"]
    assert db.scalars(select(TavernCard).where(TavernCard.name == "Gemini娘")).one().description == "我自己导入的"
    assert [p.name for p in db.scalars(select(SpritePack))] == ["DeepSeek娘 · 女仆 v2"]


def test_a_broken_record_adds_nothing_and_is_rewritten():
    db = _old_install_db()
    db.add(AppSetting(key="seed.bundled", value="oops"))
    db.commit()
    seed_default_tavern_data(db)
    assert _names(db) == ["DeepSeek娘"]
    assert db.get(AppSetting, "seed.bundled").value == {"seeded": ["deepseek-chan", "gemini-chan"]}


def test_characters_added_later_are_seeded_from_the_record():
    """记号里只记着 DeepSeek娘(= 上次启动时只有她):这次多出来的角色补进来,记号跟着更新"""
    db = _old_install_db()
    db.add(AppSetting(key="seed.bundled", value={"seeded": ["deepseek-chan"]}))
    db.commit()
    seed_default_tavern_data(db)
    assert _names(db) == ["DeepSeek娘", "Gemini娘"]
    assert db.get(AppSetting, "seed.bundled").value == {"seeded": ["deepseek-chan", "gemini-chan"]}
