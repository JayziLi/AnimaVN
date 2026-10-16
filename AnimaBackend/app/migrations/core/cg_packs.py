"""CG 包(素材架构设计 3.4、8.3,第 4 期):建 cg_packs、cg_assets,把场景包里的 CG 搬出来。

每个有 CG 的场景包拆出一个「<场景包名> · CG」:构图和差分原样搬过去,编号、顺序、名字、别名、说明、启用、
竖屏焦点、forms 都不变(配对表、Jev 标注里记的编号不用换);原件已经在文件仓库里的(有指纹)只记指纹,
还没有指纹的连原件一起搬。原来绑这个场景包的每张卡,都加一条卡级的 CG 绑定 —— 所以迁完逐句和以前一样。
只加不改:场景包里原来的 CG 行原样留着(旧代码照常读),清理期再删。
"""

import sqlite3
import uuid
from datetime import datetime, timezone

from app.migrations.base import Step
from app.migrations.sqlite_util import columns, create_model_tables, empty_database, table_exists

TABLES = ("cg_packs", "cg_assets")
COLS = "parent_id, label, aliases, description, mime, size, data_sha, sort, focus_x, forms, enabled, created_at, updated_at"


def _scene_packs_with_cg(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    # 很老的库(场景素材还没有 kind 列)不可能有 CG
    if not table_exists(conn, "scene_packs") or "kind" not in columns(conn, "scene_assets"):
        return []
    return conn.execute(
        "SELECT id, name FROM scene_packs WHERE id IN (SELECT DISTINCT pack_id FROM scene_assets WHERE kind = 'cg')"
        " ORDER BY created_at, id"
    ).fetchall()


def _split(conn: sqlite3.Connection) -> dict[str, str]:
    """已经拆过的:场景包 → CG 包"""
    if not table_exists(conn, "cg_packs"):
        return {}
    return dict(
        conn.execute("SELECT source_scene_pack_id, id FROM cg_packs WHERE source_scene_pack_id IS NOT NULL").fetchall()
    )


def _done(conn: sqlite3.Connection) -> bool:
    if empty_database(conn) or not _scene_packs_with_cg(conn):
        return True
    if not all(table_exists(conn, t) for t in TABLES):
        return False
    split = _split(conn)
    return all(pid in split for pid, _ in _scene_packs_with_cg(conn))


def _unique_name(name: str, taken: set[str]) -> str:
    base = f"{name.strip() or '未命名'} · CG"
    candidate, n = base, 2
    while candidate.casefold() in taken:
        candidate, n = f"{base} ({n})", n + 1
    taken.add(candidate.casefold())
    return candidate


def _apply(conn: sqlite3.Connection) -> None:
    create_model_tables(conn, TABLES)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")
    split = _split(conn)
    taken = {r[0].casefold() for r in conn.execute("SELECT name FROM cg_packs")}
    has_bindings = table_exists(conn, "asset_bindings")
    for scene_pack, name in _scene_packs_with_cg(conn):
        if scene_pack in split:
            continue
        cg_pack = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO cg_packs (id, name, description, source_scene_pack_id, created_at, updated_at)"
            " VALUES (?, ?, '', ?, ?, ?)",
            (cg_pack, _unique_name(name or "", taken), scene_pack, now, now),
        )
        # 有指纹的不搬原件(按指纹找场景素材那一份);还没有指纹的连原件一起搬
        conn.execute(
            f"INSERT INTO cg_assets (id, pack_id, data, {COLS})"
            f" SELECT id, ?, CASE WHEN data_sha IS NULL THEN data END, {COLS}"
            " FROM scene_assets WHERE pack_id = ? AND kind = 'cg'",
            (cg_pack, scene_pack),
        )
        if not has_bindings:
            continue
        for (card,) in conn.execute(
            "SELECT DISTINCT card_id FROM asset_bindings WHERE kind = 'scene' AND target_id = ? ORDER BY card_id",
            (scene_pack,),
        ).fetchall():
            sort = conn.execute(
                "SELECT count(*) FROM asset_bindings WHERE card_id = ? AND kind = 'cg'", (card,)
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO asset_bindings (id, card_id, role_id, kind, target_id, sort, is_primary, created_at)"
                " VALUES (?, ?, '', 'cg', ?, ?, 0, ?)",
                (uuid.uuid4().hex, card, cg_pack, sort, now),
            )


def _verify(conn: sqlite3.Connection) -> bool:
    if not _done(conn):
        return False
    if not _scene_packs_with_cg(conn):
        return True
    # CG 一行不少
    moved = conn.execute("SELECT count(*) FROM cg_assets WHERE id IN (SELECT id FROM scene_assets WHERE kind = 'cg')")
    total = conn.execute("SELECT count(*) FROM scene_assets WHERE kind = 'cg'")
    return moved.fetchone()[0] == total.fetchone()[0]


STEP = Step(
    id="core.2026_10_cg_packs",
    title="CG 包:CG 从场景包里搬出来,绑给原来的卡",
    detect=_done,
    apply=_apply,
    verify=_verify,
    kind="data",
    depends=("core.2026_10_bindings",),
)
