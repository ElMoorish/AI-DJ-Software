"""
Acoustic fingerprinting using pyacoustid.
Returns a fingerprint string only — never audio bytes.
SOC2 Rule 2: fingerprint stays local.
"""
import os


def generate_fingerprint(file_path: str) -> str:
    """Generate acoustic fingerprint. Falls back to SHA256-based ID if acoustid unavailable."""
    if not os.path.exists(file_path):
        return "invalid_path"

    # Try pyacoustid (wraps Chromaprint)
    try:
        import acoustid
        duration, fingerprint_bytes = acoustid.fingerprint_file(file_path)
        # Return base64-encoded fingerprint bytes, not audio data
        import base64
        return base64.b64encode(fingerprint_bytes).decode('ascii')
    except ImportError:
        pass
    except Exception as e:
        print(f"[ML] acoustid fingerprint error for {file_path}: {e}")

    # Fallback: SHA-256-based fingerprint from file content
    try:
        import hashlib
        h = hashlib.sha256()
        with open(file_path, 'rb') as f:
            # Skip ID3 tags (first 4k) — hash the audio body
            f.seek(4096)
            while chunk := f.read(65536):
                h.update(chunk)
        return f"sha256:{h.hexdigest()}"
    except Exception as e:
        print(f"[ML] SHA fingerprint error: {e}")
        return "fingerprint_error"
