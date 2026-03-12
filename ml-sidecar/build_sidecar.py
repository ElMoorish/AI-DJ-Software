#!/usr/bin/env python3
"""
build_sidecar.py — Build the ML sidecar executable using PyInstaller.

Run this ONCE after training is complete to create mlsidecar.exe
before packaging the Electron installer.

Usage:
    python ml-sidecar/build_sidecar.py
    python ml-sidecar/build_sidecar.py --check   # just verify deps exist
"""
import os
import sys
import subprocess
import shutil
import argparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
DIST_SIDECAR = os.path.join(SCRIPT_DIR, "dist", "mlsidecar")
SPEC_FILE = os.path.join(SCRIPT_DIR, "mlsidecar.spec")


def check_deps():
    ok = True
    print("Checking build dependencies...\n")

    # Check PyInstaller
    try:
        import PyInstaller
        print(f"  ✅ PyInstaller {PyInstaller.__version__}")
    except ImportError:
        print("  ❌ PyInstaller not found  →  pip install pyinstaller")
        ok = False

    # Check ONNX models
    required = ["macro_specialist_int8.onnx", "house_specialist_int8.onnx"]
    for f in required:
        path = os.path.join(MODELS_DIR, f)
        if os.path.exists(path):
            mb = os.path.getsize(path) / 1024 / 1024
            print(f"  ✅ {f} ({mb:.1f} MB)")
        else:
            print(f"  ❌ {f}  ← not found (training still in progress?)")
            ok = False

    # Optional additional specialist models
    optional = [f for f in os.listdir(MODELS_DIR) if f.endswith(".onnx")] if os.path.exists(MODELS_DIR) else []
    extras = [f for f in optional if f not in required]
    for f in extras:
        print(f"  ✅ {f} (optional specialist)")

    # Check librosa
    try:
        import librosa
        print(f"  ✅ librosa {librosa.__version__}")
    except ImportError:
        print("  ❌ librosa not found  →  pip install librosa")
        ok = False

    # Check onnxruntime
    try:
        import onnxruntime as ort
        print(f"  ✅ onnxruntime {ort.__version__}")
    except ImportError:
        print("  ❌ onnxruntime not found  →  pip install onnxruntime")
        ok = False

    print()
    return ok


def build():
    print("=" * 60)
    print("🔨 Building ML Sidecar executable")
    print("=" * 60)

    if not check_deps():
        print("❌ Fix missing dependencies first.")
        sys.exit(1)

    # Install PyInstaller if needed
    try:
        import PyInstaller  # noqa
    except ImportError:
        print("Installing PyInstaller...")
        subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)

    # Clean previous build
    build_dir = os.path.join(SCRIPT_DIR, "build")
    if os.path.exists(DIST_SIDECAR):
        print(f"Cleaning previous build: {DIST_SIDECAR}")
        shutil.rmtree(DIST_SIDECAR)

    # Run PyInstaller
    print("\nRunning PyInstaller...")
    result = subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--clean", SPEC_FILE],
        cwd=SCRIPT_DIR,
    )

    if result.returncode != 0:
        print("❌ PyInstaller failed!")
        sys.exit(1)

    # Verify output
    exe_name = "mlsidecar.exe" if sys.platform == "win32" else "mlsidecar"
    exe_path = os.path.join(DIST_SIDECAR, exe_name)

    if os.path.exists(exe_path):
        size_mb = os.path.getsize(exe_path) / 1024 / 1024
        print(f"\n✅ Built: {exe_path} ({size_mb:.0f} MB)")
        print(f"\nNext steps:")
        print(f"  1. Run: npm run dist:win")
        print(f"  2. The installer will be in: release/")
    else:
        print(f"❌ Expected output not found: {exe_path}")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Only check deps, don't build")
    args = parser.parse_args()

    if args.check:
        ok = check_deps()
        sys.exit(0 if ok else 1)
    else:
        build()
