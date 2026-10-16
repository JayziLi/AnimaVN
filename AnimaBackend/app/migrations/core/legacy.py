"""以前手动跑的 scripts/migrate_*.py,改写成迁移器的步骤。

每一步只给已经存在的表补东西;表还不存在的(新库)由 create_all 建出完整的表,这里当作做完了。
SQL 和原来的脚本一字不差:老库手跑过脚本的,detect 认得出来,只登记、不再做。
"""

import sqlite3

from app.migrations.base import Step
from app.migrations.sqlite_util import add_columns_step, columns, index_exists, table_exists

VOICE_PARAMS = add_columns_step(
    "core.2026_09_voice_params",
    "声音:记下调过的合成参数",
    [("voice_profiles", "params", "JSON NOT NULL DEFAULT '{}'")],
)
VOICE_INDEXTTS = add_columns_step(
    "core.2026_09_voice_indextts",
    "声音:IndexTTS 的音色参考和情绪向量",
    [
        ("voice_profiles", "ref_path", "VARCHAR(500) NOT NULL DEFAULT ''"),
        ("voice_emotions", "emo_vector", "JSON"),
    ],
)
ASSET_ENABLED = add_columns_step(
    "core.2026_09_asset_enabled",
    "立绘和场景素材:可以停用、不用删",
    [
        ("card_sprites", "enabled", "BOOLEAN NOT NULL DEFAULT 1"),
        ("scene_assets", "enabled", "BOOLEAN NOT NULL DEFAULT 1"),
    ],
)
SPRITE_FACE = add_columns_step(
    "core.2026_09_sprite_face", "立绘:记下脸在哪", [("card_sprites", "face_scan", "JSON")]
)
CARD_LAST_CHAT = add_columns_step(
    "core.2026_08_card_last_chat",
    "角色卡:记住上次打开的对话",
    [("tavern_cards", "last_chat_id", "VARCHAR(32)")],
)
CHAT_PARENT = add_columns_step(
    "core.2026_08_chat_parent",
    "对话:记下是从哪条分出来的",
    [
        ("debug_chats", "parent_chat_id", "VARCHAR(32)"),
        ("debug_chats", "parent_message_id", "VARCHAR(36)"),
    ],
)
CHAT_VARIABLES = add_columns_step(
    "core.2026_09_chat_variables",
    "对话:宏变量",
    [("debug_chats", "variables", "JSON NOT NULL DEFAULT '{}'")],
)
CONNECTION_CACHE = add_columns_step(
    "core.2026_07_connection_cache",
    "连接:记住模型列表",
    [
        ("api_connections", "cached_models", "TEXT NOT NULL DEFAULT '[]'"),
        ("api_connections", "cached_models_at", "DATETIME"),
    ],
)
CONNECTION_STREAM = add_columns_step(
    "core.2026_08_connection_stream",
    "连接:流式开关",
    [("api_connections", "stream", "BOOLEAN NOT NULL DEFAULT 1")],
)
CONNECTION_THINKING = add_columns_step(
    "core.2026_09_connection_thinking",
    "连接:思考深浅",
    [("api_connections", "thinking", "VARCHAR(16)")],
)
SCENE_TITLE_BGM = add_columns_step(
    "core.2026_09_scene_title_bgm", "场景包:封面曲", [("scene_packs", "title_bgm_id", "VARCHAR(32)")]
)


def _tts_index_done(conn: sqlite3.Connection) -> bool:
    return not table_exists(conn, "tts_cache") or index_exists(conn, "tts_cache", "ix_tts_cache_evict")


def _tts_index_apply(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE INDEX IF NOT EXISTS ix_tts_cache_evict ON tts_cache (last_used_at, size, key)")
    conn.execute("DROP INDEX IF EXISTS ix_tts_cache_last_used_at")


TTS_CACHE_INDEX = Step(
    id="core.2026_09_tts_cache_index",
    title="语音缓存:淘汰旧句子用的覆盖索引",
    detect=_tts_index_done,
    apply=_tts_index_apply,
    verify=_tts_index_done,
)


def _scene_parent_done(conn: sqlite3.Connection) -> bool:
    have = columns(conn, "scene_assets")
    return not have or ("parent_id" in have and index_exists(conn, "scene_assets", "ix_scene_assets_parent_id"))


def _scene_parent_apply(conn: sqlite3.Connection) -> None:
    if "parent_id" not in columns(conn, "scene_assets"):
        conn.execute("ALTER TABLE scene_assets ADD COLUMN parent_id VARCHAR(32)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_scene_assets_parent_id ON scene_assets (parent_id)")


SCENE_PARENT = Step(
    id="core.2026_10_scene_parent",
    title="CG:差分挂在构图下面",
    detect=_scene_parent_done,
    apply=_scene_parent_apply,
    verify=_scene_parent_done,
)
SCENE_FORMS = add_columns_step(
    "core.2026_10_scene_forms",
    "CG:标记在哪些形态里出",
    [("scene_assets", "forms", "JSON NOT NULL DEFAULT '[]'")],
)
SPRITE_EFFECT = add_columns_step(
    "core.2026_10_sprite_effect",
    "立绘:切换特效",
    [("pack_sprites", "effect", "JSON")],
    depends=["core.2026_09_sprite_packs"],
)
VOICE_AUX_REFS = add_columns_step(
    "core.2026_10_voice_aux_refs",
    "声音:辅助参考",
    [("voice_emotions", "aux_refs", "JSON NOT NULL DEFAULT '[]'")],
)
