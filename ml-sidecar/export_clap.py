"""
export_clap.py — Downloads the pre-trained CLAP model from HuggingFace
and exports the audio encoder to ONNX format for the AI DJ app.

Model: laion/clap-htsat-unfused (CLAP audio encoder, 512-dim embeddings)
Output: ml-sidecar/models/clap_audio.onnx

Usage:
  python ml-sidecar/export_clap.py
"""
import os
import sys
import torch
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
OUTPUT_PATH = os.path.join(MODELS_DIR, "clap_audio.onnx")
REPO_ID = "laion/clap-htsat-unfused"

# CLAP expects 48kHz audio, 10 seconds = 480000 samples
SAMPLE_RATE = 48000
AUDIO_LENGTH = SAMPLE_RATE * 10  # 10 seconds


def main():
    print("=" * 60)
    print("AI DJ — CLAP Audio Encoder → ONNX Export")
    print("=" * 60)
    print(f"  Model:  {REPO_ID}")
    print(f"  Output: {OUTPUT_PATH}")
    print()

    # Check CUDA
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"  Device: {device}")
    if device == "cuda":
        print(f"  GPU:    {torch.cuda.get_device_name(0)}")
    print()

    # Step 1: Load model and processor
    print("[1/4] Loading CLAP model from HuggingFace...")
    from transformers import ClapModel, ClapProcessor

    model = ClapModel.from_pretrained(REPO_ID)
    processor = ClapProcessor.from_pretrained(REPO_ID)
    model.eval()
    model = model.to(device)
    print(f"  ✓ Model loaded ({sum(p.numel() for p in model.parameters()) / 1e6:.1f}M parameters)")

    # Step 2: Create dummy audio input
    print("[2/4] Preparing dummy audio input...")
    dummy_audio = np.random.randn(AUDIO_LENGTH).astype(np.float32)
    inputs = processor(audio=dummy_audio, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    # Test forward pass
    with torch.no_grad():
        audio_output = model.get_audio_features(**inputs)
        # transformers v5 may return BaseModelOutputWithPooling or a tensor
        if hasattr(audio_output, 'pooler_output'):
            audio_features = audio_output.pooler_output
        elif hasattr(audio_output, 'last_hidden_state'):
            audio_features = audio_output.last_hidden_state.mean(dim=1)
        elif isinstance(audio_output, torch.Tensor):
            audio_features = audio_output
        else:
            # Try to find the tensor in the output
            for attr in ['pooler_output', 'last_hidden_state', 'audio_embeds']:
                if hasattr(audio_output, attr):
                    audio_features = getattr(audio_output, attr)
                    if len(audio_features.shape) == 3:
                        audio_features = audio_features.mean(dim=1)
                    break
            else:
                # Last resort: get first item if it's iterable
                audio_features = audio_output[0] if hasattr(audio_output, '__getitem__') else audio_output
                if len(audio_features.shape) == 3:
                    audio_features = audio_features.mean(dim=1)
    print(f"  ✓ Forward pass OK — embedding shape: {audio_features.shape}")

    # Step 3: Export audio model to ONNX
    print("[3/4] Exporting audio encoder to ONNX...")

    # We wrap the full CLAP audio pipeline for clean ONNX export
    class CLAPAudioWrapper(torch.nn.Module):
        def __init__(self, clap_model):
            super().__init__()
            self.audio_model = clap_model.audio_model
            self.audio_projection = clap_model.audio_projection

        def forward(self, input_features):
            audio_output = self.audio_model(input_features)
            # Get the pooled output
            if hasattr(audio_output, 'pooler_output') and audio_output.pooler_output is not None:
                pooled = audio_output.pooler_output
            else:
                pooled = audio_output.last_hidden_state.mean(dim=1)
            projected = self.audio_projection(pooled)
            return projected

    wrapper = CLAPAudioWrapper(model).to(device)
    wrapper.eval()

    # Get the actual input tensor for the audio model
    dummy_input = inputs["input_features"]
    print(f"  Input shape: {dummy_input.shape}")

    os.makedirs(MODELS_DIR, exist_ok=True)

    torch.onnx.export(
        wrapper,
        dummy_input,
        OUTPUT_PATH,
        input_names=["audio_input"],
        output_names=["embedding"],
        dynamic_axes={
            "audio_input": {0: "batch_size"},
            "embedding": {0: "batch_size"},
        },
        opset_version=15,
        do_constant_folding=True,
    )

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"  ✓ Exported to {OUTPUT_PATH} ({size_mb:.1f} MB)")

    # Step 4: Verify
    print("[4/4] Verifying ONNX model...")
    import onnx
    onnx_model = onnx.load(OUTPUT_PATH)
    onnx.checker.check_model(onnx_model)

    import onnxruntime as ort
    session = ort.InferenceSession(OUTPUT_PATH)
    ort_inputs = {"audio_input": dummy_input.cpu().numpy()}
    ort_output = session.run(None, ort_inputs)[0]
    print(f"  ✓ ONNX Runtime inference OK — output shape: {ort_output.shape}")

    # Compare PyTorch vs ONNX outputs
    with torch.no_grad():
        pt_output = wrapper(dummy_input).cpu().numpy()
    diff = np.abs(pt_output - ort_output).max()
    print(f"  ✓ Max deviation PyTorch↔ONNX: {diff:.6f}")

    print()
    print("✅ CLAP audio encoder exported successfully!")
    print(f"   {OUTPUT_PATH} ({size_mb:.1f} MB)")
    print(f"   Embedding dimension: {ort_output.shape[-1]}")


if __name__ == "__main__":
    main()

