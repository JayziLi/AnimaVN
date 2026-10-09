"""One-off dev migration: pack_sprites.effect (switch effect: motion / bubble / sound).

NULL for every existing row — no effect, the sprite just fades in like before.
Safe to run twice.
"""

import sqlite3

db = sqlite3.connect("data/animabackend.db")

cols = {r[1] for r in db.execute("PRAGMA table_info(pack_sprites)")}
if not cols:
    print("pack_sprites missing, skipped (create_all will build it)")
elif "effect" in cols:
    print("pack_sprites.effect already present")
else:
    db.execute("ALTER TABLE pack_sprites ADD COLUMN effect JSON")
    print("added pack_sprites.effect")
db.commit()
