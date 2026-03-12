"""
genre_infer.py — Hierarchical genre inference using trained AST specialist models.

Inference priority (fastest → most accurate):
  1. ONNX (onnxruntime)  — preferred, no PyTorch needed, ~10x faster
  2. PyTorch .pt          — fallback when ONNX not available

Two-stage classification:
  Stage 1: macro_specialist → house / techno / trance / bass / disco / hiphop / pop
  Stage 2: house_specialist  → tech_house / deep_house / electro_house / etc.

Usage:
    python ml-sidecar/genre_infer.py --file path/to/track.mp3
    python ml-sidecar/genre_infer.py --file path/to/track.mp3 --json
    python ml-sidecar/genre_infer.py --list-models
"""
import os
import sys
import json
import argparse
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
SAMPLE_RATE = 16000
CLIP_SECONDS = 10

# Maps macro genre → (onnx filename, pt filename)
# Routing logic:
#   hiphop  → phonk_specialist (outputs: american_phonk, brazilian_phonk)
#   pop     → brazilian_funk_specialist (outputs: 8 subgenres)
#   bass    → bass_specialist (outputs: trap, dubstep, drum_and_bass, ukg)
#   All others route to their matching specialist.
SPECIALIST_MAP = {
    "house":          ("house_specialist_int8.onnx",          "house_specialist.pt"),
    "techno":         ("techno_specialist_int8.onnx",         "techno_specialist.pt"),
    "trance":         ("trance_specialist_int8.onnx",         "trance_specialist.pt"),
    "bass":           ("bass_specialist_int8.onnx",           "bass_specialist.pt"),
    "disco":          ("disco_specialist_int8.onnx",          "disco_specialist.pt"),
    # hiphop macro → phonk specialist (2-class: american_phonk / brazilian_phonk)
    "hiphop":         ("phonk_specialist_int8.onnx",          "phonk_specialist.pt"),
    # pop macro → brazilian_funk specialist (8-class: all subgenres inc. brazilian_phonk)
    "pop":            ("brazilian_funk_specialist_int8.onnx", "brazilian_funk_specialist.pt"),
}

# Macro model names (onnx preferred, pt fallback)
MACRO_ONNX = "macro_specialist_int8.onnx"
MACRO_PT   = "macro_specialist.pt"
MACRO_LABELS = ["bass", "disco", "hiphop", "house", "pop", "techno", "trance"]

GENRE_COLORS = {
    # Standard genres
    "house":           "#3b82f6",
    "techno":          "#6b7280",
    "trance":          "#8b5cf6",
    "bass":            "#ef4444",
    "disco":           "#f59e0b",
    "hiphop":          "#10b981",
    "pop":             "#ec4899",
    # Phonk subgenres
    "phonk":           "#dc2626",
    "american_phonk":  "#991b1b",
    "brazilian_phonk": "#f97316",
    # Brazilian Funk subgenres
    "brazilian_funk":  "#f97316",
    "funk_carioca":    "#fb923c",
    "baile_funk":      "#fbbf24",
    "funk_mandelao":   "#a3e635",
    "brega_funk":      "#34d399",
    "funk_automotivo": "#22d3ee",
    "funk_150_bpm":    "#818cf8",
    "funk_ostentacao": "#e879f9",
    # Bass subgenres
    "trap":            "#7c3aed",
    "dubstep":         "#dc2626",
    "drum_and_bass":   "#059669",
    "ukg":             "#0284c7",
}


# ─────────────────── MODEL RESOLUTION ───────────────────

def resolve_model(onnx_name: str | None, pt_name: str | None) -> tuple[str | None, str]:
    """
    Return (model_path, backend) where backend is 'onnx' or 'pt'.
    Prefers ONNX if available and onnxruntime is installed.
    Falls back to .pt with PyTorch.
    """
    if onnx_name:
        onnx_path = os.path.join(MODELS_DIR, onnx_name)
        if os.path.exists(onnx_path):
            try:
                import onnxruntime  # noqa: F401
                return onnx_path, "onnx"
            except ImportError:
                pass  # onnxruntime not installed, try pt

    if pt_name:
        pt_path = os.path.join(MODELS_DIR, pt_name)
        if os.path.exists(pt_path):
            return pt_path, "pt"

    return None, "none"


# ─────────────────── AUDIO LOADING ───────────────────

def load_audio(filepath: str) -> np.ndarray:
    """Load mid-section audio clip as float32 waveform at SAMPLE_RATE Hz."""
    try:
        import librosa
    except ImportError:
        print("ERROR: librosa not installed. Run: pip install librosa", file=sys.stderr)
        sys.exit(1)

    y, _ = librosa.load(filepath, sr=SAMPLE_RATE, mono=True, duration=CLIP_SECONDS * 3)
    start = len(y) // 4
    end = start + (SAMPLE_RATE * CLIP_SECONDS)
    y = y[start:end]
    if len(y) < SAMPLE_RATE * CLIP_SECONDS:
        y = np.pad(y, (0, SAMPLE_RATE * CLIP_SECONDS - len(y)))
    return y.astype(np.float32)


def extract_features(audio: np.ndarray) -> np.ndarray:
    """Extract AST input features (log-mel spectrogram) shared between ONNX and PT."""
    from transformers import AutoFeatureExtractor
    fe = AutoFeatureExtractor.from_pretrained("MIT/ast-finetuned-audioset-10-10-0.4593")
    inputs = fe(audio, sampling_rate=SAMPLE_RATE, return_tensors="np", padding=True)
    return inputs["input_values"].astype(np.float32)  # shape: (1, time, 128)


# ─────────────────── ONNX INFERENCE ───────────────────

def run_onnx(model_path: str, features: np.ndarray, labels: list[str]) -> dict:
    """Run ONNX inference. ~10x faster than PyTorch, no GPU needed."""
    import onnxruntime as ort

    # Use CUDA if available, otherwise CPU
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    session = ort.InferenceSession(model_path, providers=providers)

    input_name = session.get_inputs()[0].name
    logits = session.run(None, {input_name: features})[0]  # shape: (1, num_classes)
    logits = logits.squeeze()

    # Softmax
    e = np.exp(logits - logits.max())
    probs = e / e.sum()

    if not labels:
        import json
        base_name = os.path.basename(model_path).replace("_int8.onnx", "").replace(".onnx", "")
        json_path = os.path.join(os.path.dirname(model_path), f"{base_name}_labels.json")
        if os.path.exists(json_path):
            with open(json_path, "r") as f:
                labels = json.load(f)
        else:
            labels = [f"Class_{i}" for i in range(len(probs))]

    best_idx = int(np.argmax(probs))
    score_dict = {labels[i]: float(probs[i]) for i in range(len(labels))}

    return {
        "label":      labels[best_idx],
        "confidence": float(probs[best_idx]),
        "scores":     score_dict,
        "backend":    "onnx",
    }


# ─────────────────── PYTORCH INFERENCE (fallback) ───────────────────

def run_pt(model_path: str, features: np.ndarray, labels: list[str]) -> dict:
    """Run PyTorch inference. Used when ONNX is not available."""
    try:
        import torch
        from train_specialist_ast import ASTSpecialistClassifier
    except ImportError as e:
        return {"error": str(e), "label": "unknown", "confidence": 0.0, "scores": {}}

    device = "cuda" if torch.cuda.is_available() else "cpu"
    checkpoint = torch.load(model_path, map_location=device)
    state = checkpoint.get("model_state_dict", checkpoint)
    num_classes = checkpoint.get("num_classes", len(labels))
    saved_labels = checkpoint.get("labels", checkpoint.get("genres", labels))

    if not saved_labels:
        import json
        base_name = os.path.basename(model_path).replace(".pt", "").replace(".onnx", "").replace("_checkpoint", "").replace("_int8", "")
        json_path = os.path.join(os.path.dirname(model_path), f"{base_name}_labels.json")
        if os.path.exists(json_path):
            with open(json_path, 'r') as f:
                saved_labels = json.load(f)
        else:
            saved_labels = [f"Class_{i}" for i in range(num_classes or 1)]

    model = ASTSpecialistClassifier(num_classes=num_classes)
    model.load_state_dict(state)
    model.eval()
    model.to(device)

    tensor = torch.tensor(features).to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=-1).squeeze().cpu().numpy()

    best_idx = int(np.argmax(probs))
    score_dict = {saved_labels[i]: float(probs[i]) for i in range(len(saved_labels))}

    return {
        "label":      saved_labels[best_idx],
        "confidence": float(probs[best_idx]),
        "scores":     score_dict,
        "backend":    "pt",
    }


# ─────────────────── UNIFIED INFERENCE ───────────────────

def run_model(model_path: str, backend: str, features: np.ndarray, labels: list[str]) -> dict:
    """Route to ONNX or PT backend."""
    if backend == "onnx":
        return run_onnx(model_path, features, labels)
    elif backend == "pt":
        return run_pt(model_path, features, labels)
    return {"error": "No model available", "label": "unknown", "confidence": 0.0, "scores": {}}


# ─────────────────── MAIN INFERENCE ───────────────────

def infer_genre(filepath: str) -> dict:
    """
    Hierarchical genre inference on an audio file.
    Returns:
        {
            genre_primary:   "tech_house",
            genre_secondary: "electro_house",
            macro_genre:     "house",
            confidence:      0.82,
            color:           "#3b82f6",
            backend:         "onnx",    ← shows which engine was used
            raw_scores:      { "tech_house": 0.82, ... }
        }
    """
    # Resolve macro model
    macro_path, macro_backend = resolve_model(MACRO_ONNX, MACRO_PT)
    if not macro_path:
        return {
            "error": f"No macro specialist model found in {MODELS_DIR}. "
                     f"Expected: {MACRO_ONNX} or {MACRO_PT}",
            "genre_primary": None,
            "confidence": 0.0,
        }

    # Load audio and extract features once (shared between both stages)
    audio = load_audio(filepath)
    features = extract_features(audio)

    # ── Stage 1: Macro classification ──────────────────────────────────────
    macro_result = run_model(macro_path, macro_backend, features, MACRO_LABELS)
    macro_label = macro_result.get("label", "unknown")

    # ── Stage 2: Specialist subgenre classification ─────────────────────────
    specialist_onnx, specialist_pt = SPECIALIST_MAP.get(macro_label, (None, None))
    spec_path, spec_backend = resolve_model(specialist_onnx, specialist_pt)

    subgenre_result = {}
    if spec_path:
        # Specialist models store labels inside the checkpoint — pass empty list
        # and let run_onnx/run_pt read them from the model metadata
        subgenre_result = run_model(spec_path, spec_backend, features, [])

    primary = subgenre_result.get("label") or macro_label
    secondary_scores = {k: v for k, v in subgenre_result.get("scores", {}).items()
                        if k != primary}
    secondary = max(secondary_scores, key=secondary_scores.get) if secondary_scores else macro_label

    used_backend = subgenre_result.get("backend") or macro_backend

    return {
        "genre_primary":   primary,
        "genre_secondary": secondary,
        "macro_genre":     macro_label,
        "confidence":      subgenre_result.get("confidence", macro_result.get("confidence", 0.0)),
        "color":           GENRE_COLORS.get(macro_label, "#9ca3af"),
        "backend":         used_backend,
        "raw_scores":      subgenre_result.get("scores") or macro_result.get("scores", {}),
    }


# ─────────────────── LIST MODELS ───────────────────

def list_models() -> None:
    print(f"\nModels directory: {MODELS_DIR}\n")
    all_models = [
        ("macro", MACRO_ONNX, MACRO_PT),
    ] + [
        (macro, onnx, pt)
        for macro, (onnx, pt) in SPECIALIST_MAP.items()
    ]

    try:
        import onnxruntime
        ort_available = True
    except ImportError:
        ort_available = False

    print(f"  onnxruntime: {'✅ installed' if ort_available else '❌ not installed  →  pip install onnxruntime'}")
    print()

    for name, onnx_f, pt_f in all_models:
        onnx_path = os.path.join(MODELS_DIR, onnx_f) if onnx_f else None
        pt_path   = os.path.join(MODELS_DIR, pt_f)   if pt_f   else None

        onnx_ok = onnx_path and os.path.exists(onnx_path)
        pt_ok   = pt_path   and os.path.exists(pt_path)

        active = "ONNX" if (onnx_ok and ort_available) else ("PT" if pt_ok else "MISSING")
        onnx_sz = f"({os.path.getsize(onnx_path)/1024/1024:.1f}MB)" if onnx_ok else "—"
        pt_sz   = f"({os.path.getsize(pt_path)/1024/1024:.1f}MB)"   if pt_ok   else "—"

        print(f"  [{name:<10}]  ONNX: {'✅' if onnx_ok else '❌'} {onnx_sz:<12}  "
              f"PT: {'✅' if pt_ok else '❌'} {pt_sz:<12}  → using: {active}")


# ─────────────────── CLI ───────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hierarchical EDM genre classifier")
    parser.add_argument("--file", type=str, help="Audio file to classify")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--list-models", action="store_true", help="Show available models and backends")
    args = parser.parse_args()

    if args.list_models:
        list_models()
        sys.exit(0)

    if not args.file:
        parser.print_help()
        sys.exit(1)

    if not os.path.exists(args.file):
        print(f"ERROR: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    result = infer_genre(args.file)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        err = result.get("error")
        if err:
            print(f"❌ Error: {err}")
        else:
            backend_label = f"[{result.get('backend', '?').upper()}]"
            print(f"\n🎵 {os.path.basename(args.file)}  {backend_label}")
            print(f"   Macro genre:    {result['macro_genre']}")
            print(f"   Primary genre:  {result['genre_primary']}")
            print(f"   Secondary:      {result['genre_secondary']}")
            print(f"   Confidence:     {result['confidence'] * 100:.1f}%")
            print(f"   Color code:     {result['color']}")
            if result.get("raw_scores"):
                top = sorted(result["raw_scores"].items(), key=lambda x: x[1], reverse=True)[:5]
                print(f"\n   Top predictions:")
                for label, score in top:
                    bar = "█" * int(score * 20)
                    print(f"     {label:<25} {score * 100:5.1f}%  {bar}")
