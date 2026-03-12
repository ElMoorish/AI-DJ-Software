"""
Stem separation using Demucs (htdemucs_ft model).
Background job management with threading.
SOC2 Rule 2: fully local processing.
"""
import os
import uuid
import threading
import time
from typing import Literal

StemType = Literal["vocals", "drums", "bass", "melody"]

_jobs: dict[str, dict] = {}   # job_id → { status, result, error }
_lock = threading.Lock()


def separate_stems_async(file_path: str, output_dir: str) -> str:
    """
    Start async stem separation. Returns job_id immediately.
    Poll with get_job_status(job_id).
    """
    job_id = str(uuid.uuid4())

    with _lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "file_path": file_path,
            "output_dir": output_dir,
            "stems": {},
            "error": None,
            "created_at": time.time(),
        }

    thread = threading.Thread(
        target=_run_separation,
        args=(job_id, file_path, output_dir),
        daemon=True,
        name=f"stems-{job_id[:8]}"
    )
    thread.start()
    return job_id


def _run_separation(job_id: str, file_path: str, output_dir: str) -> None:
    """Worker: runs Demucs separation and updates job state."""
    _update_job(job_id, status="running")

    if not os.path.exists(file_path):
        _update_job(job_id, status="failed", error=f"File not found: {file_path}")
        return

    try:
        import torch
        import demucs.api

        model = demucs.api.Separator(model="htdemucs_ft")

        os.makedirs(output_dir, exist_ok=True)
        _, separated = model.separate_audio_file(file_path)

        stem_paths: dict[str, str] = {}
        track_name = os.path.splitext(os.path.basename(file_path))[0]

        for stem_name, waveform in separated.items():
            out_path = os.path.join(output_dir, f"{track_name}_{stem_name}.wav")
            demucs.api.save_audio(waveform, out_path, samplerate=model.samplerate)
            stem_paths[stem_name] = out_path

        _update_job(job_id, status="complete", stems=stem_paths)
        print(f"[ML] Stem separation complete for job {job_id}")

    except ImportError:
        _update_job(job_id, status="failed", error="demucs not installed")
    except Exception as e:
        print(f"[ML] Stem separation error for job {job_id}: {e}")
        _update_job(job_id, status="failed", error=str(e))


def _update_job(job_id: str, **kwargs) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)


def get_job_status(job_id: str) -> dict | None:
    with _lock:
        return dict(_jobs.get(job_id, None) or {}) or None


def cleanup_old_jobs(max_age_seconds: float = 3600) -> None:
    """Prune jobs older than max_age_seconds from memory."""
    now = time.time()
    with _lock:
        to_delete = [jid for jid, j in _jobs.items() if now - j["created_at"] > max_age_seconds]
        for jid in to_delete:
            del _jobs[jid]
