import base64
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings
from app.config import settings
from app.models import (
    ApiConnection,
    AppSetting,
    CardPref,
    PackSprite,
    Persona,
    PromptPreset,
    SceneAsset,
    ScenePack,
    SpritePack,
    TavernCard,
)
from app.storage import refs

_SEED_DATA = Path(__file__).resolve().parent / "seed_data"
# 哪些自带角色 / 自带场景包已经给过这个库(app_settings):给过的不再给,所以删掉的不会回来,以后新加的会在更新后补上。
# {"seeded": [角色文件夹], "scenes": [场景包文件夹], "scene_bound": [已经挂过默认场景包的角色文件夹]}
_SEEDED_KEY = "seed.bundled"
# 还没有这个记号的老版本只带过她一个:老库第一次遇到记号时当她已经给过
_SEEDED_BEFORE_MARKER = ("deepseek-chan",)
_MIMES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp3": "audio/mpeg"}


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
    card_prefs 按卡设置(比如 plugin.lang 设成 ja = 没装声音也写日中对照,前端 plugins/lang.ts 的 CardLang);
    scene_packs {bg: [...], bgm: [...]} = 背景、曲子挂 seed_data 里的哪几个场景包文件夹(见 ensure_scene_pack)"""
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


def _bundled_scene_packs() -> list[Path]:
    """自带场景包:seed_data 下每个带 scene.json 的文件夹(背景「现代日常」「校园」、默认音乐包 A / B / C),
    出处见各自的 CREDITS.txt。加一个包 = 放一个这样的文件夹进来"""
    return sorted(folder for folder in _SEED_DATA.iterdir() if (folder / "scene.json").is_file())


def ensure_scene_pack(db: Session, folder: Path) -> tuple[ScenePack, bool]:
    """seed_data 里一个场景包文件夹(scene.json + 文件)对应的包:库里已经有(按包名认)就用它,没有就照文件夹建一个。
    返回 (包, 这次是不是新建的)。不提交。
    scene.json:name、description;bgms / bgs 各一组 {file, label, aliases, description},背景可带 bgm(同包曲子的名字)
    和 focus;title_bgm = 封面放哪首(曲子的名字)"""
    meta = json.loads((folder / "scene.json").read_text(encoding="utf-8"))
    pack = db.scalars(select(ScenePack).where(ScenePack.name == meta["name"])).first()
    if pack is not None:
        return pack, False
    pack = ScenePack(name=meta["name"], description=meta.get("description", ""))
    db.add(pack)
    db.flush()
    bgm_ids: dict[str, str] = {}
    for i, row in enumerate(meta.get("bgms", [])):
        bgm_ids[row["label"]] = _pack_asset(db, pack, folder, "bgm", i, row).id
    for i, row in enumerate(meta.get("bgs", [])):
        asset = _pack_asset(db, pack, folder, "bg", i, row)
        asset.focus_x = row.get("focus", 50)
        asset.bgm_id = bgm_ids.get(row.get("bgm", ""))
    pack.title_bgm_id = bgm_ids.get(meta.get("title_bgm", ""))
    db.flush()
    return pack, True


def _pack_asset(db: Session, pack: ScenePack, folder: Path, kind: str, sort: int, row: dict) -> SceneAsset:
    path = folder / row["file"]
    data = path.read_bytes()
    mime = _MIMES[path.suffix.lower()]
    asset = SceneAsset(
        pack_id=pack.id,
        kind=kind,
        label=row["label"],
        aliases=row.get("aliases", []),
        description=row.get("description", ""),
        sort=sort,
        mime=mime,
        size=len(data),
    )
    db.add(asset)
    db.flush()
    # 和上传的素材一样走 refs.save:文件仓库开着时只进仓库,库里不存原件
    refs.save(refs.SCENE_ASSET, asset, data, mime, db)
    return asset


def _bind_scene_packs(db: Session, card: TavernCard, meta: dict) -> None:
    """按 seed.json 的 scene_packs 给自带角色挂背景和曲子(包不在库里就照 seed_data 建)"""
    scenes = meta.get("scene_packs", {})
    if not scenes:
        return
    bindings.replace_scene(
        db,
        card.id,
        [ensure_scene_pack(db, _SEED_DATA / name)[0].id for name in scenes.get("bg", [])],
        [ensure_scene_pack(db, _SEED_DATA / name)[0].id for name in scenes.get("bgm", [])],
    )


def _marker_list(marker: AppSetting | None, key: str) -> list[str] | None:
    """记号里的某一栏;没有记号、栏不在、或者不是这里写的样子都回 None"""
    if marker is None or not isinstance(marker.value, dict):
        return None
    value = marker.value.get(key)
    return value if isinstance(value, list) and all(isinstance(v, str) for v in value) else None


def seed_default_tavern_data(db: Session) -> None:
    """The bundled characters (DeepSeek娘, Claude娘, Gemini娘 —— each with her sprite pack, a bundled background
    pack and music pack) + the bundled scene packs + default Chat Completion preset, so a fresh install has someone
    to talk to before any import.

    空库(第一次启动,或者卡全删光了):自带角色全部种一遍。
    库里已经有卡:只补还没给过这个库的自带角色 —— 更新后新加的角色会自己出现,
    以前给过又被删掉的不会回来;库里已经有同名的卡就不再放一张。
    自带场景包同样只给一次(删了不回来)。以前给过、当时还没有默认背景和曲子的自带角色,
    卡还在、自己也没挂过场景包的,补挂一次。"""
    bundled = _bundled_characters()
    scene_folders = _bundled_scene_packs()
    marker = db.get(AppSetting, _SEEDED_KEY)
    # 记号坏了(不是这里写的样子)就当都给过,不往别人的库里乱补
    broken = marker is not None and _marker_list(marker, "seeded") is None
    if db.scalars(select(TavernCard)).first() is None:
        pending = bundled
    else:
        if marker is None:
            given = set(_SEEDED_BEFORE_MARKER)
        else:
            given = {folder.name for folder, _ in bundled} if broken else set(_marker_list(marker, "seeded"))
        pending = [(folder, meta) for folder, meta in bundled if folder.name not in given]

    given_scenes = {f.name for f in scene_folders} if broken else set(_marker_list(marker, "scenes") or [])
    for folder in scene_folders:
        if folder.name not in given_scenes:
            ensure_scene_pack(db, folder)

    for folder, meta in pending:
        raw = json.loads((folder / "card.json").read_text(encoding="utf-8"))
        name = raw.get("data", raw).get("name")
        if name and db.scalars(select(TavernCard).where(TavernCard.name == name)).first() is not None:
            continue
        card = _seed_card(db, folder)
        _seed_sprites(db, card, folder, meta)
        for key, value in meta.get("card_prefs", {}).items():
            db.add(CardPref(card_id=card.id, key=key, value=value))
        _bind_scene_packs(db, card, meta)

    # 老版本给的自带角色(那时还没有默认背景和曲子):卡还在、背景和曲子一个都没挂的,挂上 seed.json 里的
    bound = {folder.name for folder, _ in bundled} if broken else set(_marker_list(marker, "scene_bound") or [])
    bound |= {folder.name for folder, _ in pending}
    for folder, meta in bundled:
        if folder.name in bound:
            continue
        raw = json.loads((folder / "card.json").read_text(encoding="utf-8"))
        card = db.scalars(select(TavernCard).where(TavernCard.name == raw.get("data", raw).get("name"))).first()
        if card is not None and not any(bindings.scene_parts(db, card.id).values()):
            _bind_scene_packs(db, card, meta)

    record = {
        "seeded": [folder.name for folder, _ in bundled],
        "scenes": [folder.name for folder in scene_folders],
        "scene_bound": [folder.name for folder, _ in bundled],
    }
    if marker is None:
        db.add(AppSetting(key=_SEEDED_KEY, value=record))
    elif marker.value != record:
        marker.value = record

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
