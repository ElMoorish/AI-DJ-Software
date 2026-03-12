"""Quick diagnostic: check AST features from a GTZAN file."""
import os, sys
os.environ["TORCHCODEC_DISABLE"] = "1"  # prevent torchcodec from loading

import torch
import torchaudio
import numpy as np

# Load model
from transformers import ASTFeatureExtractor, ASTModel, ASTForAudioClassification

fe = ASTFeatureExtractor.from_pretrained("MIT/ast-finetuned-audioset-10-10-0.4593")

# Load a real GTZAN audio file
genres_dir = os.path.join(os.path.dirname(__file__), "data", "genres")
audio_file = None
genre_name = None
for g in sorted(os.listdir(genres_dir)):
    gd = os.path.join(genres_dir, g)
    if os.path.isdir(gd):
        for f in sorted(os.listdir(gd)):
            if f.endswith(('.au', '.wav', '.mp3')):
                audio_file = os.path.join(gd, f)
                genre_name = g
                break
        if audio_file:
            break

print(f"File: {audio_file}")
print(f"Genre: {genre_name}")

waveform, sr = torchaudio.load(audio_file)
print(f"Waveform: {waveform.shape}, sr={sr}")

# Resample to 16kHz mono
if sr != 16000:
    waveform = torchaudio.transforms.Resample(sr, 16000)(waveform)
waveform = waveform.mean(0)[:160000]  # 10s mono
print(f"Processed: {waveform.shape}, range=[{waveform.min():.4f}, {waveform.max():.4f}]")

# Feature extraction
inputs = fe(waveform.numpy(), sampling_rate=16000, return_tensors="pt")
iv = inputs["input_values"]
print(f"\nFeature extractor output key: 'input_values'")
print(f"Shape: {iv.shape}")
print(f"Range: [{iv.min():.4f}, {iv.max():.4f}]")
print(f"Mean: {iv.mean():.4f}, Std: {iv.std():.4f}")

# Test with the FULL pre-trained AST (with AudioSet head) to see if IT works
print("\n--- Testing full pre-trained AST (AudioSet 527 classes) ---")
full_model = ASTForAudioClassification.from_pretrained("MIT/ast-finetuned-audioset-10-10-0.4593")
full_model.eval()
with torch.no_grad():
    out = full_model(input_values=iv)
    logits = out.logits  # (1, 527)
    probs = torch.softmax(logits, dim=-1)
    top5 = torch.topk(probs, 5)
    print(f"Logits shape: {logits.shape}")
    print(f"Top 5 AudioSet predictions:")
    for i, (prob, idx) in enumerate(zip(top5.values[0], top5.indices[0])):
        label = full_model.config.id2label.get(idx.item(), f"class_{idx.item()}")
        print(f"  {i+1}. {label}: {prob.item():.4f}")

# Test with our ASTModel (base, no head)
print("\n--- Testing ASTModel (base, no classification head) ---")
base_model = ASTModel.from_pretrained("MIT/ast-finetuned-audioset-10-10-0.4593")
base_model.eval()
with torch.no_grad():
    out = base_model(input_values=iv)
    cls = out.last_hidden_state[:, 0, :]
    print(f"CLS shape: {cls.shape}")
    print(f"CLS range: [{cls.min():.4f}, {cls.max():.4f}]")
    print(f"CLS mean: {cls.mean():.4f}, std: {cls.std():.4f}")
    # Check if embeddings are varied (not collapsed)
    all_tokens = out.last_hidden_state[0]  # (seq_len, 768)
    diffs = torch.cdist(all_tokens[:5], all_tokens[5:10]).mean()
    print(f"Token diversity (avg pairwise dist): {diffs:.4f}")

print("\nDiagnostic complete!")
