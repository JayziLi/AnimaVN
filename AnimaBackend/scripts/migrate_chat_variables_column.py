"""One-off dev migration: macro variables on debug_chats.

{{setvar}} and friends write chat-local variables; SillyTavern keeps them in the
chat file's chat_metadata.variables, we keep them in a JSON column. New databases
get the column from create_all; this only patches databases that already have the
table. Safe to run twice.
"""

import sqlite3

db = sqlite3.connect("data/animabackend.db")
cols = {r[1] for r in db.execute("PRAGMA table_info(debug_chats)")}
if not cols:
    print("debug_chats missing, skipped (create_all will build it)")
elif "variables" not in cols:
    db.execute("ALTER TABLE debug_chats ADD COLUMN variables JSON NOT NULL DEFAULT '{}'")
    print("added variables")
else:
    print("variables already present")

db.commit()
print([r[1] for r in db.execute("PRAGMA table_info(debug_chats)")])
