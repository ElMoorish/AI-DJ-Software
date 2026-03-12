"""
train_all.py — Auto-discovers all music in data/ subfolders and trains
hierarchical AST genre classifiers automatically.

Usage:
    # Scan data/edm/ and train all specialists automatically
    python ml-sidecar/train_all.py

    # Point at a specific root folder  
    python ml-sidecar/train_all.py --data-root ml-sidecar/data

    # Just show what was found without training
    python ml-sidecar/train_all.py --dry-run

How it works:
    It recursively scans the data root. Any folder containing at least
    MIN_TRACKS audio files is treated as a genre class. Sibling folders
    are grouped together into a 'specialist' model (one model per parent).

    Example structure:
        data/edm/macro/house/       ← genre "house" inside specialist "macro"
        data/edm/macro/techno/      ← genre "techno" inside specialist "macro"
        data/edm/house/deep_house/  ← genre "deep_house" inside specialist "house"
        data/edm/house/tech_house/  ← genre "tech_house" inside specialist "house"

    This produces:
        models/macro_specialist.pt   (classifies: house, techno, trance, ...)
        models/house_specialist.pt   (classifies: deep_house, tech_house, ...)
"""
import os
import sys
import argparse
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
MIN_TRACKS = 8   # Minimum tracks in a folder to be considered a valid genre class
MIN_CLASSES = 2  # Minimum number of genre classes to train a specialist model


def count_audio_files(folder: str) -> int:
    """Count audio files directly inside a folder (non-recursive)."""
    try:
        return sum(
            1 for f in os.listdir(folder)
            if os.path.splitext(f)[1].lower() in AUDIO_EXTENSIONS
        )
    except Exception:
        return 0


def discover_specialists(data_root: str):
    """
    Scan data_root and group genre subfolders into specialist models.
    Returns: dict of {specialist_name: {genre_name: folder_path, ...}}
    """
    specialists = {}

    if not os.path.isdir(data_root):
        print(f"❌ Data root not found: {data_root}")
        return specialists

    # Walk two levels deep: data_root / specialist / genre_folder
    for specialist_name in sorted(os.listdir(data_root)):
        specialist_dir = os.path.join(data_root, specialist_name)
        if not os.path.isdir(specialist_dir):
            continue

        genres = {}
        for genre_name in sorted(os.listdir(specialist_dir)):
            genre_dir = os.path.join(specialist_dir, genre_name)
            if not os.path.isdir(genre_dir):
                continue

            n_tracks = count_audio_files(genre_dir)
            if n_tracks >= MIN_TRACKS:
                genres[genre_name] = {"path": genre_dir, "tracks": n_tracks}
            else:
                print(f"  ⚠️  Skipping {specialist_name}/{genre_name}: only {n_tracks} tracks (need {MIN_TRACKS}+)")

        if len(genres) >= MIN_CLASSES:
            specialists[specialist_name] = genres

    return specialists


def print_discovery_report(specialists: dict):
    """Print a formatted summary of what was found."""
    total_tracks = 0
    total_genres = 0

    print("\n" + "=" * 60)
    print("📂 AUTO-DISCOVERY REPORT")
    print("=" * 60)

    if not specialists:
        print("❌ No specialist models found! Check your data folder.")
        print(f"   Each specialist needs {MIN_CLASSES}+ genre subfolders.")
        print(f"   Each genre subfolder needs {MIN_TRACKS}+ audio files.")
        return

    for specialist, genres in specialists.items():
        n = sum(g["tracks"] for g in genres.values())
        total_tracks += n
        total_genres += len(genres)
        print(f"\n🎛️  [{specialist}] → {len(genres)} genres, {n} tracks")
        for genre, info in genres.items():
            bar = "█" * min(20, info["tracks"] // 2)
            print(f"     {genre:<25} {info['tracks']:>3} tracks  {bar}")

    print(f"\n{'─' * 60}")
    print(f"   Total: {total_genres} genres across {len(specialists)} specialist models")
    print(f"   Total: {total_tracks} audio tracks")
    print("=" * 60 + "\n")


def train_specialist(specialist_name: str, genres: dict, args):
    """Launch training for a single specialist using train_specialist_ast.py."""
    # The specialist data dir is the parent of all genre folders
    # (they all share the same parent)
    genre_dirs = list(genres.values())
    specialist_data_dir = os.path.dirname(genre_dirs[0]["path"])
    model_name = f"{specialist_name}_specialist"
    models_dir = os.path.join(SCRIPT_DIR, "models")
    os.makedirs(models_dir, exist_ok=True)

    print(f"\n{'=' * 60}")
    print(f"🚀 Training: {model_name}")
    print(f"   Data dir: {specialist_data_dir}")
    print(f"   Classes:  {', '.join(genres.keys())}")
    print(f"   Epochs:   {args.epochs} | Batch: {args.batch_size}")
    print(f"{'=' * 60}")

    cmd = [
        sys.executable,
        os.path.join(SCRIPT_DIR, "train_specialist_ast.py"),
        "--data-dir", specialist_data_dir,
        "--model-name", model_name,
        "--epochs", str(args.epochs),
        "--batch-size", str(args.batch_size),
        "--lr", str(args.lr),
    ]

    result = subprocess.run(cmd)
    if result.returncode == 0:
        print(f"✅ {model_name} trained successfully!")
    else:
        print(f"⚠️  {model_name} finished with warnings (exit code {result.returncode})")


def run(args):
    data_root = os.path.abspath(args.data_root)
    print(f"\n🔍 Scanning: {data_root}")

    specialists = discover_specialists(data_root)
    print_discovery_report(specialists)

    if not specialists:
        return

    if args.dry_run:
        print("✅ Dry run complete. No training started.")
        print("   Remove --dry-run to start training.")
        return

    if not args.yes:
        answer = input(f"Train {len(specialists)} specialist model(s)? [y/N] ").strip().lower()
        if answer != "y":
            print("Aborted.")
            return

    trained = []
    failed = []
    for specialist_name, genres in specialists.items():
        if args.specialist and specialist_name != args.specialist:
            print(f"  Skipping {specialist_name} (not selected)")
            continue
        try:
            train_specialist(specialist_name, genres, args)
            trained.append(specialist_name)
        except KeyboardInterrupt:
            print("\n⛔ Training interrupted by user.")
            break
        except Exception as e:
            print(f"❌ Error training {specialist_name}: {e}")
            failed.append(specialist_name)

    print("\n" + "=" * 60)
    print(f"🏁 Training run complete!")
    print(f"   ✅ Trained: {', '.join(trained) if trained else 'none'}")
    if failed:
        print(f"   ❌ Failed:  {', '.join(failed)}")
    print(f"   📁 Models saved to: {os.path.join(SCRIPT_DIR, 'models')}")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Auto-discover music folders and train hierarchical EDM genre classifiers."
    )
    parser.add_argument(
        "--data-root", type=str,
        default=os.path.join(SCRIPT_DIR, "data", "edm"),
        help="Root folder to scan (default: ml-sidecar/data/edm)"
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Just scan and report — do not train")
    parser.add_argument("--specialist", type=str, default=None,
                        help="Train only one specific specialist (e.g. 'house')")
    parser.add_argument("-y", "--yes", action="store_true",
                        help="Auto-confirm training without prompt")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-4)
    args = parser.parse_args()
    run(args)
