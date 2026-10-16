"""清理期(素材架构设计 8.3 末两行、P6b):删掉老表 card_sprites、card_sprite_layouts。

09 月立绘从「挂在卡上」改成立绘包(core.2026_09_sprite_packs)以后,这两张表就没人读了,
里面的图和立绘包里的一模一样(10-09 查过:164 行、109.6 MB,100% 重复)。删之前再按内容核对一遍:
老表里的每一张图立绘包里都有;有一张没有就原样留着(只是清理,不为它挡住升级)。
compat = breaking:09 月以前的代码还读这两张表;拆状态那一步(第 4 期)已经挡住了更老的代码,所以不多挡什么。
删完不会自动缩小文件,要缩跑一次 python -m app.storage slim --yes(它最后会整理)。
"""

import hashlib
import sqlite3

from app.migrations.base import Step
from app.migrations.sqlite_util import columns, table_exists

TABLES = ("card_sprites", "card_sprite_layouts")


def _done(conn: sqlite3.Connection) -> bool:
    return not any(table_exists(conn, t) for t in TABLES)


def _migrated(conn: sqlite3.Connection) -> bool:
    """老表里的每一张图,立绘包里都有一模一样的一张(按内容指纹比;瘦身以后包里只剩指纹)。
    不按「每张卡都挂着包」比:有的卡后来被玩家自己拿掉了包,图还在包里"""
    if "image" not in columns(conn, "card_sprites"):
        return True
    have: set[str] = set()
    if table_exists(conn, "pack_sprites"):
        cols = columns(conn, "pack_sprites")
        if "image_sha" in cols:
            have |= {r[0] for r in conn.execute("SELECT image_sha FROM pack_sprites WHERE image_sha IS NOT NULL")}
        for (image,) in conn.execute("SELECT image FROM pack_sprites WHERE image IS NOT NULL"):
            have.add(hashlib.sha256(image).hexdigest())
    for (image,) in conn.execute("SELECT image FROM card_sprites WHERE image IS NOT NULL"):
        if hashlib.sha256(image).hexdigest() not in have:
            return False
    return True


def _apply(conn: sqlite3.Connection) -> None:
    # 有的图立绘包里没有(比如那个包被删了,老表里还留着一份):这一步只是清理,不值得为它挡住升级,原样留着
    if not _migrated(conn):
        return
    for table in TABLES:
        conn.execute(f'DROP TABLE IF EXISTS "{table}"')


def _verify(conn: sqlite3.Connection) -> bool:
    return _done(conn) or not _migrated(conn)


STEP = Step(
    id="core.2026_10_drop_card_sprites",
    title="清理:删掉立绘包以前的老表(card_sprites)",
    detect=_done,
    apply=_apply,
    verify=_verify,
    kind="schema",
    compat="breaking",
    depends=("core.2026_09_sprite_packs",),
)
