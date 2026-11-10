import base64
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings
from app.config import settings
from app.models import (
    ApiConnection,
    CardPref,
    PackSprite,
    Persona,
    PromptPreset,
    SpritePack,
    TavernCard,
)
from app.storage import refs

_SEED_DATA = Path(__file__).resolve().parent / "seed_data"


def seed_default_persona(db: Session) -> None:
    """First run only: a default player persona so {{user}} has a name."""
    if db.scalars(select(Persona)).first() is not None:
        return
    db.add(
        Persona(
            name="旅行者",
            description="一位远道而来的旅行者,对这片土地上的新鲜事物充满好奇。",
            is_active=True,
        )
    )
    db.commit()


def seed_default_connections(db: Session) -> None:
    """First run only: a mock connection, plus real ones for any keys in .env."""
    if db.scalars(select(ApiConnection)).first() is not None:
        return
    conns = [ApiConnection(name="Mock（本地测试）", api_type="mock", model="mock")]
    if settings.anthropic_api_key:
        conns.append(
            ApiConnection(
                name="Anthropic（来自 .env）",
                api_type="anthropic",
                api_key=settings.anthropic_api_key,
                model="claude-sonnet-5",
            )
        )
    if settings.openai_api_key:
        conns.append(
            ApiConnection(
                name="OpenAI（来自 .env）",
                api_type="openai_compatible",
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url,
                model="gpt-4o",
            )
        )
    # prefer a real connection as the active one; mock only if that's all there is
    conns[-1].is_active = True
    db.add_all(conns)
    db.commit()


def _bundled_characters() -> list[tuple[Path, dict]]:
    """自带角色:seed_data 下每个带 seed.json 的文件夹是一个(卡 card.json + 头像 avatar.webp + 立绘包 sprites.json /
    sprites/,授权见各自的 CREDITS.txt),按 seed.json 的 order 排。加一个角色 = 放一个这样的文件夹进来,不用改代码。

    seed.json:sprite_pack {name, description}(包名换图时也要换:老库里留着的旧包不会被当成新包挂回去);
    card_prefs 按卡设置(比如 plugin.lang 设成 ja = 没装声音也写日中对照,前端 plugins/lang.ts 的 CardLang)"""
    found = []
    for folder in _SEED_DATA.iterdir():
        meta_file = folder / "seed.json"
        if meta_file.is_file():
            found.append((folder, json.loads(meta_file.read_text(encoding="utf-8"))))
    return sorted(found, key=lambda it: (it[1].get("order", 0), it[0].name))


def _seed_card(db: Session, folder: Path) -> TavernCard:
    raw = json.loads((folder / "card.json").read_text(encoding="utf-8"))
    # V2/V3 keep the real fields under `data`; V1 is flat
    d = raw.get("data", raw)
    avatar = base64.b64encode((folder / "avatar.webp").read_bytes()).decode("ascii")
    card = TavernCard(
        name=d.get("name", ""),
        description=d.get("description", ""),
        personality=d.get("personality", ""),
        scenario=d.get("scenario", ""),
        first_mes=d.get("first_mes", ""),
        mes_example=d.get("mes_example", ""),
        system_prompt=d.get("system_prompt", ""),
        post_history_instructions=d.get("post_history_instructions", ""),
        creator_notes=d.get("creator_notes", ""),
        alternate_greetings=d.get("alternate_greetings", []),
        tags=d.get("tags", []),
        creator=d.get("creator", ""),
        character_version=d.get("character_version", ""),
        character_book=d.get("character_book"),
        extensions=d.get("extensions", {}),
        spec=raw.get("spec", "chara_card_v2"),
        avatar=f"data:image/webp;base64,{avatar}",
    )
    db.add(card)
    db.flush()
    return card


def _seed_sprites(db: Session, card: TavernCard, folder: Path, meta: dict) -> None:
    """自带角色的立绘包。删了卡又重新种的时候,同名的包还在就直接挂回去,不再建一个。
    脸的位置是导出时就算好的(sprites.json 的 face_scan),首启不用再跑一遍找脸。"""
    info = meta["sprite_pack"]
    pack = db.scalars(select(SpritePack).where(SpritePack.name == info["name"])).first()
    if pack is None:
        pack = SpritePack(name=info["name"], description=info.get("description", ""))
        db.add(pack)
        db.flush()
        rows = json.loads((folder / "sprites.json").read_text(encoding="utf-8"))
        for i, row in enumerate(rows):
            sprite = PackSprite(
                pack_id=pack.id,
                label=row["label"],
                aliases=row.get("aliases", []),
                description=row.get("description", ""),
                mime="image/webp",
                sort=i,
                face_scan=row.get("face_scan"),
                effect=row.get("effect"),
            )
            # 和上传的立绘一样走 refs.save:文件仓库开着时只进仓库,库里不存原件
            refs.save(refs.SPRITE, sprite, (folder / "sprites" / row["file"]).read_bytes(), "image/webp", db)
            db.add(sprite)
    db.flush()
    bindings.replace(db, card.id, bindings.SPRITE, [pack.id], pack.id)


def seed_default_tavern_data(db: Session) -> None:
    """First run only: the bundled characters (DeepSeek娘, Gemini娘 —— each with her sprite pack) + default
    Chat Completion preset, so a fresh install has someone to talk to before any import."""
    if db.scalars(select(TavernCard)).first() is None:
        for folder, meta in _bundled_characters():
            card = _seed_card(db, folder)
            _seed_sprites(db, card, folder, meta)
            for key, value in meta.get("card_prefs", {}).items():
                db.add(CardPref(card_id=card.id, key=key, value=value))

    if db.scalars(select(PromptPreset)).first() is None:
        raw = json.loads((_SEED_DATA / "default-preset.json").read_text(encoding="utf-8"))
        db.add(
            PromptPreset(
                name="默认预设",
                prompts=raw.get("prompts", []),
                prompt_order=raw.get("prompt_order", []),
                formats={
                    k: raw[k]
                    for k in (
                        "wi_format",
                        "scenario_format",
                        "personality_format",
                        "group_nudge_prompt",
                        "new_chat_prompt",
                        "new_example_chat_prompt",
                    )
                    if k in raw
                },
                params={
                    k: raw[k]
                    for k in ("temperature", "top_p", "openai_max_context", "openai_max_tokens")
                    if k in raw
                },
                squash_system_messages=raw.get("squash_system_messages", False),
            )
        )

    db.commit()
