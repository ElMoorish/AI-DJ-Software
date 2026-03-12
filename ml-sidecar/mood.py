"""
Mood classification. ONNX model if available, else valence/arousal heuristic.
SOC2 Rule 2: fully local — no data leaves device.
"""
import os

MOOD_CLASSES = [
    "Euphoric", "Energetic", "Happy", "Uplifting", "Dreamy", "Melancholic",
    "Dark", "Aggressive", "Tense", "Calm", "Relaxed", "Spiritual",
]

_onnx_session = None
_model_loaded = False


def _load_model() -> bool:
    global _onnx_session, _model_loaded
    if _model_loaded:
        return _onnx_session is not None
    _model_loaded = True
    model_path = os.path.join(os.path.dirname(__file__), "models", "mood.onnx")
    if not os.path.exists(model_path):
        print("[ML] mood.onnx not found — using heuristic classifier")
        return False
    try:
        import onnxruntime as ort
        _onnx_session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        print("[ML] Mood model loaded from ONNX")
        return True
    except Exception as e:
        print(f"[ML] Failed to load mood model: {e}")
        return False


def classify_mood(file_path: str, y=None, sr=None) -> dict:
    """Classify mood from audio file. Falls back to valence/arousal heuristic."""
    if not os.path.exists(file_path):
        return _unknown_mood()

    if _load_model() and _onnx_session is not None:
        return _onnx_classify(file_path, y, sr)
    else:
        return _heuristic_mood(file_path, y, sr)


def _onnx_classify(file_path: str, y=None, sr=None) -> dict:
    try:
        import librosa
        import numpy as np

        if y is None or sr is None:
            y, sr = librosa.load(file_path, sr=22050, mono=True, duration=30.0)
        else:
            y = y[:int(sr * 30.0)]
        mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128, fmax=8000)
        mel_db = librosa.power_to_db(mel, ref=np.max)
        mel_norm = (mel_db - mel_db.mean()) / (mel_db.std() + 1e-9)

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
            "mood_primary": MOOD_CLASSES[top2[0][0]],
            "mood_secondary": MOOD_CLASSES[top2[1][0]],
            "mood_confidence": float(top2[0][1]),
        }
    except Exception as e:
        print(f"[ML] ONNX mood inference error: {e}")
        return _unknown_mood()


def _heuristic_mood(file_path: str, y=None, sr=None) -> dict:
    """Estimate mood from valence/arousal proxies derived from audio features."""
    try:
        import librosa
        import numpy as np

        if y is None or sr is None:
            y, sr = librosa.load(file_path, sr=22050, mono=True, duration=30.0)
        else:
            y = y[:int(sr * 30.0)]
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(tempo[0] if hasattr(tempo, '__len__') else tempo)

        rms = float(np.mean(librosa.feature.rms(y=y)))
        # High-frequency energy proxy for brightness (valence)
        spec = np.abs(librosa.stft(y))
        freqs = librosa.fft_frequencies(sr=sr)
        high_energy = float(np.mean(spec[freqs > 4000, :]))
        low_energy = float(np.mean(spec[freqs < 500, :]))
        brightness = high_energy / (low_energy + 1e-9)

        # Map to moods
        arousal = min(1.0, bpm / 160.0)
        valence = min(1.0, brightness * 5)

        if arousal > 0.8 and valence > 0.6:
            mood = "Euphoric"
        elif arousal > 0.75:
            mood = "Energetic"
        elif arousal > 0.6 and valence > 0.5:
            mood = "Happy"
        elif arousal < 0.4 and valence < 0.4:
            mood = "Melancholic"
        elif arousal > 0.7 and valence < 0.4:
            mood = "Aggressive"
        elif arousal < 0.5:
            mood = "Calm"
        else:
            mood = "Uplifting"

        return {"mood_primary": mood, "mood_secondary": "Energetic", "mood_confidence": 0.4}
    except Exception:
        return _unknown_mood()


def _unknown_mood() -> dict:
    return {"mood_primary": "Unknown", "mood_secondary": None, "mood_confidence": 0.0}


def is_model_loaded() -> bool:
    return _load_model() and _onnx_session is not None
