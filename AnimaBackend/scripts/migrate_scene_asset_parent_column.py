"""One-off dev migration: scene_assets.parent_id (CG variants point at their CG).

NULL for every existing row — backgrounds, music and CG set-ups have no parent.
Safe to run twice.
"""

import sqlite3

db = sqlite3.connect("data/animabackend.db")

cols = {r[1] for r in db.execute("PRAGMA table_info(scene_assets)")}
if not cols:
    print("scene_assets missing, skipped (create_all will build it)")
elif "parent_id" in cols:
    print("scene_assets.parent_id already present")
else:
    db.execute("ALTER TABLE scene_assets ADD COLUMN parent_id VARCHAR(32)")
    db.execute("CREATE INDEX IF NOT EXISTS ix_scene_assets_parent_id ON scene_assets (parent_id)")
    print("added scene_assets.parent_id")
db.commit()
