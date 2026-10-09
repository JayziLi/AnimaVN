"""One-off dev migration: voice_emotions.aux_refs (GSV auxiliary reference paths; [] = none).

Empty list for every existing row. Safe to run twice.
"""

import sqlite3
import sys

db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else "data/animabackend.db")

cols = {r[1] for r in db.execute("PRAGMA table_info(voice_emotions)")}
if not cols:
    print("voice_emotions missing, skipped (create_all will build it)")
elif "aux_refs" in cols:
    print("voice_emotions.aux_refs already present")
else:
    db.execute("ALTER TABLE voice_emotions ADD COLUMN aux_refs JSON NOT NULL DEFAULT '[]'")
    print("added voice_emotions.aux_refs")
db.commit()
