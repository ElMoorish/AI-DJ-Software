"""
train_specialist_ast.py — Dynamic AST fine-tuning for hierarchical genre classification.
Automatically infers genre classes based on subdirectories in the provided data-dir.

Usage:
  # Train Macro Model
  python ml-sidecar/train_specialist_ast.py --data-dir data/edm/macro --model-name macro_edm
  
  # Train House Specialist
  python ml-sidecar/train_specialist_ast.py --data-dir data/edm/house --model-name house_specialist
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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")

SAMPLE_RATE = 16000
CLIP_SECONDS = 10
AST_MODEL_ID = "MIT/ast-finetuned-audioset-10-10-0.4593"

# ─────────────────── DATASET ───────────────────
class SpecialistDataset(Dataset):
    def __init__(self, data_dir: str, feature_extractor, genres: list,
                 clip_seconds: int = 10, augment: bool = False):
        self.data_dir = data_dir
        self.feature_extractor = feature_extractor
        self.clip_seconds = clip_seconds
        self.augment = augment
        self.target_sr = SAMPLE_RATE
        self.target_samples = self.target_sr * self.clip_seconds
        self.samples = []
        self.genres = genres

        for genre_idx, genre in enumerate(self.genres):
            genre_dir = os.path.join(data_dir, genre)
            if not os.path.isdir(genre_dir): continue
            
            for fname in sorted(os.listdir(genre_dir)):
                if fname.startswith('._') or fname.startswith('.') or fname.endswith('.txt'):
                    continue
                if fname.endswith(('.wav', '.au', '.mp3', '.flac', '.m4a')):
                    self.samples.append((os.path.join(genre_dir, fname), genre_idx))

        print(f"  Found {len(self.samples)} tracks across {len(self.genres)} subgenres: {', '.join(self.genres)}")

    def __len__(self):
        return len(self.samples)

    def _load_audio(self, filepath: str) -> torch.Tensor:
        try:
            import torchaudio
            waveform, sr = torchaudio.load(filepath)
            
            # Convert to mono if it's stereo
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)
            waveform = waveform.squeeze(0)
            
            # Resample using torchaudio if needed
            if sr != self.target_sr:
                resampler = torchaudio.transforms.Resample(sr, self.target_sr)
                waveform = resampler(waveform)

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
            
        except Exception as e:
            return torch.zeros(self.target_samples)

    def __getitem__(self, idx):
        filepath, genre_idx = self.samples[idx]
        waveform = self._load_audio(filepath)
        inputs = self.feature_extractor(
            waveform.numpy(), sampling_rate=self.target_sr, return_tensors="pt"
        )
        return inputs["input_values"].squeeze(0), genre_idx

# ─────────────────── MIXUP ───────────────────
import numpy as np
def mixup_data(x, y, alpha=0.4):
    if alpha > 0: lam = np.random.beta(alpha, alpha)
    else: lam = 1.0
    batch_size = x.size(0)
    index = torch.randperm(batch_size, device=x.device)
    return lam * x + (1 - lam) * x[index], y, y[index], lam

def mixup_criterion(criterion, pred, y_a, y_b, lam):
    return lam * criterion(pred, y_a) + (1 - lam) * criterion(pred, y_b)

# ─────────────────── MODEL ───────────────────
class ASTSpecialistClassifier(nn.Module):
    def __init__(self, num_classes: int, freeze_layers: int = 2):
        super().__init__()
        from transformers import ASTModel
        self.ast = ASTModel.from_pretrained(AST_MODEL_ID)
        hidden_size = self.ast.config.hidden_size

        # Only freeze the very first N transformer blocks + patch embeddings.
        # For acoustically-similar subgenres (e.g. Brazilian Funk), we need
        # most of the backbone to be trainable to learn fine-grained differences.
        for i, layer in enumerate(self.ast.encoder.layer):
            if i < freeze_layers:
                for param in layer.parameters(): param.requires_grad = False
        for param in self.ast.embeddings.parameters(): param.requires_grad = False

        self.classifier = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Dropout(0.3),
            nn.Linear(hidden_size, 512),
            nn.GELU(),
            nn.Dropout(0.25),
            nn.Linear(512, 128),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(128, num_classes)
        )

    def forward(self, input_values: torch.Tensor) -> torch.Tensor:
        outputs = self.ast(input_values=input_values)
        return self.classifier(outputs.last_hidden_state[:, 0, :])

# ─────────────────── TRAINING ───────────────────
def train(args):
    print("=" * 60)
    print(f"AI DJ — Specialist Classifier Training: {args.model_name}")
    print("=" * 60)

    # 1. Discover Genres
    abs_data_dir = os.path.abspath(os.path.join(SCRIPT_DIR, args.data_dir))
    if not os.path.exists(abs_data_dir):
        print(f"Error: Directory {abs_data_dir} does not exist.")
        sys.exit(1)
        
    genres = [d for d in sorted(os.listdir(abs_data_dir)) 
              if os.path.isdir(os.path.join(abs_data_dir, d))]
              
    if not genres:
        print(f"Error: No subdirectories found in {abs_data_dir}.")
        sys.exit(1)
        
    num_genres = len(genres)
    print(f"  Target Classes ({num_genres}): {', '.join(genres)}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"  Device: {device}")

    if device == "cuda":
        # ── Cap VRAM usage to 50% so other GPU processes (app, sidecar) keep running ──
        vram_fraction = 0.50
        torch.cuda.set_per_process_memory_fraction(vram_fraction)
        total_vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
        print(f"  GPU: {torch.cuda.get_device_name(0)}")
        print(f"  VRAM cap: {vram_fraction*100:.0f}% of {total_vram:.1f}GB = {vram_fraction*total_vram:.1f}GB")
        # TF32 reduces memory bandwidth for matmuls on Ampere/Ada (RTX 30/40 series)
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.cuda.empty_cache()

    from transformers import ASTFeatureExtractor
    feature_extractor = ASTFeatureExtractor.from_pretrained(AST_MODEL_ID)

    full_dataset = SpecialistDataset(abs_data_dir, feature_extractor, genres)
    if len(full_dataset) < 10:
        print("  ✗ Too few audio files found. Add more MP3/WAV files to the folders!")
        sys.exit(1)

    # ── Per-class sample count diagnostic ─────────────────────────────────
    counts = [0] * len(genres)
    for _, label_idx in full_dataset.samples:
        counts[label_idx] += 1
    print("  Per-class counts:")
    for g, c in zip(genres, counts):
        bar = '█' * (c // 5)
        status = '⚠️  TOO SPARSE' if c < 30 else ''
        print(f"    {g:<28} {c:4d}  {bar} {status}")
    min_count = min(counts) if counts else 1
    if min_count < 20:
        print(f"  ⚠️  WARNING: {min_count} tracks in smallest class. Results will be poor.")
        print("     Run the scraper to get at least 50 tracks per class.")

    n_total = len(full_dataset)
    n_train = int(0.70 * n_total)
    n_val = int(0.15 * n_total)
    n_test = n_total - n_train - n_val

    train_set, val_set, test_set = random_split(
        full_dataset, [n_train, n_val, n_test],
        generator=torch.Generator().manual_seed(42)
    )

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False)
    test_loader = DataLoader(test_set, batch_size=args.batch_size, shuffle=False)

    model = ASTSpecialistClassifier(num_genres, freeze_layers=args.freeze_layers).to(device)

    # ── Gradient checkpointing: recompute activations on backward to save ~60% VRAM ──
    if device == "cuda" and hasattr(model.ast.encoder, 'gradient_checkpointing_enable'):
        model.ast.encoder.gradient_checkpointing_enable()
        print("  Gradient checkpointing: enabled (saves ~60% activation VRAM)")
    elif device == "cuda":
        # Manual enable for older transformers versions
        model.ast.config.use_cache = False

    backbone_params = [p for n, p in model.named_parameters() if p.requires_grad and "classifier" not in n]
    head_params = [p for n, p in model.named_parameters() if p.requires_grad and "classifier" in n]
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"  Trainable params: {trainable:,} / {total:,} ({100*trainable/total:.1f}%)")

    optimizer = torch.optim.AdamW([
        {"params": backbone_params, "lr": args.lr},
        {"params": head_params,     "lr": args.lr * 10},
    ], weight_decay=0.01)

    # Linear warmup for warmup_epochs, then cosine annealing to eta_min
    def lr_lambda(epoch):
        if epoch < args.warmup_epochs:
            return float(epoch + 1) / float(max(1, args.warmup_epochs))
        progress = float(epoch - args.warmup_epochs) / float(max(1, args.epochs - args.warmup_epochs))
        return max(0.0, 0.5 * (1.0 + math.cos(math.pi * progress)))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # Class-weighted loss to handle imbalanced subgenre counts
    class_weights = torch.tensor(
        [1.0 / max(c, 1) for c in counts], dtype=torch.float32
    ).to(device)
    class_weights = class_weights / class_weights.sum() * len(counts)
    criterion = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=0.05)

    ckpt_path = os.path.join(MODELS_DIR, f"{args.model_name}_checkpoint.pt")
    best_val_acc = 0.0

    print(f"[4/5] Training ({args.epochs} epochs)...")
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss, train_correct, train_total = 0.0, 0, 0
        for inputs, labels in train_loader:
            inputs, labels = inputs.to(device), labels.to(device)
            if args.mixup_alpha > 0 and epoch > 1:
                inputs, labels_a, labels_b, lam = mixup_data(inputs, labels, args.mixup_alpha)
                optimizer.zero_grad()
                logits = model(inputs)
                loss = mixup_criterion(criterion, logits, labels_a, labels_b, lam)
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

        model.eval()
        val_correct, val_total = 0, 0
        with torch.no_grad():
            for inputs, labels in val_loader:
                inputs, labels = inputs.to(device), labels.to(device)
                logits = model(inputs)
                val_correct += (logits.argmax(1) == labels).sum().item()
                val_total += labels.size(0)

        val_acc = val_correct / max(1, val_total) * 100
        print(f"  Epoch {epoch:2d}/{args.epochs} | Train: {train_correct/max(1,train_total)*100:5.1f}% | Val: {val_acc:5.1f}%")
        
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({"model_state_dict": model.state_dict(), "genres": genres}, ckpt_path)

    # Export ONNX
    print(f"\n[5/5] Exporting {args.model_name} to ONNX...")
    model.load_state_dict(torch.load(ckpt_path, map_location=device, weights_only=False)["model_state_dict"])
    model.eval()

    dummy_audio = np.random.randn(SAMPLE_RATE * CLIP_SECONDS).astype(np.float32)
    inputs = feature_extractor(dummy_audio, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    dummy_input = inputs["input_values"].to(device)

    out_onnx = os.path.join(MODELS_DIR, f"{args.model_name}_int8.onnx")
    torch.onnx.export(model, dummy_input, out_onnx,
                      input_names=["mel_spectrogram"], output_names=["logits"],
                      dynamic_axes={"mel_spectrogram": {0: "batch_size"}, "logits": {0: "batch_size"}},
                      opset_version=15)

    with open(os.path.join(MODELS_DIR, f"{args.model_name}_labels.json"), "w") as f:
        json.dump(genres, f)

    print(f"✅ Exported: {out_onnx} with labels {genres}")

if __name__ == "__main__":
    import math
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir",     type=str,   required=True)
    parser.add_argument("--model-name",   type=str,   required=True)
    parser.add_argument("--epochs",       type=int,   default=60)
    parser.add_argument("--batch-size",   type=int,   default=8)
    parser.add_argument("--lr",           type=float, default=3e-5,
                        help="Backbone LR. Head LR = lr*10. Lower is better for near-full finetune.")
    parser.add_argument("--freeze-layers",type=int,   default=2,
                        help="Freeze first N transformer blocks (0=full finetune, 2=recommended)")
    parser.add_argument("--mixup-alpha",  type=float, default=0.3)
    parser.add_argument("--warmup-epochs",type=int,   default=3,
                        help="Linear LR warmup epochs before cosine decay starts")
    args = parser.parse_args()
    train(args)
