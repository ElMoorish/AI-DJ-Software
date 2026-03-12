"""
Genre classification. Uses ONNX model if available, else graceful fallback.
SOC2 Rule 6: Graceful degradation if model not found.
"""
import os

GENRE_CLASSES = [
    "Techno", "House", "Deep House", "Progressive House", "Trance",
    "Drum and Bass", "Jungle", "Ambient", "Hip-Hop", "R&B",
    "Pop", "Rock", "Jazz", "Classical", "Soul", "Funk",
    "Reggae", "Latin", "World", "Electronic", "Industrial", "Other"
]

_onnx_session = None
_model_loaded = False


def _load_model() -> bool:
    global _onnx_session, _model_loaded
    if _model_loaded:
        return _onnx_session is not None
    _model_loaded = True
    model_path = os.path.join(os.path.dirname(__file__), "models", "genre.onnx")
    if not os.path.exists(model_path):
        print("[ML] genre.onnx not found — using fallback classifier")
        return False
    try:
        import onnxruntime as ort
        _onnx_session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        print("[ML] Genre model loaded from ONNX")
        return True
    except Exception as e:
        print(f"[ML] Failed to load genre model: {e}")
        return False


def classify_genre(file_path: str, y=None, sr=None) -> dict:
    """
    Classify genre from audio file.
    With ONNX model: Mel-spectrogram → CNN → softmax over 22 genres.
    Without model: uses librosa energy/tempo heuristics for a best-guess.
    """
    if not os.path.exists(file_path):
        return _unknown_genre()

    if _load_model() and _onnx_session is not None:
        return _onnx_classify(file_path, y, sr)
    else:
        return _heuristic_genre(file_path, y, sr)


def _onnx_classify(file_path: str, y=None, sr=None) -> dict:
    try:
        import librosa
        import numpy as np

        if y is None or sr is None:
            y, sr = librosa.load(file_path, sr=22050, mono=True, duration=30.0)
        else:
            # Ensure we only use first 30s if provided signal is longer
            y = y[:int(sr * 30.0)]
        mel = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=512, n_mels=128, fmax=8000)
        mel_db = librosa.power_to_db(mel, ref=np.max)
        mel_norm = (mel_db - mel_db.mean()) / (mel_db.std() + 1e-9)

        # Pad or truncate to 1292 time frames
        target_frames = 1292
        if mel_norm.shape[1] < target_frames:
            mel_norm = np.pad(mel_norm, ((0, 0), (0, target_frames - mel_norm.shape[1])))
        else:
            mel_norm = mel_norm[:, :target_frames]

        inp = mel_norm[np.newaxis, np.newaxis, :, :].astype(np.float32)
        outputs = _onnx_session.run(None, {_onnx_session.get_inputs()[0].name: inp})
        probs = outputs[0][0]

        top2 = sorted(enumerate(probs), key=lambda x: -x[1])[:2]
        return {
            "genre_primary": GENRE_CLASSES[top2[0][0]],
            "genre_secondary": GENRE_CLASSES[top2[1][0]],
            "genre_confidence": float(top2[0][1]),
            "raw_scores": {GENRE_CLASSES[i]: float(p) for i, p in enumerate(probs)},
        }
    except Exception as e:
        print(f"[ML] ONNX genre inference error: {e}")
        return _unknown_genre()


def _heuristic_genre(file_path: str, y=None, sr=None) -> dict:
    """Best-effort genre estimation from audio features when no model available."""
    try:
        import librosa
        import numpy as np

        if y is None or sr is None:
            y, sr = librosa.load(file_path, sr=22050, mono=True, duration=30.0)
        else:
            y = y[:int(sr * 30.0)]
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(tempo[0] if hasattr(tempo, '__len__') else tempo)
        spectral_centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))

        # Very rough heuristics
        if bpm > 140:
            genre = "Drum and Bass"
        elif bpm > 128 and spectral_centroid > 3000:
            genre = "Techno"
        elif bpm > 120 and bpm <= 135:
            genre = "House"
        elif bpm < 90:
            genre = "Ambient"
        elif spectral_centroid > 4000:
            genre = "Electronic"
        else:
            genre = "Other"

        return {"genre_primary": genre, "genre_secondary": "Other", "genre_confidence": 0.4}
    except Exception:
        return _unknown_genre()


def _unknown_genre() -> dict:
    return {"genre_primary": "Unknown", "genre_secondary": None, "genre_confidence": 0.0}


def is_model_loaded() -> bool:
    return _load_model() and _onnx_session is not None
