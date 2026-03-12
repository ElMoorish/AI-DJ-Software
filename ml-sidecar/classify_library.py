"""
classify_library.py — Batch genre classification for the AI DJ library.

Scans the SQLite library DB, finds unclassified tracks, runs genre_infer.py
on each, and writes the predictions back to the `classifications` table.

Usage:
    python ml-sidecar/classify_library.py
    python ml-sidecar/classify_library.py --db path/to/library.db
    python ml-sidecar/classify_library.py --reclassify   # re-run even if already classified
    python ml-sidecar/classify_library.py --limit 20     # only classify first N tracks
"""
import os
import sys
import json
import sqlite3
import argparse
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Default library location (matches Electron app's default)
DEFAULT_DB = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "ai-dj", "library.db")


def emit(obj: dict) -> None:
    """Emit a JSON progress line for Electron IPC."""
    print(f"PROGRESS:{json.dumps(obj)}", flush=True)


def find_db(path: str | None) -> str | None:
    """Find the library DB path."""
    candidates = [
        path,
        DEFAULT_DB,
        os.path.join(SCRIPT_DIR, "..", "data", "library.db"),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def get_unclassified_tracks(conn: sqlite3.Connection, reclassify: bool) -> list[dict]:
    """Fetch tracks that need genre classification."""
    if reclassify:
        query = """
            SELECT t.track_id, t.title, t.artist, t.file_path
            FROM tracks t
            WHERE t.is_analyzed = 1
              AND t.file_path IS NOT NULL
            ORDER BY t.created_at DESC
        """
    else:
        query = """
            SELECT t.track_id, t.title, t.artist, t.file_path
            FROM tracks t
            LEFT JOIN classifications c ON t.track_id = c.track_id
            WHERE t.is_analyzed = 1
              AND t.file_path IS NOT NULL
              AND (c.genre_primary IS NULL OR c.track_id IS NULL)
            ORDER BY t.created_at DESC
        """
    rows = conn.execute(query).fetchall()
    return [{"track_id": r[0], "title": r[1], "artist": r[2], "file_path": r[3]} for r in rows]


def write_classification(conn: sqlite3.Connection, track_id: str, result: dict) -> None:
    """Upsert genre classification result into the classifications table."""
    conn.execute("""
        INSERT INTO classifications
            (track_id, genre_primary, genre_secondary, genre_confidence, raw_scores_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(track_id) DO UPDATE SET
            genre_primary    = excluded.genre_primary,
            genre_secondary  = excluded.genre_secondary,
            genre_confidence = excluded.genre_confidence,
            raw_scores_json  = excluded.raw_scores_json
    """, (
        track_id,
        result.get("genre_primary"),
        result.get("genre_secondary"),
        result.get("confidence"),
        json.dumps(result.get("raw_scores", {})),
    ))
    conn.commit()


def classify_library(db_path: str, reclassify: bool = False, limit: int | None = None) -> None:
    # Import inline so this module is usable even without torch in dev mode
    try:
        from genre_infer import infer_genre
    except ImportError as e:
        print(f"ERROR: Could not import genre_infer: {e}", file=sys.stderr)
        print("Make sure you are running from the ai-dj directory and genre_infer.py exists.", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    tracks = get_unclassified_tracks(conn, reclassify)

    if limit:
        tracks = tracks[:limit]

    total = len(tracks)
    if total == 0:
        print("✅ All tracks are already classified! Use --reclassify to re-run.")
        print(f"DONE:{json.dumps({'classified': 0, 'total': 0})}", flush=True)
        return

    print(f"\n🎵 Classifying {total} tracks using genre_infer.py ...")
    emit({"stage": "classify", "total": total, "done": 0, "percent": 0})

    ok = 0
    failed = []
    t0 = time.time()

    for i, track in enumerate(tracks):
        path = track["file_path"]
        name = f"{track['artist']} - {track['title']}"

        if not os.path.exists(path):
            failed.append({"track_id": track["track_id"], "reason": "file_not_found"})
            continue

        try:
            result = infer_genre(path)
            if result.get("error"):
                failed.append({"track_id": track["track_id"], "reason": result["error"]})
                continue

            write_classification(conn, track["track_id"], result)
            ok += 1

            # Progress
            pct = int((i + 1) / total * 100)
            eta = (time.time() - t0) / (i + 1) * (total - i - 1)
            genre = result.get("genre_primary", "?")
            conf = result.get("confidence", 0)
            print(f"  [{i+1}/{total}] {name[:50]:<50}  →  {genre} ({conf*100:.0f}%)")
            emit({"stage": "classify", "total": total, "done": i+1, "percent": pct,
                  "track": name, "genre": genre, "eta_s": int(eta)})

        except KeyboardInterrupt:
            print("\n⛔ Classification interrupted.")
            break
        except Exception as e:
            failed.append({"track_id": track["track_id"], "reason": str(e)})

    conn.close()

    elapsed = time.time() - t0
    print(f"\n{'='*60}")
    print(f"✅  Classified {ok}/{total} tracks in {elapsed:.0f}s")
    if failed:
        print(f"⚠️  Failed:  {len(failed)} tracks")
    print(f"   DB: {db_path}")

    print(f"DONE:{json.dumps({'classified': ok, 'failed': len(failed), 'total': total})}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch genre classification for AI DJ library")
    parser.add_argument("--db", type=str, default=None, help="Path to library.db")
    parser.add_argument("--reclassify", action="store_true",
                        help="Re-classify even already-tagged tracks")
    parser.add_argument("--limit", type=int, default=None,
                        help="Only classify this many tracks (for testing)")
    args = parser.parse_args()

    db_path = find_db(args.db)
    if not db_path:
        print(f"ERROR: Could not find library.db. Tried: {DEFAULT_DB}", file=sys.stderr)
        print("Pass --db /path/to/library.db", file=sys.stderr)
        sys.exit(1)

    classify_library(db_path, reclassify=args.reclassify, limit=args.limit)
