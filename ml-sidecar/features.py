"""
Feature extraction using librosa.
SOC2 Rule 2: All processing is local — no audio bytes sent over network.
"""
import os

# Camelot Wheel mapping from (key_name, scale) → Camelot code
CAMELOT_MAP = {
    "C major": "8B", "G major": "9B", "D major": "10B", "A major": "11B",
    "E major": "12B", "B major": "1B", "F# major": "2B", "C# major": "3B",
    "Ab major": "4B", "Eb major": "5B", "Bb major": "6B", "F major": "7B",
    "A minor": "8A", "E minor": "9A", "B minor": "10A", "F# minor": "11A",
    "C# minor": "12A", "Ab minor": "1A", "Eb minor": "2A", "Bb minor": "3A",
    "F minor": "4A", "C minor": "5A", "G minor": "6A", "D minor": "7A",
}

KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

def _librosa_key_to_name(key_idx: int, scale: str) -> str:
    """Convert librosa key index (0-11) + scale string to 'X major/minor' format."""
    name = KEY_NAMES[key_idx % 12]
    mode = "major" if "maj" in scale.lower() else "minor"
    return f"{name} {mode}"


def extract_features(file_path: str, y=None, sr=None, true_duration_ms=None) -> dict:
    """
    Extract audio features using librosa.
    Returns graceful fallback if librosa not installed.
    """
    if not os.path.exists(file_path):
        return _fallback_features()

    try:
        import librosa
        import numpy as np

        # Load mono, 22050 Hz, up to 120s for analysis if not provided
        if y is None or sr is None:
            y, sr = librosa.load(file_path, sr=22050, mono=True, duration=120.0)

        # BPM + beat frames
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(tempo[0] if hasattr(tempo, '__len__') else tempo)
        beat_positions_ms = (librosa.frames_to_time(beat_frames, sr=sr) * 1000).tolist()

        # Key detection via chromagram
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = np.mean(chroma, axis=1)
        # Use harmonic component for better key detection
        y_harm, _ = librosa.effects.hpss(y)
        # Estimate mode using major vs minor template
        major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

        major_corrs = [np.corrcoef(np.roll(major_profile, -i), chroma_mean)[0, 1] for i in range(12)]
        minor_corrs = [np.corrcoef(np.roll(minor_profile, -i), chroma_mean)[0, 1] for i in range(12)]

        best_major = max(enumerate(major_corrs), key=lambda x: x[1])
        best_minor = max(enumerate(minor_corrs), key=lambda x: x[1])

        if best_major[1] >= best_minor[1]:
            key_name = f"{KEY_NAMES[best_major[0]]} major"
            key_confidence = float(best_major[1])
        else:
            key_name = f"{KEY_NAMES[best_minor[0]]} minor"
            key_confidence = float(best_minor[1])

        key_camelot = CAMELOT_MAP.get(key_name, "?")

        # Energy (RMS)
        rms = librosa.feature.rms(y=y)
        energy = float(np.mean(rms))
        energy_normalized = min(1.0, energy * 20)  # scale to 0-1

        # Danceability proxy: beat strength consistency
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        danceability = float(min(1.0, np.std(onset_env) / (np.mean(onset_env) + 1e-6)))

        # Loudness (LUFS approximation using RMS)
        loudness_lufs = float(20 * np.log10(np.mean(rms) + 1e-9))

        # MFCCs (20 coefficients)
        mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
        mfccs_mean = np.mean(mfccs, axis=1).tolist()

        # Chroma (12 bins)
        chroma_mean_list = chroma_mean.tolist()

        # --- ML STRUCTURAL PHASE DETECTION ---
        # 1. Separate Harmonic and Percussive streams
        y_harm, y_perc = librosa.effects.hpss(y)
        
        # 2. Beat track strictly on the percussives for higher accuracy
        tempo, beat_frames = librosa.beat.beat_track(y=y_perc, sr=sr)
        bpm = float(tempo[0] if hasattr(tempo, '__len__') else tempo)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        
        # 3. Synchronize Chroma to Beats (to detect chord changes per beat)
        chromagram = librosa.feature.chroma_cqt(y=y_harm, sr=sr)
        beat_chroma = librosa.util.sync(chromagram, beat_frames, aggregate=np.median)
        
        # 4. Self-Similarity Matrix (Recurrence Plot) to find structural boundaries
        # We look for major shifts in the harmony over a ~32 beat window
        try:
            import scipy.ndimage
            
            # Compute cross-similarity
            R = librosa.segment.recurrence_matrix(beat_chroma, mode='affinity', metric='cosine', sym=True)
            # Enhance diagonals
            R_aff = librosa.segment.path_enhance(R, 15)
            
            # Compute a novelty curve from the recurrence matrix 
            # (peaks in novelty = boundaries between major structural phrases)
            novelty = np.zeros(R_aff.shape[1])
            for i in range(1, R_aff.shape[1] - 1):
                # Simple checkerboard kernel correlation for block shifts
                prev_block = R_aff[:i, :i].sum()
                next_block = R_aff[i:, i:].sum()
                cross_block = R_aff[:i, i:].sum()
                novelty[i] = (prev_block + next_block - 2*cross_block) / float(R_aff.size)
                
            # Smooth the novelty curve
            novelty = scipy.ndimage.gaussian_filter1d(novelty, sigma=4)
            # Find peaks (phrase boundaries)
            peaks = librosa.util.peak_pick(novelty, pre_max=16, post_max=16, pre_avg=16, post_avg=16, delta=0.05, wait=16)
            
            phrase_boundaries_ms = (beat_times[peaks] * 1000).tolist() if len(peaks) > 0 else []
        except Exception as e:
            print(f"[ML] Phrase detection failed, fallback: {e}")
            phrase_boundaries_ms = []

        # 5. Map boundaries to Intro/Drop/Outro
        duration_ms = true_duration_ms if true_duration_ms is not None else (len(y) / sr * 1000)
        
        # Default fallbacks if ML peaks fail
        intro_end_ms = duration_ms * 0.08
        drop_start_ms = duration_ms * 0.30
        outro_start_ms = duration_ms * 0.85
        
        if len(phrase_boundaries_ms) >= 3:
            # Intro usually ends at the first major boundary
            intro_end_ms = phrase_boundaries_ms[0]
            # The drop is usually the loudest block boundary in the first half
            loudest_peak = drop_start_ms
            max_energy = 0
            # Scan energy around boundaries
            for b_ms in phrase_boundaries_ms:
                if b_ms < duration_ms * 0.6: # Drops happen before 60% of the song
                    b_frame = librosa.time_to_frames(b_ms / 1000.0, sr=sr)
                    if b_frame < len(rms[0]):
                        e_val = np.mean(rms[0][max(0, b_frame-40) : min(len(rms[0]), b_frame+40)])
                        if e_val > max_energy:
                            max_energy = e_val
                            loudest_peak = b_ms
            
            drop_start_ms = loudest_peak if loudest_peak > intro_end_ms else phrase_boundaries_ms[1]
            # Outro is typically the last major structural boundary
            outro_start_ms = phrase_boundaries_ms[-1]

        # --- VOCAL / STEM ISOLATION AWARENESS ---
        # Instead of heavy Spleeter, we estimate vocal presence by looking at
        # the proportion of energy in the typical vocal frequency band (300Hz - 3kHz) 
        # within the isolated harmonic stem.
        try:
            D_harm = librosa.stft(y_harm)
            S_harm = np.abs(D_harm)
            # n_fft is 2048 by default. Frequencies: bin_f = bin * sr / n_fft
            freqs = librosa.fft_frequencies(sr=sr)
            # Find bins corresponding to ~300Hz and ~3000Hz
            vocal_bins = np.where((freqs >= 300) & (freqs <= 3000))[0]
            
            # Sum energy in vocal band vs total energy
            vocal_energy = np.sum(S_harm[vocal_bins, :], axis=0)
            total_harm_energy = np.sum(S_harm, axis=0)
            # Avoid divide by zero
            vocal_ratio = vocal_energy / (total_harm_energy + 1e-9)
            
            # Smooth the ratio over a ~1s window (sr=22050, hop_length=512 -> ~43 frames/sec)
            vocal_ratio_smooth = scipy.ndimage.gaussian_filter1d(vocal_ratio, sigma=21)
            
            # Threshold to find active vocal regions (e.g. > 40% of harmonic energy in vocal band)
            is_vocal = vocal_ratio_smooth > 0.40
            
            # Convert boolean array to segments
            vocal_segments_ms = []
            frame_times = librosa.frames_to_time(np.arange(len(is_vocal)), sr=sr)
            
            in_vocal = False
            start_time = 0
            for i, active in enumerate(is_vocal):
                if active and not in_vocal:
                    in_vocal = True
                    start_time = frame_times[i] * 1000
                elif not active and in_vocal:
                    in_vocal = False
                    end_time = frame_times[i] * 1000
                    # Only keep segments longer than 2 seconds
                    if end_time - start_time > 2000:
                        vocal_segments_ms.append({"start": int(start_time), "end": int(end_time)})
                        
            if in_vocal:
                end_time = frame_times[-1] * 1000
                if end_time - start_time > 2000:
                    vocal_segments_ms.append({"start": int(start_time), "end": int(end_time)})
        except Exception as e:
            print(f"[ML] Vocal detection failed: {e}")
            vocal_segments_ms = []

        return {
            "bpm": round(bpm, 2),
            "bpm_confidence": 0.85,
            "key_camelot": key_camelot,
            "key_name": key_name,
            "key_confidence": round(max(0.0, min(1.0, key_confidence)), 3),
            "energy": round(energy_normalized, 4),
            "danceability": round(danceability, 4),
            "loudness_lufs": round(loudness_lufs, 2),
            "intro_end_ms": int(intro_end_ms),
            "drop_start_ms": int(drop_start_ms),
            "outro_start_ms": int(outro_start_ms),
            "phrase_boundaries_ms": phrase_boundaries_ms,
            "beat_frames_ms": beat_positions_ms,
            "vocal_segments_ms": vocal_segments_ms,
            "mfccs": mfccs_mean,
            "chroma": chroma_mean.tolist(),
        }

    except ImportError:
        print("[ML] librosa not installed, returning fallback features")
        return _fallback_features()
    except Exception as e:
        print(f"[ML] Feature extraction error for {file_path}: {e}")
        return _fallback_features()


def _fallback_features() -> dict:
    return {
        "bpm": 128.0,
        "bpm_confidence": 0.0,
        "key_camelot": "8A",
        "key_name": "A minor",
        "key_confidence": 0.0,
        "energy": 0.5,
        "danceability": 0.5,
        "loudness_lufs": -14.0,
        "intro_end_ms": 8000,
        "drop_start_ms": 32000,
        "outro_start_ms": 200000,
        "mfccs": [0.0] * 20,
        "chroma": [0.0] * 12,
    }
