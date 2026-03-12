"""
Audio embedding generation using CLAP ONNX model.
Returns 512-dim joint audio-text embedding for vector similarity search.
SOC2 Rule 2: fully local, no network calls.
"""
import os

_onnx_session = None
_model_loaded = False
EMBEDDING_DIM = 512


def _load_model() -> bool:
    global _onnx_session, _model_loaded
    if _model_loaded:
        return _onnx_session is not None
    _model_loaded = True
    model_path = os.path.join(os.path.dirname(__file__), "models", "clap_audio.onnx")
    if not os.path.exists(model_path):
        print("[ML] clap_audio.onnx not found — embeddings will be zero vectors")
        return False
    try:
        import onnxruntime as ort
        _onnx_session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        print("[ML] CLAP audio embedding model loaded")
        return True
    except Exception as e:
        print(f"[ML] Failed to load CLAP model: {e}")
        return False


def generate_embedding(file_path: str) -> list:
    """
    Generate 512-dim embedding vector.
    With ONNX model: CLAP audio encoder.
    Without model: spectral feature vector (lower quality but functional for similarity).
    """
    if not os.path.exists(file_path):
        return [0.0] * EMBEDDING_DIM

    if _load_model() and _onnx_session is not None:
        return _onnx_embed(file_path)
    else:
        return _spectral_embed(file_path)


def _onnx_embed(file_path: str) -> list:
    try:
        import librosa
        import numpy as np

        y, sr = librosa.load(file_path, sr=48000, mono=True, duration=10.0)
        
        # CLAP ONNX expects shape [batch_size, 1, 1001, 64] (Mel spectrogram)
        # 1. Compute Mel Spectrogram
        mel = librosa.feature.melspectrogram(
            y=y, sr=sr, n_fft=1024, hop_length=480, n_mels=64, fmin=50, fmax=14000
        )
        # 2. Convert to log scale (power to db)
        mel_db = librosa.power_to_db(mel, ref=np.max)
        
        # 3. Transpose to [time_frames, n_mels] which is expected to be [1001, 64]
        mel_db = mel_db.T
        
        # 4. Pad or truncate to exactly 1001 frames
        target_frames = 1001
        if mel_db.shape[0] < target_frames:
            pad_width = target_frames - mel_db.shape[0]
            mel_db = np.pad(mel_db, ((0, pad_width), (0, 0)), mode='constant')
        else:
            mel_db = mel_db[:target_frames, :]
            
        # 5. Reshape to [1, 1, 1001, 64] and float32
        inp = mel_db[np.newaxis, np.newaxis, :, :].astype(np.float32)

        outputs = _onnx_session.run(None, {_onnx_session.get_inputs()[0].name: inp})
        embedding = outputs[0][0].tolist()

        # Ensure 512 dims
        if len(embedding) < EMBEDDING_DIM:
            embedding = embedding + [0.0] * (EMBEDDING_DIM - len(embedding))
        return embedding[:EMBEDDING_DIM]
    except Exception as e:
        print(f"[ML] ONNX embedding error: {e}")
        return [0.0] * EMBEDDING_DIM


def _spectral_embed(file_path: str) -> list:
    """Spectral feature vector (L2-normalized) as embedding approximation."""
    try:
        import librosa
        import numpy as np

        y, sr = librosa.load(file_path, sr=22050, mono=True, duration=30.0)

        # 20 MFCCs × (mean + std) = 40
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
        mfcc_feat = np.concatenate([np.mean(mfcc, axis=1), np.std(mfcc, axis=1)])

        # 12 chroma × (mean + std) = 24
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_feat = np.concatenate([np.mean(chroma, axis=1), np.std(chroma, axis=1)])

        # 128 mel bands mean = 128
        mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128)
        mel_feat = np.mean(mel, axis=1)

        # Spectral features = 7
        spec_feats = np.array([
            float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))),
            float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr))),
            float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr))),
            float(np.mean(librosa.feature.spectral_flatness(y=y))),
            float(np.mean(librosa.feature.zero_crossing_rate(y))),
            float(np.mean(librosa.feature.rms(y=y))),
            float(librosa.beat.beat_track(y=y, sr=sr)[0]),
        ])

        # Concatenate: 40 + 24 + 128 + 7 = 199 → pad to 512
        combined = np.concatenate([mfcc_feat, chroma_feat, mel_feat, spec_feats])
        if len(combined) < EMBEDDING_DIM:
            combined = np.pad(combined, (0, EMBEDDING_DIM - len(combined)))

        # L2 normalize
        norm = np.linalg.norm(combined) + 1e-9
        combined = combined / norm

        return combined[:EMBEDDING_DIM].tolist()
    except Exception as e:
        print(f"[ML] Spectral embedding error: {e}")
        return [0.0] * EMBEDDING_DIM


def is_model_loaded() -> bool:
    return _load_model() and _onnx_session is not None
