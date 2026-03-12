import glob
import onnx
import sys

for f in glob.glob('ml-sidecar/models/*.onnx'):
    try:
        model = onnx.load(f)
        if getattr(model, "ir_version", 0) > 9:
            print(f"Downgrading {f} IR version from {model.ir_version} to 9...")
            model.ir_version = 9
            onnx.save(model, f)
            print(f"✅ {f} Fixed!")
        else:
            print(f"{f} already compatible (IR {getattr(model, 'ir_version', 'Unknown')})")
    except Exception as e:
        print(f"Failed to process {f}: {e}")
