import os
import subprocess
import sys

def main():
    tracks_per_genre = 200
    epochs = 50

    print("=" * 60)
    print("🚀 STEP 1: Ensuring Phonk Dataset is complete (200 tracks)")
    print("=" * 60)
    subprocess.run(f"python ml-sidecar/auto_scrape_edm.py --tracks-per-genre {tracks_per_genre} --target-macro phonk", shell=True, check=True)

    print("\n" + "=" * 60)
    print("🚀 STEP 2: [PARALLEL] Training Phonk Specialist AND Downloading Brazilian Funk")
    print("=" * 60)
    
    # Launch both processes simultaneously
    train_phonk_cmd = f"python ml-sidecar/train_specialist_ast.py --data-dir data/edm/phonk --model-name phonk_specialist --epochs {epochs}"
    scrape_bf_cmd = f"python ml-sidecar/auto_scrape_edm.py --tracks-per-genre {tracks_per_genre} --target-macro brazilian_funk"
    
    train_phonk_proc = subprocess.Popen(train_phonk_cmd, shell=True)
    scrape_bf_proc = subprocess.Popen(scrape_bf_cmd, shell=True)

    # Wait for both background processes to finish before moving on
    train_phonk_proc.wait()
    scrape_bf_proc.wait()

    if train_phonk_proc.returncode != 0 or scrape_bf_proc.returncode != 0:
        print("❌ Error occurred during parallel execution!")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("🚀 STEP 3: Training Brazilian Funk Specialist")
    print("=" * 60)
    subprocess.run(f"python ml-sidecar/train_specialist_ast.py --data-dir data/edm/brazilian_funk --model-name brazilian_funk_specialist --epochs {epochs}", shell=True, check=True)

    print("\n✅ All parallel downloads and model training completed successfully!")
    print(f"Your Phonk and Brazilian Funk specialists are now compiled with {epochs} epochs!")

if __name__ == "__main__":
    main()
