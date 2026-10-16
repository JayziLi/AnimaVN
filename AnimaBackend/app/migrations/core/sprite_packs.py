"""老库里立绘挂在卡上(card_sprites)→ 立绘包。原来是 scripts/migrate_sprite_packs.py,
设计见 docs/superpowers/specs/2026-09-27-sprite-packs-design.md。

每张有立绘的卡变成一个包(包名 = 卡名,撞名加「 (2)」「 (3)」),挂到这张卡上设为当前;
立绘、找脸结果、位置微调完全相同的卡(复制出来的卡)共用一个包。老表原样留着。
"""

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone

from app.migrations.base import Step
from app.migrations.sqlite_util import create_model_tables, table_exists

NEW_TABLES = ("sprite_packs", "pack_sprites", "sprite_pack_layouts", "card_sprite_packs")
SPRITE_COLS = "label, aliases, description, image, mime, sort, enabled, face_scan, created_at, updated_at"
DEFAULT_LAYOUT = (1, 1.0, 0.0, 0.0)


def _has_sprites(conn: sqlite3.Connection) -> bool:
    if not table_exists(conn, "card_sprites") or not table_exists(conn, "tavern_cards"):
        return False
    row = conn.execute(
        "SELECT 1 FROM card_sprites WHERE card_id IN (SELECT id FROM tavern_cards) LIMIT 1"
    ).fetchone()
    return row is not None


def _done(conn: sqlite3.Connection) -> bool:
    if not _has_sprites(conn):
        return True
    # 立绘包已经开始用了(迁移以前跑过):以后卡上没挂包,是玩家自己拿掉的,不能再给它变出来
    return table_exists(conn, "card_sprite_packs") and (
        conn.execute("SELECT 1 FROM card_sprite_packs LIMIT 1").fetchone() is not None
    )


def _create_tables(conn: sqlite3.Connection) -> None:
    """新表照 models.py 建(和后端的 create_all 一样);已经有的不动"""
    create_model_tables(conn, NEW_TABLES)


def _signature(conn: sqlite3.Connection, card_id: str, has_layouts: bool) -> str:
    """游戏里能看到的这张卡立绘的全部样子;一样的卡可以共用一个包"""
    rows = conn.execute(
        "SELECT label, aliases, description, mime, sort, enabled, image FROM card_sprites"
        " WHERE card_id = ? ORDER BY sort, created_at, id",
        (card_id,),
    ).fetchall()
    layout = (
        conn.execute("SELECT auto, zoom, dx, dy FROM card_sprite_layouts WHERE card_id = ?", (card_id,)).fetchone()
        if has_layouts
        else None
    )
    parts = [[*r[:6], hashlib.sha256(r[6] or b"").hexdigest()] for r in rows]
    parts.append(list(layout or DEFAULT_LAYOUT))
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()


def _unique_name(name: str, taken: set[str]) -> str:
    base = name.strip() or "未命名"
    candidate, n = base, 2
    while candidate.casefold() in taken:
        candidate, n = f"{base} ({n})", n + 1
    taken.add(candidate.casefold())
    return candidate


def _apply(conn: sqlite3.Connection) -> None:
    _create_tables(conn)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")
    done = {r[0] for r in conn.execute("SELECT DISTINCT card_id FROM card_sprite_packs")}
    taken = {r[0].casefold() for r in conn.execute("SELECT name FROM sprite_packs")}
    has_layouts = table_exists(conn, "card_sprite_layouts")
    cards = conn.execute(
        "SELECT id, name FROM tavern_cards WHERE id IN (SELECT card_id FROM card_sprites)"
        " ORDER BY created_at, id"
    ).fetchall()
    made: dict[str, str] = {}  # signature -> pack id
    for card_id, card_name in cards:
        if card_id in done:
            continue
        sig = _signature(conn, card_id, has_layouts)
        pack_id = made.get(sig)
        if pack_id is None:
            pack_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO sprite_packs (id, name, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
                (pack_id, _unique_name(card_name or "", taken), now, now),
            )
            sprite_ids = [
                r[0]
                for r in conn.execute(
                    "SELECT id FROM card_sprites WHERE card_id = ? ORDER BY sort, created_at, id", (card_id,)
                ).fetchall()
            ]
            for sid in sprite_ids:
                conn.execute(
                    f"INSERT INTO pack_sprites (id, pack_id, {SPRITE_COLS})"
                    f" SELECT ?, ?, {SPRITE_COLS} FROM card_sprites WHERE id = ?",
                    (uuid.uuid4().hex, pack_id, sid),
                )
            layout = (
                conn.execute(
                    "SELECT auto, zoom, dx, dy FROM card_sprite_layouts WHERE card_id = ?", (card_id,)
                ).fetchone()
                if has_layouts
                else None
            )
            if layout is not None and tuple(layout) != DEFAULT_LAYOUT:
                conn.execute(
                    "INSERT INTO sprite_pack_layouts (pack_id, auto, zoom, dx, dy) VALUES (?, ?, ?, ?, ?)",
                    (pack_id, *layout),
                )
            made[sig] = pack_id
        conn.execute(
            "INSERT INTO card_sprite_packs (card_id, pack_id, sort, is_current) VALUES (?, ?, 0, 1)",
            (card_id, pack_id),
        )


def _verify(conn: sqlite3.Connection) -> bool:
    """每张有立绘的卡都挂上了包"""
    if not _has_sprites(conn):
        return True
    missing = conn.execute(
        "SELECT count(*) FROM (SELECT DISTINCT card_id FROM card_sprites"
        " WHERE card_id IN (SELECT id FROM tavern_cards))"
        " WHERE card_id NOT IN (SELECT card_id FROM card_sprite_packs)"
    ).fetchone()[0]
    return missing == 0


STEP = Step(
    id="core.2026_09_sprite_packs",
    title="立绘:从挂在卡上改成立绘包",
    detect=_done,
    apply=_apply,
    verify=_verify,
    kind="data",
    depends=("core.2026_09_asset_enabled", "core.2026_09_sprite_face"),
)
