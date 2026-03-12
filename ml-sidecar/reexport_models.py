import os
import torch
import numpy as np
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
SAMPLE_RATE = 16000
CLIP_SECONDS = 10

def re_export_model(pt_filename, onnx_filename):
    pt_path = os.path.join(MODELS_DIR, pt_filename)
    onnx_path = os.path.join(MODELS_DIR, onnx_filename)
    
    if not os.path.exists(pt_path):
        print(f"Skipping {pt_filename} (not found)")
        return

    print(f"\nRe-exporting {pt_filename} to {onnx_filename} with opset_version=15...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    # Needs to dynamically build the right architecture 
    # For AST specialists, we need num_classes
    checkpoint = torch.load(pt_path, map_location=device, weights_only=False)
    state_dict = checkpoint.get("model_state_dict", checkpoint)
    genres = checkpoint.get("genres", checkpoint.get("labels", []))
    num_classes = len(genres)

    from train_specialist_ast import ASTSpecialistClassifier
    model = ASTSpecialistClassifier(num_classes=num_classes)
    model.load_state_dict(state_dict)
    model.eval()
    model.to(device)

    # We need the appropriate feature extractor
    from transformers import ASTFeatureExtractor
    feature_extractor = ASTFeatureExtractor.from_pretrained("MIT/ast-finetuned-audioset-10-10-0.4593")

    dummy_audio = np.random.randn(SAMPLE_RATE * CLIP_SECONDS).astype(np.float32)
    inputs = feature_extractor(dummy_audio, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    dummy_input = inputs["input_values"].to(device)

    torch.onnx.export(
        model, dummy_input, onnx_path,
        input_names=["input"], output_names=["output"],
        dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}},
        opset_version=15
    )
    print(f"✅ Extracted new ONNX: {onnx_path}")

if __name__ == "__main__":
    sys.path.append(SCRIPT_DIR) # to import train_specialist_ast
    re_export_model("macro_specialist_checkpoint.pt", "macro_specialist_int8.onnx")
    re_export_model("phonk_specialist_checkpoint.pt", "phonk_specialist_int8.onnx")
    re_export_model("house_specialist_checkpoint.pt", "house_specialist_int8.onnx")
    re_export_model("techno_specialist_checkpoint.pt", "techno_specialist_int8.onnx")
    re_export_model("bass_specialist_checkpoint.pt", "bass_specialist_int8.onnx")
    re_export_model("trance_specialist_checkpoint.pt", "trance_specialist_int8.onnx")
    print("Done!")
