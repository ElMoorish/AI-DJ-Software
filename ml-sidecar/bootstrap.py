"""
ML Model Bootstrap — generates development stub ONNX model files.
These are placeholder models with correct input/output shapes that allow
the application to function in development mode while real trained models
are being prepared.

When real trained models become available, update manifest.json with valid
URLs and sha256 hashes, then set DOWNLOAD_REAL_MODELS=true below.

Usage:
  python bootstrap.py            # generate/download missing models
  python bootstrap.py --check    # JSON status check (no generation)
"""
import os
import json
import hashlib
import sys
import struct

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
MANIFEST_PATH = os.path.join(MODELS_DIR, "manifest.json")

# Set to True when real trained models are hosted and manifest URLs are valid
DOWNLOAD_REAL_MODELS = False

# Map manifest model keys → SettingsView UI keys
KEY_ALIAS = {
    "genre_cnn":     "genre_classifier",
    "mood_hubert":   "mood_classifier",
    "clap_audio":    "clap_embedding",
    "beat_detector": "beat_detector",
}

MODEL_NAMES = {
    "genre_classifier": "Genre Classifier",
    "mood_classifier":  "Mood Classifier",
    "clap_embedding":   "CLAP Embedding",
    "beat_detector":    "Beat Detector",
}

DOWNLOAD_TIMEOUT = 30


def emit(obj: dict) -> None:
    """Emit a progress/status JSON line for the Electron IPC parser."""
    print(f"PROGRESS:{json.dumps(obj)}", flush=True)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict:
    if not os.path.exists(MANIFEST_PATH):
        return {}
    with open(MANIFEST_PATH, "r") as f:
        return json.load(f)


def check_models() -> dict:
    """Quick check — returns {ui_key: 'ok'|'missing'}."""
    manifest = load_manifest()
    out = {}
    for name, spec in manifest.get("models", {}).items():
        ui_key = KEY_ALIAS.get(name, name)
        dest = os.path.join(MODELS_DIR, spec["file"])
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            sha = spec.get("sha256", "")
            out[ui_key] = ("ok" if (not sha or sha256_file(dest) == sha) else "missing")
        else:
            out[ui_key] = "missing"
    return out


# ─────────────────── STUB ONNX GENERATION ───────────────────
# Generates minimal valid ONNX files without needing the `onnx` package.
# Each stub has the correct input/output tensor names and shapes from MlModels.md.

def _encode_varint(value: int) -> bytes:
    """Encode an integer as a protobuf varint."""
    parts = []
    while value > 0x7F:
        parts.append((value & 0x7F) | 0x80)
        value >>= 7
    parts.append(value & 0x7F)
    return bytes(parts)


def _encode_field(field_number: int, wire_type: int, data: bytes) -> bytes:
    """Encode a protobuf field."""
    tag = _encode_varint((field_number << 3) | wire_type)
    if wire_type == 2:  # length-delimited
        return tag + _encode_varint(len(data)) + data
    elif wire_type == 0:  # varint
        return tag + data
    return tag + data


def _encode_string(field_number: int, value: str) -> bytes:
    return _encode_field(field_number, 2, value.encode("utf-8"))


def _encode_int64(field_number: int, value: int) -> bytes:
    return _encode_field(field_number, 0, _encode_varint(value))


def _make_tensor_type(elem_type: int, shape: list) -> bytes:
    """Build TensorTypeProto."""
    # TensorShapeProto
    dims = b""
    for d in shape:
        # TensorShapeProto.Dimension: field 1 = dim_value (int64)
        dim = _encode_int64(1, d)
        dims += _encode_field(2, 2, dim)  # TensorShapeProto field 2 = dim
    shape_proto = dims

    # TensorTypeProto: field 1 = elem_type, field 2 = shape
    tensor_type = _encode_int64(1, elem_type) + _encode_field(2, 2, shape_proto)
    return tensor_type


def _make_value_info(name: str, elem_type: int, shape: list) -> bytes:
    """Build ValueInfoProto."""
    tensor_type = _make_tensor_type(elem_type, shape)
    # TypeProto: field 1 = tensor_type
    type_proto = _encode_field(1, 2, tensor_type)
    # ValueInfoProto: field 1 = name, field 2 = type
    return _encode_string(1, name) + _encode_field(2, 2, type_proto)


def _make_constant_node(output_name: str, float_values: list, shape: list) -> bytes:
    """Build a Constant NodeProto that outputs zeros."""
    # TensorProto for the constant value
    # field 1 = dims (repeated int64), field 2 = data_type (1=FLOAT),
    # field 4 = float_data (repeated float)
    tensor = b""
    for d in shape:
        tensor += _encode_int64(1, d)
    tensor += _encode_int64(2, 1)  # FLOAT = 1
    # Pack float values
    float_bytes = struct.pack(f"<{len(float_values)}f", *float_values)
    tensor += _encode_field(4, 2, float_bytes)

    # AttributeProto: field 1 = name ("value"), field 4 = type (TENSOR=4), field 5 = t (tensor)
    attr = (_encode_string(1, "value") +
            _encode_int64(4, 4) +  # AttributeType TENSOR = 4
            _encode_field(5, 2, tensor))

    # NodeProto: field 2 = output, field 3 = op_type, field 5 = attribute
    node = (_encode_string(2, output_name) +
            _encode_string(3, "Constant") +
            _encode_field(5, 2, attr))
    return node


def generate_stub_onnx(filepath: str, input_name: str, input_shape: list,
                       output_name: str, output_shape: list) -> None:
    """Generate a minimal valid ONNX file with a Constant node outputting zeros."""
    # Calculate total output elements
    total_elements = 1
    for d in output_shape:
        total_elements *= d

    # Build the constant node
    node = _make_constant_node(output_name, [0.0] * total_elements, output_shape)

    # Build input and output ValueInfoProtos
    input_vi = _make_value_info(input_name, 1, input_shape)  # FLOAT = 1
    output_vi = _make_value_info(output_name, 1, output_shape)

    # GraphProto: field 1 = node, field 11 = input, field 12 = output, field 17 = name
    graph = (_encode_field(1, 2, node) +
             _encode_field(11, 2, input_vi) +
             _encode_field(12, 2, output_vi) +
             _encode_string(17, "stub_graph"))

    # OperatorSetIdProto: field 2 = version (17)
    opset = _encode_int64(2, 17)

    # ModelProto: field 1 = ir_version (8), field 7 = graph, field 8 = opset_import
    model = (_encode_int64(1, 8) +
             _encode_field(7, 2, graph) +
             _encode_field(8, 2, opset) +
             _encode_string(6, f"DEV STUB — {os.path.basename(filepath)}"))

    with open(filepath, "wb") as f:
        f.write(model)


# Model specifications from MlModels.md
STUB_SPECS = {
    "genre_cnn": {
        "input_name": "mel_spectrogram", "input_shape": [1, 1, 128, 1292],
        "output_name": "genre_logits", "output_shape": [1, 10],
    },
    "mood_hubert": {
        "input_name": "audio_features", "input_shape": [1, 768],
        "output_name": "mood_probs", "output_shape": [1, 6],
    },
    "clap_audio": {
        "input_name": "audio_input", "input_shape": [1, 480000],
        "output_name": "embedding", "output_shape": [1, 512],
    },
    "beat_detector": {
        "input_name": "spectrogram", "input_shape": [1, 81, 594],
        "output_name": "beat_probs", "output_shape": [1, 594],
    },
}


def generate_stub(ui_key: str, manifest_key: str, filename: str) -> str:
    """Generate a stub ONNX file for a model. Returns 'ok' or 'error'."""
    dest = os.path.join(MODELS_DIR, filename)
    spec = STUB_SPECS.get(manifest_key)
    if not spec:
        emit({"model": ui_key, "percent": 0, "error": f"No stub spec for {manifest_key}"})
        return "error"

    emit({"model": ui_key, "percent": 10})

    try:
        generate_stub_onnx(
            dest,
            spec["input_name"], spec["input_shape"],
            spec["output_name"], spec["output_shape"],
        )
        emit({"model": ui_key, "percent": 100})
        return "ok"
    except Exception as e:
        emit({"model": ui_key, "percent": 0, "error": f"Stub generation failed: {str(e)[:100]}"})
        return "error"


# ─────────────────── NETWORK DOWNLOAD (for future use) ───────────────────

def download_model(ui_key: str, url: str, dest: str, expected_sha256: str = "") -> str:
    """Download model file from URL. For use when real trained models are hosted."""
    try:
        import requests as req
    except ImportError:
        emit({"model": ui_key, "percent": 0, "error": "pip install requests"})
        return "error"

    if not url:
        emit({"model": ui_key, "percent": 0, "error": "No download URL"})
        return "error"

    hf_token = os.environ.get("HF_TOKEN", "")
    headers = {}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"

    emit({"model": ui_key, "percent": 0})
    try:
        resp = req.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT, headers=headers)
        if resp.status_code in (401, 403, 404):
            emit({"model": ui_key, "percent": 0, "error": f"HTTP {resp.status_code}"})
            return "error"
        resp.raise_for_status()

        total = int(resp.headers.get("content-length", 0))
        downloaded = 0
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=65536):
                f.write(chunk)
                downloaded += len(chunk)
                if total > 0:
                    emit({"model": ui_key, "percent": int(downloaded / total * 100)})

        if expected_sha256 and sha256_file(dest) != expected_sha256:
            os.remove(dest)
            emit({"model": ui_key, "percent": 0, "error": "SHA-256 mismatch"})
            return "error"

        emit({"model": ui_key, "percent": 100})
        return "ok"
    except Exception as e:
        emit({"model": ui_key, "percent": 0, "error": str(e)[:120]})
        if os.path.exists(dest):
            os.remove(dest)
        return "error"


# ─────────────────── MAIN BOOTSTRAP ───────────────────

def bootstrap_models() -> dict:
    """Provision all missing models — either download or generate stubs."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    manifest = load_manifest()

    if not manifest:
        print(f"DONE:{json.dumps({})}", flush=True)
        return {}

    results: dict = {}
    for name, spec in manifest.get("models", {}).items():
        ui_key = KEY_ALIAS.get(name, name)
        dest = os.path.join(MODELS_DIR, spec["file"])
        sha256 = spec.get("sha256", "")

        # Already exists and valid
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            if not sha256 or sha256_file(dest) == sha256:
                results[ui_key] = "ok"
                emit({"model": ui_key, "percent": 100})
                continue

        # Try network download if enabled and URL exists
        if DOWNLOAD_REAL_MODELS and spec.get("url"):
            results[ui_key] = download_model(ui_key, spec["url"], dest, sha256)
        else:
            # Generate local stub
            results[ui_key] = generate_stub(ui_key, name, spec["file"])

    print(f"DONE:{json.dumps(results)}", flush=True)
    return results


if __name__ == "__main__":
    if "--check" in sys.argv:
        print(json.dumps(check_models()), flush=True)
    else:
        bootstrap_models()
