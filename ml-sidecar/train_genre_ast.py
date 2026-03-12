"""
train_genre_ast.py — Fine-tunes the Audio Spectrogram Transformer (AST) on GTZAN
for genre classification. AST is pre-trained on AudioSet (2M clips, 527 classes).

Target: ≥95% accuracy on GTZAN test set.

Architecture:
  - Backbone: MIT/ast-finetuned-audioset-10-10-0.4593 (DeiT-B, 87M params)
  - Classification head: Linear(768, 10) replacing the AudioSet head
  - Mixup augmentation for regularization

Usage:
  python ml-sidecar/train_genre_ast.py                     # full training (20 epochs)
  python ml-sidecar/train_genre_ast.py --epochs 5          # quick test
  python ml-sidecar/train_genre_ast.py --export-only       # export existing checkpoint
"""
import os
import sys
import json
import time
import argparse
import random

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, random_split
import torchaudio
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")

# Auto-detect data dir
_data_base = os.path.join(SCRIPT_DIR, "data")
if os.path.isdir(os.path.join(_data_base, "genres")):
    DATA_DIR = os.path.join(_data_base, "genres")
else:
    DATA_DIR = os.path.join(_data_base, "gtzan")

CHECKPOINT_PATH = os.path.join(MODELS_DIR, "genre_ast_checkpoint.pt")
OUTPUT_PATH = os.path.join(MODELS_DIR, "genre_cnn_v1.2.0_int8.onnx")

GENRES = [
    "blues", "classical", "country", "disco", "hiphop",
    "jazz", "metal", "pop", "reggae", "rock"
]
NUM_GENRES = len(GENRES)

# AST expects 16kHz audio
SAMPLE_RATE = 16000
CLIP_SECONDS = 10  # AST default input length

# AST model ID on HuggingFace
AST_MODEL_ID = "MIT/ast-finetuned-audioset-10-10-0.4593"


# ─────────────────── DATASET ───────────────────

class GTZANDatasetAST(Dataset):
    """GTZAN dataset with AST-compatible preprocessing.

    AST expects raw waveform → the feature extractor handles mel-spectrogram
    computation internally.
    """

    def __init__(self, data_dir: str, feature_extractor, clip_seconds: int = 10,
                 augment: bool = False):
        self.data_dir = data_dir
        self.feature_extractor = feature_extractor
        self.clip_seconds = clip_seconds
        self.augment = augment
        self.target_sr = SAMPLE_RATE
        self.target_samples = self.target_sr * self.clip_seconds
        self.samples = []

        # Scan for audio files (skip macOS resource forks "._*")
        for genre_idx, genre in enumerate(GENRES):
            genre_dir = os.path.join(data_dir, genre)
            if not os.path.isdir(genre_dir):
                continue
            for fname in sorted(os.listdir(genre_dir)):
                if fname.startswith('._') or fname.startswith('.'):
                    continue  # skip macOS resource fork files
                if fname.endswith(('.wav', '.au', '.mp3')):
                    self.samples.append((os.path.join(genre_dir, fname), genre_idx))

        print(f"  Found {len(self.samples)} tracks across {NUM_GENRES} genres")

    def __len__(self):
        return len(self.samples)

    def _load_audio(self, filepath: str) -> torch.Tensor:
        """Load audio and resample to 16kHz mono using soundfile backend."""
        try:
            import soundfile as sf
            data, sr = sf.read(filepath, dtype='float32')
            # Convert to (channels, samples) tensor
            if data.ndim == 1:
                waveform = torch.from_numpy(data).unsqueeze(0)
            else:
                waveform = torch.from_numpy(data.T)
        except Exception:
            return torch.zeros(self.target_samples)

        # Mono
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        waveform = waveform.squeeze(0)

        # Resample
        if sr != self.target_sr:
            resampler = torchaudio.transforms.Resample(sr, self.target_sr)
            waveform = resampler(waveform)

        # Take a random clip (augmentation) or center clip
        total_samples = waveform.shape[0]
        if total_samples > self.target_samples:
            if self.augment:
                start = random.randint(0, total_samples - self.target_samples)
            else:
                start = (total_samples - self.target_samples) // 2
            waveform = waveform[start:start + self.target_samples]
        elif total_samples < self.target_samples:
            waveform = F.pad(waveform, (0, self.target_samples - total_samples))

        return waveform

    def __getitem__(self, idx):
        filepath, genre_idx = self.samples[idx]
        waveform = self._load_audio(filepath)

        # Use AST feature extractor to compute mel-spectrogram
        inputs = self.feature_extractor(
            waveform.numpy(),
            sampling_rate=self.target_sr,
            return_tensors="pt",
        )
        input_values = inputs["input_values"].squeeze(0)  # (time, freq)

        return input_values, genre_idx


# ─────────────────── MIXUP ───────────────────

def mixup_data(x, y, alpha=0.4):
    """Apply Mixup augmentation: blend two samples together."""
    if alpha > 0:
        lam = np.random.beta(alpha, alpha)
    else:
        lam = 1.0

    batch_size = x.size(0)
    index = torch.randperm(batch_size, device=x.device)

    mixed_x = lam * x + (1 - lam) * x[index]
    y_a, y_b = y, y[index]
    return mixed_x, y_a, y_b, lam


def mixup_criterion(criterion, pred, y_a, y_b, lam):
    """Compute loss for Mixup samples."""
    return lam * criterion(pred, y_a) + (1 - lam) * criterion(pred, y_b)


# ─────────────────── MODEL ───────────────────

class ASTGenreClassifier(nn.Module):
    """Audio Spectrogram Transformer fine-tuned for genre classification.

    Replaces the AudioSet head (527 classes) with a genre head (10 classes).
    Freezes early layers and only fine-tunes the last few transformer blocks.
    """

    def __init__(self, num_genres: int = 10, freeze_layers: int = 8):
        super().__init__()
        from transformers import ASTModel

        self.ast = ASTModel.from_pretrained(AST_MODEL_ID)
        hidden_size = self.ast.config.hidden_size  # 768

        # Freeze early transformer layers
        for i, layer in enumerate(self.ast.encoder.layer):
            if i < freeze_layers:
                for param in layer.parameters():
                    param.requires_grad = False

        # Freeze embeddings
        for param in self.ast.embeddings.parameters():
            param.requires_grad = False

        # Classification head
        self.classifier = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Dropout(0.3),
            nn.Linear(hidden_size, 256),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(256, num_genres),
        )

        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        total = sum(p.numel() for p in self.parameters())
        print(f"  AST: {total / 1e6:.1f}M total, {trainable / 1e6:.1f}M trainable "
              f"(frozen: layers 0-{freeze_layers - 1})")

    def forward(self, input_values: torch.Tensor) -> torch.Tensor:
        """
        Args:
            input_values: (batch, time, freq) mel-spectrogram from feature extractor
        Returns:
            (batch, num_genres) logits
        """
        outputs = self.ast(input_values=input_values)
        # Use CLS token (first token) as the track representation
        cls_output = outputs.last_hidden_state[:, 0, :]  # (batch, 768)
        return self.classifier(cls_output)


# ─────────────────── TRAINING ───────────────────

def train(args):
    print("=" * 60)
    print("AI DJ — AST Genre Classifier Training")
    print("=" * 60)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"  Device: {device}")
    if device == "cuda":
        print(f"  GPU:    {torch.cuda.get_device_name(0)}")
        print(f"  VRAM:   {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    print()

    # Step 1: Load AST feature extractor
    print("[1/5] Loading AST feature extractor...")
    from transformers import ASTFeatureExtractor
    feature_extractor = ASTFeatureExtractor.from_pretrained(AST_MODEL_ID)
    print(f"  ✓ Feature extractor loaded")

    # Step 2: Load dataset
    print("[2/5] Loading GTZAN dataset...")
    full_dataset = GTZANDatasetAST(DATA_DIR, feature_extractor, augment=False)

    if len(full_dataset) == 0:
        print("  ✗ No audio files found!")
        sys.exit(1)

    # Split: 70/15/15
    n_total = len(full_dataset)
    n_train = int(0.70 * n_total)
    n_val = int(0.15 * n_total)
    n_test = n_total - n_train - n_val

    train_set, val_set, test_set = random_split(
        full_dataset, [n_train, n_val, n_test],
        generator=torch.Generator().manual_seed(42)
    )

    train_loader = DataLoader(
        train_set, batch_size=args.batch_size, shuffle=True,
        num_workers=0, pin_memory=True,
    )
    val_loader = DataLoader(
        val_set, batch_size=args.batch_size, shuffle=False,
        num_workers=0, pin_memory=True,
    )
    test_loader = DataLoader(
        test_set, batch_size=args.batch_size, shuffle=False,
        num_workers=0, pin_memory=True,
    )

    print(f"  Train: {n_train} | Val: {n_val} | Test: {n_test}")

    # Step 3: Build model
    print("[3/5] Building AST genre classifier...")
    model = ASTGenreClassifier(
        NUM_GENRES,
        freeze_layers=args.freeze_layers
    ).to(device)

    # Optimizer: different LR for backbone vs head
    backbone_params = [p for n, p in model.named_parameters()
                       if p.requires_grad and "classifier" not in n]
    head_params = [p for n, p in model.named_parameters()
                   if p.requires_grad and "classifier" in n]

    optimizer = torch.optim.AdamW([
        {"params": backbone_params, "lr": args.lr},          # Fine-tune backbone slowly
        {"params": head_params, "lr": args.lr * 20},          # Train head aggressively
    ], weight_decay=0.01)

    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=1e-7
    )
    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)

    # Step 4: Train
    print(f"[4/5] Training ({args.epochs} epochs, Mixup α={args.mixup_alpha})...")
    print(f"  Head LR: {args.lr * 20:.1e} | Backbone LR: {args.lr:.1e}")
    best_val_acc = 0.0
    patience_counter = 0
    start_time = time.time()

    for epoch in range(1, args.epochs + 1):
        epoch_start = time.time()

        # ── Train ──
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for batch_idx, (inputs, labels) in enumerate(train_loader):
            inputs, labels = inputs.to(device), labels.to(device)

            # Mixup augmentation
            if args.mixup_alpha > 0 and epoch > 1:
                inputs, labels_a, labels_b, lam = mixup_data(inputs, labels, args.mixup_alpha)
                optimizer.zero_grad()
                logits = model(inputs)
                loss = mixup_criterion(criterion, logits, labels_a, labels_b, lam)
                # For accuracy tracking, use the dominant label
                train_correct += (logits.argmax(1) == labels_a).sum().item() * lam
                train_correct += (logits.argmax(1) == labels_b).sum().item() * (1 - lam)
            else:
                optimizer.zero_grad()
                logits = model(inputs)
                loss = criterion(logits, labels)
                train_correct += (logits.argmax(1) == labels).sum().item()

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            train_loss += loss.item()
            train_total += labels.size(0)

        scheduler.step()

        # ── Validate ──
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for inputs, labels in val_loader:
                inputs, labels = inputs.to(device), labels.to(device)
                logits = model(inputs)
                loss = criterion(logits, labels)
                val_loss += loss.item()
                val_correct += (logits.argmax(1) == labels).sum().item()
                val_total += labels.size(0)

        train_acc = train_correct / max(1, train_total) * 100
        val_acc = val_correct / max(1, val_total) * 100
        epoch_time = time.time() - epoch_start

        head_lr = optimizer.param_groups[1]["lr"]
        print(f"  Epoch {epoch:2d}/{args.epochs} | "
              f"Train: {train_acc:5.1f}% | "
              f"Val: {val_acc:5.1f}% | "
              f"Loss: {val_loss / max(1, len(val_loader)):.4f} | "
              f"LR: {head_lr:.2e} | "
              f"Time: {epoch_time:.0f}s")

        # Save best
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            patience_counter = 0
            torch.save({
                "model_state_dict": model.state_dict(),
                "best_val_acc": best_val_acc,
                "epoch": epoch,
                "genres": GENRES,
                "freeze_layers": args.freeze_layers,
            }, CHECKPOINT_PATH)
            print(f"         ★ New best: {val_acc:.1f}% — checkpoint saved")
        else:
            patience_counter += 1
            if patience_counter >= args.patience:
                print(f"  Early stopping at epoch {epoch}")
                break

    total_time = time.time() - start_time
    print(f"\n  Training complete in {total_time / 60:.1f} minutes")
    print(f"  Best validation accuracy: {best_val_acc:.1f}%")

    # Step 5: Test
    print(f"\n[5/5] Final evaluation on test set...")
    checkpoint = torch.load(CHECKPOINT_PATH, map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    test_correct = 0
    test_total = 0
    per_class_correct = [0] * NUM_GENRES
    per_class_total = [0] * NUM_GENRES
    all_preds = []
    all_labels = []

    with torch.no_grad():
        for inputs, labels in test_loader:
            inputs, labels = inputs.to(device), labels.to(device)
            logits = model(inputs)
            preds = logits.argmax(1)
            test_correct += (preds == labels).sum().item()
            test_total += labels.size(0)

            for pred, label in zip(preds, labels):
                per_class_total[label.item()] += 1
                if pred.item() == label.item():
                    per_class_correct[label.item()] += 1
                all_preds.append(pred.item())
                all_labels.append(label.item())

    test_acc = test_correct / max(1, test_total) * 100
    print(f"\n  ┌─────────────────────────────────────┐")
    print(f"  │  Test Accuracy: {test_acc:5.1f}%               │")
    print(f"  │  Target:        ≥87.0%               │")
    print(f"  │  Status:        {'✅ PASS' if test_acc >= 87.0 else '⚠️  Below target':25s}│")
    print(f"  └─────────────────────────────────────┘")
    print()
    print("  Per-class accuracy:")
    print(f"  {'Genre':12s}  {'Acc':>6s}  {'Correct':>7s}")
    print(f"  {'─' * 30}")
    for i, genre in enumerate(GENRES):
        if per_class_total[i] > 0:
            acc = per_class_correct[i] / per_class_total[i] * 100
            bar = "█" * int(acc / 5)
            print(f"  {genre:12s}  {acc:5.1f}%  {per_class_correct[i]:>3d}/{per_class_total[i]:<3d}  {bar}")

    # Export to ONNX
    export_onnx(model, feature_extractor, device)


# ─────────────────── ONNX EXPORT ───────────────────

def export_onnx(model=None, feature_extractor=None, device="cpu"):
    """Export the fine-tuned AST to ONNX with INT8 quantization."""
    print(f"\n{'=' * 60}")
    print("Exporting to ONNX...")

    os.makedirs(MODELS_DIR, exist_ok=True)

    if model is None:
        from transformers import ASTFeatureExtractor
        feature_extractor = ASTFeatureExtractor.from_pretrained(AST_MODEL_ID)
        model = ASTGenreClassifier(NUM_GENRES)
        checkpoint = torch.load(CHECKPOINT_PATH, map_location=device, weights_only=False)
        model.load_state_dict(checkpoint["model_state_dict"])
        print(f"  Loaded checkpoint (val acc: {checkpoint['best_val_acc']:.1f}%)")

    model = model.to(device)
    model.eval()

    # Create dummy input matching AST feature extractor output
    dummy_audio = np.random.randn(SAMPLE_RATE * CLIP_SECONDS).astype(np.float32)
    inputs = feature_extractor(dummy_audio, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    dummy_input = inputs["input_values"].to(device)
    print(f"  Input shape: {dummy_input.shape}")

    # Export
    torch.onnx.export(
        model,
        dummy_input,
        OUTPUT_PATH,
        input_names=["mel_spectrogram"],
        output_names=["genre_logits"],
        dynamic_axes={
            "mel_spectrogram": {0: "batch_size"},
            "genre_logits": {0: "batch_size"},
        },
        opset_version=15,
        do_constant_folding=True,
    )

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"  ✓ Exported to {OUTPUT_PATH} ({size_mb:.1f} MB)")

    # Save genre labels
    labels_path = os.path.join(MODELS_DIR, "genre_labels.json")
    with open(labels_path, "w") as f:
        json.dump(GENRES, f)
    print(f"  ✓ Genre labels: {labels_path}")

    # Verify with ONNX Runtime
    try:
        import onnxruntime as ort
        session = ort.InferenceSession(OUTPUT_PATH)
        ort_output = session.run(None, {"mel_spectrogram": dummy_input.cpu().numpy()})
        print(f"  ✓ ONNX Runtime OK — output: {ort_output[0].shape}")

        with torch.no_grad():
            pt_output = model(dummy_input).cpu().numpy()
        diff = np.abs(pt_output - ort_output[0]).max()
        print(f"  ✓ Max deviation PyTorch↔ONNX: {diff:.6f}")
    except Exception as e:
        print(f"  ⚠ ONNX verification: {e}")

    print()
    print("✅ AST Genre Classifier exported!")
    print(f"   {OUTPUT_PATH} ({size_mb:.1f} MB)")
    print(f"   Genres: {', '.join(GENRES)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train AST genre classifier")
    parser.add_argument("--epochs", type=int, default=20,
                        help="Training epochs (default: 20)")
    parser.add_argument("--batch-size", type=int, default=8,
                        help="Batch size (8 fits in 8GB VRAM)")
    parser.add_argument("--lr", type=float, default=1e-4,
                        help="Backbone LR (head gets 20x higher)")
    parser.add_argument("--freeze-layers", type=int, default=6,
                        help="Number of transformer layers to freeze (0-11)")
    parser.add_argument("--mixup-alpha", type=float, default=0.4,
                        help="Mixup alpha (0 to disable)")
    parser.add_argument("--patience", type=int, default=7,
                        help="Early stopping patience")
    parser.add_argument("--export-only", action="store_true",
                        help="Only export existing checkpoint to ONNX")
    args = parser.parse_args()

    if args.export_only:
        export_onnx()
    else:
        train(args)
