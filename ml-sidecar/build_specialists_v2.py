"""
build_specialists_v2.py — Phase 28: Multi-class Brazilian Funk + Phonk specialist pipeline.

New model architecture:
  phonk_specialist         → 2 classes: american_phonk, brazilian_phonk
  brazilian_funk_specialist → 8 classes: funk_carioca, baile_funk, funk_mandelao,
                               brega_funk, funk_automotivo, funk_150_bpm,
                               funk_ostentacao, brazilian_phonk

Usage:
  python ml-sidecar/build_specialists_v2.py
  python ml-sidecar/build_specialists_v2.py --tracks 200 --epochs 50
"""
import os
import subprocess
import sys
import argparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def run(cmd: str, check: bool = True):
    print(f"\n$ {cmd}")
    result = subprocess.run(cmd, shell=True)
    if check and result.returncode != 0:
        print(f"❌ Command failed with code {result.returncode}")
        sys.exit(result.returncode)
    return result


def scrape(target_macro: str, tracks: int):
    run(f"python ml-sidecar/auto_scrape_edm.py --tracks-per-genre {tracks} --target-macro {target_macro}")


def train(data_dir: str, model_name: str, epochs: int):
    run(f"python ml-sidecar/train_specialist_ast.py --data-dir {data_dir} --model-name {model_name} --epochs {epochs}")


def main():
    parser = argparse.ArgumentParser(description="Build Phase 28 specialist models")
    parser.add_argument("--tracks", type=int, default=200, help="Tracks per subgenre to download")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--skip-scrape", action="store_true", help="Skip download, just train on existing data")
    parser.add_argument("--only", type=str, default=None, choices=["phonk", "brazilian_funk", "both"],
                        help="Only process one specialist")
    args = parser.parse_args()

    tracks = args.tracks
    epochs = args.epochs
    do_phonk = args.only in (None, "phonk", "both")
    do_bf = args.only in (None, "brazilian_funk", "both")

    print("=" * 64)
    print("🚀 Phase 28: Multi-class Phonk + Brazilian Funk Specialists")
    print("=" * 64)
    print(f"   Tracks per subgenre : {tracks}")
    print(f"   Training epochs     : {epochs}")

    # ─── PHONK: 2-class (american_phonk / brazilian_phonk) ─────────────────
    if do_phonk:
        print("\n" + "=" * 64)
        print("🎵 STEP 1: Phonk Specialist (2 classes)")
        print("  Classes: american_phonk | brazilian_phonk")
        print("=" * 64)

        if not args.skip_scrape:
            scrape("american_phonk", tracks)
            scrape("brazilian_phonk", tracks)

        train("data/edm/phonk", "phonk_specialist", epochs)
        print("✅  phonk_specialist trained!")

    # ─── BRAZILIAN FUNK: 8-class ───────────────────────────────────────────
    if do_bf:
        print("\n" + "=" * 64)
        print("🎵 STEP 2: Brazilian Funk Specialist (8 classes)")
        print("  Classes: funk_carioca | baile_funk | funk_mandelao | brega_funk")
        print("           funk_automotivo | funk_150_bpm | funk_ostentacao | brazilian_phonk")
        print("=" * 64)

        if not args.skip_scrape:
            subgenres = [
                "funk_carioca", "baile_funk", "funk_mandelao", "brega_funk",
                "funk_automotivo", "funk_150_bpm", "funk_ostentacao", "brazilian_phonk"
            ]
            for sg in subgenres:
                scrape(sg, tracks)

        train("data/edm/brazilian_funk", "brazilian_funk_specialist", epochs)
        print("✅  brazilian_funk_specialist trained!")

    print("\n" + "=" * 64)
    print("🏆 All Phase 28 models built successfully!")
    print("   Models saved to: ml-sidecar/models/")
    print("   Labels saved as: *_labels.json")
    print("   Run export: python ml-sidecar/reexport_models.py")
    print("=" * 64)


if __name__ == "__main__":
    main()
