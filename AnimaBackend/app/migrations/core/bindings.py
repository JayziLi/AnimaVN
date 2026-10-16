"""绑定表和角色位(素材架构设计 3.2、8.3,第 4 期):建 card_roles、asset_bindings,按三张旧表填好。

每张卡建一个主角色位(名字 = 卡名);card_sprite_packs → 主角色位的立绘包(顺序、当前包照旧),
card_voices → 主角色位的声音(主声音照旧,附加声音成了备用声音,按原来的先后),card_scene_packs → 卡级的场景包。
只加不改:旧表一行不动,之后接口两边都写(app/bindings.py),退回旧代码照常能跑。
"""

import sqlite3
import uuid
from datetime import datetime, timezone

from app.migrations.base import Step
from app.migrations.sqlite_util import create_model_tables, empty_database, table_exists

TABLES = ("card_roles", "asset_bindings")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")


def _old_rows(conn: sqlite3.Connection) -> list[tuple[str, str, str, str, int, bool]]:
    """旧表里的绑定:(卡, 角色位级 role / 卡级 card, kind, 目标, sort, 是不是 primary),按卡和原来的顺序"""
    out: list[tuple[str, str, str, str, int, bool]] = []
    if table_exists(conn, "card_sprite_packs"):
        for card, pack, sort, cur in conn.execute(
            "SELECT card_id, pack_id, sort, is_current FROM card_sprite_packs ORDER BY card_id, sort, rowid"
        ):
            out.append((card, "role", "sprite", pack, sort, bool(cur)))
    if table_exists(conn, "card_voices"):
        rows = conn.execute("SELECT card_id, profile_id, is_main FROM card_voices ORDER BY card_id, rowid").fetchall()
        # 主声音排第一,其余照原来的先后(今天接口返回的 extras 就是这个顺序)
        by_card: dict[str, list[tuple[str, bool]]] = {}
        for card, profile, main in rows:
            by_card.setdefault(card, []).append((profile, bool(main)))
        for card, items in by_card.items():
            items.sort(key=lambda it: not it[1])
            for i, (profile, main) in enumerate(items):
                out.append((card, "role", "voice", profile, i, main))
    if table_exists(conn, "card_scene_packs"):
        for card, pack in conn.execute("SELECT card_id, pack_id FROM card_scene_packs ORDER BY card_id"):
            out.append((card, "card", "scene", pack, 0, False))
    return out


def _cards(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    return conn.execute("SELECT id, name FROM tavern_cards ORDER BY rowid").fetchall()


def _main_roles(conn: sqlite3.Connection) -> dict[str, str]:
    return dict(conn.execute("SELECT card_id, id FROM card_roles WHERE is_main = 1").fetchall())


def _missing(conn: sqlite3.Connection) -> list[tuple[str, str, str, str, int, bool]]:
    """旧表里有、新表里还没有的绑定(卡已经删了的不算)"""
    cards = {c for c, _ in _cards(conn)}
    have = {
        (card, kind, target)
        for card, kind, target in conn.execute("SELECT card_id, kind, target_id FROM asset_bindings")
    }
    return [r for r in _old_rows(conn) if r[0] in cards and (r[0], r[2], r[3]) not in have]


def _done(conn: sqlite3.Connection) -> bool:
    # 新库、连卡表都没有的库:后端启动时 create_all 建出完整的表,没有要搬的
    if empty_database(conn) or not table_exists(conn, "tavern_cards"):
        return True
    if not all(table_exists(conn, t) for t in TABLES):
        return False
    roles = _main_roles(conn)
    return all(card in roles for card, _ in _cards(conn)) and not _missing(conn)


def _apply(conn: sqlite3.Connection) -> None:
    create_model_tables(conn, TABLES)
    now = _now()
    roles = _main_roles(conn)
    for card, name in _cards(conn):
        if card not in roles:
            roles[card] = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO card_roles (id, card_id, name, aliases, sort, is_main, created_at)"
                " VALUES (?, ?, ?, '[]', 0, 1, ?)",
                (roles[card], card, name or "", now),
            )
    for card, level, kind, target, sort, primary in _missing(conn):
        conn.execute(
            "INSERT INTO asset_bindings (id, card_id, role_id, kind, target_id, sort, is_primary, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (uuid.uuid4().hex, card, roles[card] if level == "role" else "", kind, target, sort, int(primary), now),
        )


def _verify(conn: sqlite3.Connection) -> bool:
    return _done(conn)


STEP = Step(
    id="core.2026_10_bindings",
    title="绑定:卡 → 角色位 → 立绘包、声音、场景包",
    detect=_done,
    apply=_apply,
    verify=_verify,
    kind="data",
)
