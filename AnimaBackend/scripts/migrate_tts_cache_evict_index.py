"""One-off dev migration: covering index for the TTS cache bookkeeping.

Every cache miss sums tts_cache.size and, over the limit, lists rows by last_used_at.
Both columns sit after the audio BLOB, so a table scan walks every clip's overflow
pages: 0.7-1.3 s per new line once the cache reaches 500 MB (measured 2026-09-30).
The index (last_used_at, size, key) answers both from the index alone, and replaces
the old single-column one. A fresh database gets it from create_all; this only
patches databases that already have the table. Safe to run twice.
"""

import sqlite3

db = sqlite3.connect("data/animabackend.db")

if not list(db.execute("PRAGMA table_info(tts_cache)")):
    print("tts_cache missing, skipped (create_all will build it)")
else:
    indexes = {r[1] for r in db.execute("PRAGMA index_list(tts_cache)")}
    if "ix_tts_cache_evict" in indexes:
        print("ix_tts_cache_evict already present")
    else:
        db.execute("CREATE INDEX ix_tts_cache_evict ON tts_cache (last_used_at, size, key)")
        print("created ix_tts_cache_evict")
    if "ix_tts_cache_last_used_at" in indexes:
        db.execute("DROP INDEX ix_tts_cache_last_used_at")
        print("dropped ix_tts_cache_last_used_at")
db.commit()
