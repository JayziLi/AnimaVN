"""自带角色(app/seed.py):空库第一次启动种进去的 DeepSeek娘 —— 日中对照的卡、立绘包、按卡设置里语言是日语。"""

import re

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import bindings
from app.db import Base
from app.models import CardPref, PackSprite, TavernCard
from app.seed import seed_default_tavern_data

KANA = re.compile(r"[ぁ-ゖァ-ヺー]")


def _fresh_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def test_seeds_bilingual_deepseek_with_language_set_to_japanese():
    db = _fresh_db()
    seed_default_tavern_data(db)
    card = db.scalars(select(TavernCard)).one()
    assert card.name == "DeepSeek娘"
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


def test_second_start_does_not_seed_again():
    db = _fresh_db()
    seed_default_tavern_data(db)
    seed_default_tavern_data(db)
    assert len(db.scalars(select(TavernCard)).all()) == 1
    assert len(db.scalars(select(CardPref)).all()) == 1
