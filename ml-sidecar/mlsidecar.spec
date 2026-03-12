# mlsidecar.spec — PyInstaller spec for the AI DJ ML sidecar executable
# Bundles Python + all ML dependencies + ONNX models into a standalone binary
#
# Build with:
#   pyinstaller mlsidecar.spec
#
# Output: dist/mlsidecar/mlsidecar.exe (Windows) or dist/mlsidecar/mlsidecar (Linux)

import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(SPEC))
MODELS_DIR = os.path.join(SCRIPT_DIR, 'models')

# Collect ONNX models to bundle (only .onnx files — .pt are not needed at runtime)
onnx_models = []
if os.path.exists(MODELS_DIR):
    for f in os.listdir(MODELS_DIR):
        if f.endswith('.onnx'):
            onnx_models.append((os.path.join(MODELS_DIR, f), 'models'))
        # Also bundle the manifest.json if it exists
        if f == 'manifest.json':
            onnx_models.append((os.path.join(MODELS_DIR, f), 'models'))

# Collect transformers model cache (AST feature extractor config)
transformers_data = collect_data_files('transformers', include_py_files=False)

a = Analysis(
    ['genre_infer.py'],          # main entry point script
    pathex=[SCRIPT_DIR],
    binaries=[],
    datas=[
        *onnx_models,            # ONNX models bundled in resources/models/
        *transformers_data,      # transformers tokenizer/config files
    ],
    hiddenimports=[
        'onnxruntime',
        'onnxruntime.capi._pybind_state',
        'librosa',
        'librosa.core',
        'librosa.feature',
        'soundfile',
        'scipy.signal',
        'scipy.ndimage',
        'sklearn',
        'numpy',
        'transformers',
        'transformers.models.audio_spectrogram_transformer',
        *collect_submodules('onnxruntime'),
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'torch',        # exclude PyTorch — we use ONNX only at runtime
        'torchvision',
        'torchaudio',
        'tensorflow',
        'keras',
        'matplotlib',
        'IPython',
        'jupyter',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Remove unnecessary large files from the bundle
EXCLUDE_SUFFIXES = ['.pyc', '.pyo', '.pyd.bak']
a.datas = [d for d in a.datas if not any(d[0].endswith(s) for s in EXCLUDE_SUFFIXES)]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='mlsidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,           # compress binary with UPX for smaller size
    console=True,       # console=True so Electron can read stdout/stderr
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='mlsidecar',
)
