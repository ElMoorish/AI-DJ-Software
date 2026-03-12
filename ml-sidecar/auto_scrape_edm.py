"""
auto_scrape_edm.py — Builds the EDM hierarchical training dataset using SoundCloud.

Uses SoundCloud search via yt-dlp (scsearch) which is much more reliable than
YouTube — no cookies needed, no bot detection, no IP rate limiting at scale.

SMART RESUME: Counts existing MP3s per subfolder and only downloads what's missing.

Usage:
    # Top-up all Brazilian Funk subgenres to 200 tracks each:
    python ml-sidecar/auto_scrape_edm.py --target-macro brazilian_funk --tracks-per-genre 200

    # Top-up a single specific subgenre:
    python ml-sidecar/auto_scrape_edm.py --target-macro funk_ostentacao --tracks-per-genre 200

    # Scrape everything:
    python ml-sidecar/auto_scrape_edm.py --tracks-per-genre 200
"""
import os
import sys
import argparse
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Dataset structure: specialist_key → [Display Name, ...] ────────────────
# Each display name becomes a lowercase_underscore subdirectory.
# e.g. "Funk Carioca" → data/edm/brazilian_funk/funk_carioca/
STRUCTURE = {
    "macro": [
        "House", "Techno", "Trance", "Bass", "Disco", "HipHop", "Pop", "Phonk", "Brazilian Funk"
    ],
    "house": [
        "Deep House", "Tech House", "Electro House", "Slap House",
        "Minimal House", "Progressive House", "Acid House", "Afrohouse"
    ],
    "techno": [
        "Peak Time Techno", "Melodic Techno", "Minimal Techno",
        "Hard Techno", "Dub Techno", "Industrial Techno"
    ],
    "bass": [
        "Dubstep", "Drum and Bass", "Trap", "UKG"
    ],
    "trance": [
        "Uplifting Trance", "Psytrance", "Progressive Trance"
    ],
    "disco": [
        "Classic Disco", "Nu-Disco", "Italo Disco"
    ],
    # Phonk: split into American (dark trap sound) vs Brazilian (automotivo)
    "phonk": [
        "American Phonk",   # → american_phonk/ (MOONDEITY, DVRST, dark/slowed trap)
        "Brazilian Phonk",  # → brazilian_phonk/ (automotivo + phonk crossover)
    ],
    # Brazilian Funk: 8 distinct subgenres for the specialist classifier
    "brazilian_funk": [
        "Funk Carioca",     # Rio de Janeiro, 130-150 BPM, rapid-fire 808s
        "Baile Funk",       # Party/dance funk
        "Funk Mandelao",    # Melodic, bad-boy aesthetic
        "Brega Funk",       # Pernambuco origin, slower and romantic
        "Funk Automotivo",  # Heavy bass, car culture variant
        "Funk 150 BPM",     # Specific 150 BPM tempo subgenre
        "Funk Ostentacao",  # Luxury theme, Sao Paulo origin
        "Brazilian Phonk",  # Baile Funk + Phonk crossover
    ]
}

# Search query overrides for SoundCloud — improves result relevance per subgenre
SEARCH_QUERY_OVERRIDES = {
    "american_phonk":  "dark phonk trap Memphis phonk slowed",
    "brazilian_phonk": "automotivo phonk Brazilian phonk BARUDAK",
    "funk_carioca":    "Funk Carioca Rio baile",
    "baile_funk":      "baile funk Brazil",
    "funk_mandelao":   "Funk Mandelao MC",
    "brega_funk":      "Brega Funk Pernambuco",
    "funk_automotivo": "Funk Automotivo bass pesado",
    "funk_150_bpm":    "Funk 150 BPM automotivo",
    "funk_ostentacao": "Funk Ostentacao Sao Paulo MC",
}


def count_mp3s(folder: str) -> int:
    """Count MP3 files in a folder (returns 0 if folder doesn't exist)."""
    if not os.path.exists(folder):
        return 0
    return len([f for f in os.listdir(folder) if f.lower().endswith(".mp3")])


def download_genre(target_dir: str, search_query: str, max_downloads: int):
    """Download audio from SoundCloud search using yt-dlp Python API."""
    try:
        import yt_dlp
    except ImportError:
        print("  ✗ yt-dlp is not installed. Run: pip install yt-dlp")
        return

    os.makedirs(target_dir, exist_ok=True)

    ydl_opts = {
        # SoundCloud serves high-quality MP3s natively
        "format": "bestaudio/best",
        "outtmpl": os.path.join(target_dir, "%(title)s.%(ext)s"),
        "nooverwrites": True,    # Never redownload existing files
        "concurrent_fragment_downloads": 10,  # Bypass SoundCloud HLS throttle
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "noplaylist": False,
        "ignoreerrors": True,    # Skip geo-blocked or deleted tracks
        "quiet": False,
        "no_warnings": True,
        "retries": 3,
    }

    search_url = f"scsearch{max_downloads}:{search_query}"
    print(f"  🔍  Searching SoundCloud: '{search_query}' (fetching {max_downloads})...")

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([search_url])
    except Exception as e:
        print(f"  ⚠️  Error for '{search_query}': {e}")


def build_job_list():
    """Return flat list of (specialist_key, display_name, safe_dir_name) tuples.
    
    The 'macro' key is intentionally excluded — it is just a label list for the
    macro model and does not correspond to any downloadable audio category.
    """
    SKIP_KEYS = {"macro"}  # Not real specialist categories
    jobs = []
    for specialist, subgenres in STRUCTURE.items():
        if specialist in SKIP_KEYS:
            continue
        for genre in subgenres:
            safe = genre.lower().replace(" ", "_").replace("&", "and")
            jobs.append((specialist, genre, safe))
    return jobs


def run_automation(tracks_per_genre: int, target_filter: str = None):
    """
    Download training data for all / specific genres.

    target_filter matches EITHER:
      - An outer specialist key  (e.g. "brazilian_funk" → all 8 subgenres)
      - A subgenre safe-name     (e.g. "funk_ostentacao" → just that one folder)
      - None / "all"             → process everything
    """
    all_jobs = build_job_list()

    # ── Filter ──────────────────────────────────────────────────────────────
    if target_filter and target_filter.lower() not in ("all", ""):
        flt = target_filter.lower().strip()
        filtered = [
            (sp, g, safe) for sp, g, safe in all_jobs
            if sp.lower() == flt or safe == flt
        ]
        if not filtered:
            valid_specialists = list(STRUCTURE.keys())
            valid_subs = [s for _, _, s in all_jobs]
            print(f"\n⚠️  No match found for --target-macro '{target_filter}'")
            print(f"   Specialist keys:  {valid_specialists}")
            print(f"   Subgenre names:   {valid_subs}")
            return
        jobs = filtered
    else:
        jobs = all_jobs

    # ── Pre-run status table ─────────────────────────────────────────────────
    print("=" * 70)
    print("🤖  AI DJ — EDM Dataset Builder (SoundCloud)  [Smart Resume]")
    if target_filter:
        print(f"    Filter : {target_filter}")
    print(f"    Target : {tracks_per_genre} MP3s per subgenre")
    print("=" * 70)

    needs_work = []
    for sp, genre, safe in jobs:
        folder = os.path.join(SCRIPT_DIR, "data", "edm", sp, safe)
        have = count_mp3s(folder)
        need = max(0, tracks_per_genre - have)
        pct  = min(100, int(have / tracks_per_genre * 100))
        bar  = "█" * (pct // 5) + "░" * (20 - pct // 5)
        flag = "✅" if need == 0 else ("⚠️ " if have < 30 else "🔄")
        rel  = f"{sp}/{safe}"
        print(f"  {flag} {rel:<44} {have:4d}/{tracks_per_genre}  [{bar}]  +{need}")
        if need > 0:
            needs_work.append((sp, genre, safe, folder, have, need))

    if not needs_work:
        print("\n✅  All subgenres already at target — nothing to download!")
        return

    total_needed = sum(n for *_, n in needs_work)
    print(f"\n  📥  {len(needs_work)} subgenre(s) need top-up  "
          f"({total_needed} total tracks to fetch)\n")
    time.sleep(1)

    # ── Download only what each folder is missing ────────────────────────────
    for i, (sp, genre, safe, folder, have, need) in enumerate(needs_work, 1):
        print(f"\n[{i}/{len(needs_work)}] 🎧  {genre}")
        print(f"   Have: {have}  |  Need: +{need}  |  "
              f"Folder: data/edm/{sp}/{safe}/")

        query = SEARCH_QUERY_OVERRIDES.get(safe, genre)
        # Fetch a bit more than needed to cover failures/geo-blocks
        fetch = min(need + 40, tracks_per_genre * 2)
        download_genre(folder, query, fetch)

        after  = count_mp3s(folder)
        gained = after - have
        still  = max(0, tracks_per_genre - after)
        status = "✅ complete" if after >= tracks_per_genre else f"🔄 still need {still} more"
        print(f"   Result: {after} MP3s (+{gained} new)  {status}")
        time.sleep(1)

    # ── Final totals ──────────────────────────────────────────────────────────
    total_mp3s = sum(
        len([f for f in files if f.lower().endswith(".mp3")])
        for _, _, files in os.walk(os.path.join(SCRIPT_DIR, "data", "edm"))
    )
    # Re-check completion for filtered jobs
    done  = sum(1 for sp, _, safe, *_ in needs_work
                if count_mp3s(os.path.join(SCRIPT_DIR, "data", "edm", sp, safe)) >= tracks_per_genre)
    total = len(needs_work)
    print("\n" + "=" * 70)
    print(f"✅  Done!  {total_mp3s:,} total MP3s in dataset  |  "
          f"{done}/{total} subgenres now at target")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "AI DJ — EDM dataset builder with SoundCloud + yt-dlp.\n\n"
            "SMART RESUME: Only downloads what each folder is missing.\n"
            "  --target-macro can be a specialist key OR a subgenre name:\n"
            "  e.g. 'brazilian_funk' (all 8 subs) or 'funk_ostentacao' (one sub)\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--tracks-per-genre", type=int, default=200,
        help="Target MP3 count per subgenre folder (default: 200)"
    )
    parser.add_argument(
        "--target-macro", type=str, default=None,
        help=(
            "Specialist key (e.g. 'brazilian_funk') OR subgenre name "
            "(e.g. 'funk_ostentacao'). Omit to process everything."
        )
    )
    args = parser.parse_args()
    run_automation(args.tracks_per_genre, args.target_macro)
