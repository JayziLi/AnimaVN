"""One-off dev migration: per-card sprites -> sprite packs.

Design: docs/superpowers/specs/2026-09-27-sprite-packs-design.md. Back up
data/animabackend.db first.

Every card with rows in card_sprites gets a pack named after the card (a name
already taken gets " (2)", " (3)" ...), attached to that card as its current pack;
its card_sprite_layouts row becomes the pack's layout. Cards whose sprites are
identical -- same names, notes, order, on/off and image bytes, and the same layout
(a duplicated card) -- share one pack. Cards that already have a pack are skipped,
so it is safe to run twice. The old tables are left as they are: drop them once
the packs look right.
"""

import hashlib
import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine  # noqa: E402

import app.models  # noqa: E402,F401  (registers the tables on Base)
from app.db import Base  # noqa: E402

DB = "data/animabackend.db"
NEW_TABLES = ("sprite_packs", "pack_sprites", "sprite_pack_layouts", "card_sprite_packs")
SPRITE_COLS = "label, aliases, description, image, mime, sort, enabled, face_scan, created_at, updated_at"
DEFAULT_LAYOUT = (1, 1.0, 0.0, 0.0)

db = sqlite3.connect(DB)
tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
if "card_sprites" not in tables:
    print("card_sprites missing, nothing to migrate")
    sys.exit(0)

# the new tables exactly as the models define them (the backend's create_all would too)
engine = create_engine(f"sqlite:///{DB}")
Base.metadata.create_all(bind=engine, tables=[Base.metadata.tables[t] for t in NEW_TABLES])
engine.dispose()


def signature(card_id: str) -> str:
    """Everything the game shows of a card's sprites; equal signatures can share a pack."""
    rows = db.execute(
        "SELECT label, aliases, description, mime, sort, enabled, image FROM card_sprites"
        " WHERE card_id = ? ORDER BY sort, created_at, id",
        (card_id,),
    ).fetchall()
    layout = db.execute(
        "SELECT auto, zoom, dx, dy FROM card_sprite_layouts WHERE card_id = ?", (card_id,)
    ).fetchone()
    parts = [[*r[:6], hashlib.sha256(r[6] or b"").hexdigest()] for r in rows]
    parts.append(list(layout or DEFAULT_LAYOUT))
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()


def unique_name(name: str, taken: set[str]) -> str:
    base = name.strip() or "未命名"
    candidate, n = base, 2
    while candidate.casefold() in taken:
        candidate, n = f"{base} ({n})", n + 1
    taken.add(candidate.casefold())
    return candidate


now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")
done = {r[0] for r in db.execute("SELECT DISTINCT card_id FROM card_sprite_packs")}
taken = {r[0].casefold() for r in db.execute("SELECT name FROM sprite_packs")}
cards = db.execute(
    "SELECT id, name FROM tavern_cards WHERE id IN (SELECT card_id FROM card_sprites)"
    " ORDER BY created_at, id"
).fetchall()

made: dict[str, tuple[str, str]] = {}  # signature -> (pack id, pack name)
for card_id, card_name in cards:
    if card_id in done:
        print(f"{card_name}: already has a sprite pack, skipped")
        continue
    sig = signature(card_id)
    if sig in made:
        pack_id, pack_name = made[sig]
        print(f"{card_name}: same sprites as pack 「{pack_name}」, sharing it")
    else:
        pack_id, pack_name = uuid.uuid4().hex, unique_name(card_name, taken)
        db.execute(
            "INSERT INTO sprite_packs (id, name, description, created_at, updated_at)"
            " VALUES (?, ?, '', ?, ?)",
            (pack_id, pack_name, now, now),
        )
        sprite_ids = [
            r[0]
            for r in db.execute(
                "SELECT id FROM card_sprites WHERE card_id = ? ORDER BY sort, created_at, id",
                (card_id,),
            )
        ]
        for sid in sprite_ids:
            db.execute(
                f"INSERT INTO pack_sprites (id, pack_id, {SPRITE_COLS})"
                f" SELECT ?, ?, {SPRITE_COLS} FROM card_sprites WHERE id = ?",
                (uuid.uuid4().hex, pack_id, sid),
            )
        layout = db.execute(
            "SELECT auto, zoom, dx, dy FROM card_sprite_layouts WHERE card_id = ?", (card_id,)
        ).fetchone()
        if layout is not None and tuple(layout) != DEFAULT_LAYOUT:
            db.execute(
                "INSERT INTO sprite_pack_layouts (pack_id, auto, zoom, dx, dy) VALUES (?, ?, ?, ?, ?)",
                (pack_id, *layout),
            )
        made[sig] = (pack_id, pack_name)
        print(f"{card_name}: new pack 「{pack_name}」 with {len(sprite_ids)} sprites")
    db.execute(
        "INSERT INTO card_sprite_packs (card_id, pack_id, sort, is_current) VALUES (?, ?, 0, 1)",
        (card_id, pack_id),
    )
db.commit()
print(f"{len(made)} packs created; old tables card_sprites / card_sprite_layouts left in place")
