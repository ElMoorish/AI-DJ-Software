"""
train_genre.py — Trains the Dual-Path CNN genre classifier on the GTZAN dataset
and exports the trained model to ONNX format.

Architecture from MlModels.md:
  Input: Mel-spectrogram (1, 128, 1292) — 1 channel, 128 mel bins, 1292 frames
  Path A (Temporal): Conv2d → BN → ReLU → Conv2d → BN → ReLU → MaxPool
  Path B (Spectral): Conv2d → BN → ReLU → Conv2d → BN → ReLU → MaxPool
  Merge: Concat → Conv2d → BN → ReLU → GlobalAvgPool → FC → Dropout → FC → Softmax

Dataset: GTZAN (1000 tracks, 10 genres, 30s each)
Target: ≥ 87% accuracy

Usage:
  python ml-sidecar/train_genre.py                    # full training
  python ml-sidecar/train_genre.py --epochs 5         # quick test
  python ml-sidecar/train_genre.py --export-only      # just export existing checkpoint
"""
import os
import sys
import json
import time
import argparse
import hashlib
import shutil
import tarfile
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, random_split
import torchaudio
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")

# Auto-detect data dir: could be "gtzan" or "genres" depending on extraction
_data_base = os.path.join(SCRIPT_DIR, "data")
if os.path.isdir(os.path.join(_data_base, "genres")):
    DATA_DIR = os.path.join(_data_base, "genres")
else:
    DATA_DIR = os.path.join(_data_base, "gtzan")

CHECKPOINT_PATH = os.path.join(MODELS_DIR, "genre_cnn_checkpoint.pt")
OUTPUT_PATH = os.path.join(MODELS_DIR, "genre_cnn_v1.2.0_int8.onnx")

GENRES = [
    "blues", "classical", "country", "disco", "hiphop",
    "jazz", "metal", "pop", "reggae", "rock"
]
NUM_GENRES = len(GENRES)

# Audio preprocessing params (from MlModels.md)
SAMPLE_RATE = 22050
N_FFT = 2048
HOP_LENGTH = 512
N_MELS = 128
CLIP_DURATION = 30  # seconds
EXPECTED_FRAMES = 1292  # ceil(30 * 22050 / 512)


# ─────────────────── MODEL ARCHITECTURE ───────────────────

class DualPathCNN(nn.Module):
    """Dual-Path CNN for genre classification from MlModels.md spec."""

    def __init__(self, num_genres: int = 10):
        super().__init__()

        # Path A — Temporal (wide horizontal kernels)
        self.path_a = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=(1, 8), padding=(0, 3)),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, 64, kernel_size=(1, 4), padding=(0, 1)),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d((1, 4)),
        )

        # Path B — Spectral (tall vertical kernels)
        self.path_b = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=(8, 1), padding=(3, 0)),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, 64, kernel_size=(4, 1), padding=(1, 0)),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d((4, 1)),
        )

        # Merge
        self.merge = nn.Sequential(
            nn.Conv2d(128, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
        )

        # Classifier head
        self.classifier = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.4),
            nn.Linear(64, num_genres),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (batch, 1, n_mels, time_frames) mel-spectrogram
        Returns:
            (batch, num_genres) logits
        """
        # Path A works on full resolution, then pools time
        a = self.path_a(x)       # (B, 64, 128, T/4)
        # Path B pools frequency
        b = self.path_b(x)       # (B, 64, 128/4, T)

        # Make dimensions match for concatenation via adaptive pooling
        target_h = min(a.shape[2], b.shape[2])
        target_w = min(a.shape[3], b.shape[3])
        a = F.adaptive_avg_pool2d(a, (target_h, target_w))
        b = F.adaptive_avg_pool2d(b, (target_h, target_w))

        # Concatenate along channel dimension
        merged = torch.cat([a, b], dim=1)  # (B, 128, H, W)
        merged = self.merge(merged)

        # Global average pooling
        pooled = F.adaptive_avg_pool2d(merged, (1, 1)).flatten(1)  # (B, 128)

        return self.classifier(pooled)


# ─────────────────── DATASET ───────────────────

class GTZANDataset(Dataset):
    """GTZAN dataset — loads audio files and computes mel-spectrograms on the fly."""

    def __init__(self, data_dir: str, augment: bool = False):
        self.data_dir = data_dir
        self.augment = augment
        self.samples = []  # (filepath, genre_index)

        self.mel_transform = torchaudio.transforms.MelSpectrogram(
            sample_rate=SAMPLE_RATE,
            n_fft=N_FFT,
            hop_length=HOP_LENGTH,
            n_mels=N_MELS,
            f_max=8000,
        )

        # Scan for audio files
        for genre_idx, genre in enumerate(GENRES):
            genre_dir = os.path.join(data_dir, genre)
            if not os.path.isdir(genre_dir):
                continue
            for fname in sorted(os.listdir(genre_dir)):
                if fname.endswith(('.wav', '.au', '.mp3')):
                    self.samples.append((os.path.join(genre_dir, fname), genre_idx))

        print(f"  Found {len(self.samples)} tracks across {NUM_GENRES} genres")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        filepath, genre_idx = self.samples[idx]
        try:
            waveform, sr = torchaudio.load(filepath)
        except Exception:
            # Return a zero spectrogram for corrupt files
            return torch.zeros(1, N_MELS, EXPECTED_FRAMES), genre_idx

        # Convert to mono
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        # Resample if needed
        if sr != SAMPLE_RATE:
            resampler = torchaudio.transforms.Resample(sr, SAMPLE_RATE)
            waveform = resampler(waveform)

        # Compute mel-spectrogram
        mel = self.mel_transform(waveform)  # (1, n_mels, time)

        # Log-scale
        mel = torch.log1p(mel)

        # Normalize per-sample
        mel = (mel - mel.mean()) / (mel.std() + 1e-8)

        # Pad or trim to expected length
        if mel.shape[2] < EXPECTED_FRAMES:
            pad = EXPECTED_FRAMES - mel.shape[2]
            mel = F.pad(mel, (0, pad))
        elif mel.shape[2] > EXPECTED_FRAMES:
            mel = mel[:, :, :EXPECTED_FRAMES]

        # Data augmentation
        if self.augment:
            # Time masking (SpecAugment)
            if torch.rand(1).item() > 0.5:
                t = torch.randint(0, max(1, mel.shape[2] - 100), (1,)).item()
                w = torch.randint(10, 50, (1,)).item()
                mel[:, :, t:t+w] = 0

            # Frequency masking
            if torch.rand(1).item() > 0.5:
                f = torch.randint(0, max(1, N_MELS - 30), (1,)).item()
                w = torch.randint(5, 20, (1,)).item()
                mel[:, f:f+w, :] = 0

        return mel, genre_idx


# ─────────────────── DATASET DOWNLOAD ───────────────────

def download_gtzan():
    """Download and extract the GTZAN dataset."""
    if os.path.isdir(DATA_DIR) and len(os.listdir(DATA_DIR)) >= 10:
        print("  ✓ GTZAN dataset already exists")
        return

    print("  Downloading GTZAN dataset (~1.3 GB)...")
    os.makedirs(DATA_DIR, exist_ok=True)

    # Use torchaudio's built-in GTZAN download
    try:
        dataset = torchaudio.datasets.GTZAN(
            root=os.path.join(SCRIPT_DIR, "data"),
            download=True,
        )
        print(f"  ✓ GTZAN downloaded ({len(dataset)} tracks)")

        # Check if torchaudio organized it correctly
        gtzan_path = os.path.join(SCRIPT_DIR, "data", "gtzan")
        if not os.path.isdir(gtzan_path):
            # Try alternative paths torchaudio might use
            for candidate in [
                os.path.join(SCRIPT_DIR, "data", "GTZAN", "genres"),
                os.path.join(SCRIPT_DIR, "data", "genres"),
            ]:
                if os.path.isdir(candidate):
                    shutil.copytree(candidate, gtzan_path, dirs_exist_ok=True)
                    break
        return

    except Exception as e:
        print(f"  torchaudio GTZAN download failed: {e}")
        print("  Falling back to manual download...")

    # Manual fallback — download from a mirror
    import requests
    url = "https://huggingface.co/datasets/marsyas/gtzan/resolve/main/data/genres.tar.gz"
    tar_path = os.path.join(SCRIPT_DIR, "data", "genres.tar.gz")

    resp = requests.get(url, stream=True, timeout=60)
    total = int(resp.headers.get("content-length", 0))
    downloaded = 0
    with open(tar_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
            downloaded += len(chunk)
            if total > 0:
                pct = int(downloaded / total * 100)
                print(f"\r  Downloading... {pct}%", end="", flush=True)
    print()

    # Extract
    print("  Extracting...")
    with tarfile.open(tar_path, "r:gz") as tar:
        tar.extractall(os.path.join(SCRIPT_DIR, "data"))
    os.remove(tar_path)

    # Rename if needed
    genres_dir = os.path.join(SCRIPT_DIR, "data", "genres")
    if os.path.isdir(genres_dir) and not os.path.isdir(DATA_DIR):
        os.rename(genres_dir, DATA_DIR)

    print("  ✓ GTZAN dataset ready")


# ─────────────────── TRAINING ───────────────────

def train(args):
    print("=" * 60)
    print("AI DJ — Genre CNN Training Pipeline")
    print("=" * 60)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"  Device: {device}")
    if device == "cuda":
        print(f"  GPU:    {torch.cuda.get_device_name(0)}")
        print(f"  VRAM:   {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    print()

    # Step 1: Download dataset
    print("[1/5] Preparing GTZAN dataset...")
    download_gtzan()

    # Step 2: Create datasets
    print("[2/5] Loading and preprocessing audio...")
    full_dataset = GTZANDataset(DATA_DIR, augment=False)

    if len(full_dataset) == 0:
        print("  ✗ No audio files found! Check data directory.")
        sys.exit(1)

    # Split: 70% train, 15% val, 15% test
    n_total = len(full_dataset)
    n_train = int(0.70 * n_total)
    n_val = int(0.15 * n_total)
    n_test = n_total - n_train - n_val

    train_set, val_set, test_set = random_split(
        full_dataset, [n_train, n_val, n_test],
        generator=torch.Generator().manual_seed(42)
    )

    # Re-create train set with augmentation
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True,
                              num_workers=0, pin_memory=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False,
                            num_workers=0, pin_memory=True)
    test_loader = DataLoader(test_set, batch_size=args.batch_size, shuffle=False,
                             num_workers=0, pin_memory=True)

    print(f"  Train: {n_train} | Val: {n_val} | Test: {n_test}")

    # Step 3: Train
    print(f"[3/5] Training Dual-Path CNN ({args.epochs} epochs)...")
    model = DualPathCNN(NUM_GENRES).to(device)
    print(f"  Parameters: {sum(p.numel() for p in model.parameters()):,}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)

    best_val_acc = 0.0
    patience_counter = 0
    history = []

    for epoch in range(1, args.epochs + 1):
        # Train
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for batch_idx, (mel, labels) in enumerate(train_loader):
            mel, labels = mel.to(device), labels.to(device)

            optimizer.zero_grad()
            logits = model(mel)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()

            train_loss += loss.item()
            train_correct += (logits.argmax(1) == labels).sum().item()
            train_total += labels.size(0)

        scheduler.step()

        # Validate
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for mel, labels in val_loader:
                mel, labels = mel.to(device), labels.to(device)
                logits = model(mel)
                loss = criterion(logits, labels)
                val_loss += loss.item()
                val_correct += (logits.argmax(1) == labels).sum().item()
                val_total += labels.size(0)

        train_acc = train_correct / max(1, train_total) * 100
        val_acc = val_correct / max(1, val_total) * 100

        epoch_info = {
            "epoch": epoch,
            "train_loss": train_loss / max(1, len(train_loader)),
            "train_acc": train_acc,
            "val_loss": val_loss / max(1, len(val_loader)),
            "val_acc": val_acc,
            "lr": scheduler.get_last_lr()[0],
        }
        history.append(epoch_info)

        print(f"  Epoch {epoch:3d}/{args.epochs} | "
              f"Train: {train_acc:5.1f}% (loss: {epoch_info['train_loss']:.4f}) | "
              f"Val: {val_acc:5.1f}% (loss: {epoch_info['val_loss']:.4f}) | "
              f"LR: {epoch_info['lr']:.6f}")

        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            patience_counter = 0
            torch.save({
                "model_state_dict": model.state_dict(),
                "best_val_acc": best_val_acc,
                "epoch": epoch,
                "genres": GENRES,
                "history": history,
            }, CHECKPOINT_PATH)
            print(f"         ★ New best: {val_acc:.1f}% — saved checkpoint")
        else:
            patience_counter += 1
            if patience_counter >= args.patience:
                print(f"  Early stopping at epoch {epoch} (patience={args.patience})")
                break

    # Step 4: Test
    print(f"\n[4/5] Evaluating on test set...")
    checkpoint = torch.load(CHECKPOINT_PATH, map_location=device, weights_only=True)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    test_correct = 0
    test_total = 0
    per_class_correct = [0] * NUM_GENRES
    per_class_total = [0] * NUM_GENRES

    with torch.no_grad():
        for mel, labels in test_loader:
            mel, labels = mel.to(device), labels.to(device)
            logits = model(mel)
            preds = logits.argmax(1)
            test_correct += (preds == labels).sum().item()
            test_total += labels.size(0)

            for pred, label in zip(preds, labels):
                per_class_total[label.item()] += 1
                if pred.item() == label.item():
                    per_class_correct[label.item()] += 1

    test_acc = test_correct / max(1, test_total) * 100
    print(f"  Test Accuracy: {test_acc:.1f}%")
    print(f"  Target:        ≥87.0%")
    print(f"  Status:        {'✅ PASS' if test_acc >= 87.0 else '⚠️  Below target'}")
    print()
    print("  Per-class accuracy:")
    for i, genre in enumerate(GENRES):
        if per_class_total[i] > 0:
            acc = per_class_correct[i] / per_class_total[i] * 100
            print(f"    {genre:12s}  {acc:5.1f}%  ({per_class_correct[i]}/{per_class_total[i]})")

    # Step 5: Export to ONNX
    export_onnx(model, device)


def export_onnx(model=None, device="cpu"):
    """Export the trained model to ONNX."""
    print(f"\n[5/5] Exporting to ONNX...")
    os.makedirs(MODELS_DIR, exist_ok=True)

    if model is None:
        model = DualPathCNN(NUM_GENRES)
        checkpoint = torch.load(CHECKPOINT_PATH, map_location=device, weights_only=True)
        model.load_state_dict(checkpoint["model_state_dict"])
        print(f"  Loaded checkpoint (val acc: {checkpoint['best_val_acc']:.1f}%)")

    model = model.to(device)
    model.eval()

    # Dummy input: (batch=1, channels=1, n_mels=128, time_frames=1292)
    dummy_input = torch.randn(1, 1, N_MELS, EXPECTED_FRAMES).to(device)

    torch.onnx.export(
        model,
        dummy_input,
        OUTPUT_PATH,
        input_names=["mel_spectrogram"],
        output_names=["genre_logits"],
        dynamic_axes={
            "mel_spectrogram": {0: "batch_size", 3: "time_frames"},
            "genre_logits": {0: "batch_size"},
        },
        opset_version=15,
        do_constant_folding=True,
    )

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"  ✓ Exported to {OUTPUT_PATH} ({size_mb:.1f} MB)")

    # Save genre labels alongside
    labels_path = os.path.join(MODELS_DIR, "genre_labels.json")
    with open(labels_path, "w") as f:
        json.dump(GENRES, f)
    print(f"  ✓ Genre labels saved to {labels_path}")

    # Verify with ONNX Runtime
    try:
        import onnxruntime as ort
        session = ort.InferenceSession(OUTPUT_PATH)
        ort_output = session.run(None, {"mel_spectrogram": dummy_input.cpu().numpy()})
        print(f"  ✓ ONNX Runtime verification OK — output shape: {ort_output[0].shape}")
    except ImportError:
        print("  ⚠ onnxruntime not installed — skipping verification")

    print()
    print("✅ Genre CNN exported successfully!")
    print(f"   {OUTPUT_PATH} ({size_mb:.1f} MB)")
    print(f"   Genres: {', '.join(GENRES)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Genre CNN on GTZAN")
    parser.add_argument("--epochs", type=int, default=50, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-4, help="Learning rate")
    parser.add_argument("--patience", type=int, default=10, help="Early stopping patience")
    parser.add_argument("--export-only", action="store_true", help="Just export existing checkpoint")
    args = parser.parse_args()

    if args.export_only:
        export_onnx()
    else:
        train(args)
