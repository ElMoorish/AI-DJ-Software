---
license: mit
tags:
- audio
- dj
- machine-learning
- music-genre-classification
- onnx
- pytorch
datasets:
- gtzan
- fma
metrics:
- accuracy
---

# AI DJ Software: ML Model Reservoir 🎧

This repository hosts the official machine learning models for the **[AI-DJ-Software](https://github.com/ElMoorish/AI-DJ-Software)** project. These models power the application's core capabilities, including automated mixing, harmonic sequencing, and genre-specific transitions.

## 🚀 Model Overview

Everything here is optimized for **offline, low-latency performance** using **ONNX Runtime (int8 quantization)**.

### 1. General Genre & Audio Analysis
*   **Genre CNN (v1.2.0)**: Dual-path CNN for classifying 10 base genres. 
*   **Mood HuBERT (v1.0.3)**: HuBERT-distilled classifier for semantic mood detection (6 classes).
*   **CLAP Audio Encoder**: Generates 512-dimensional embeddings for similarity search.
*   **Beat Detector (v1.0.0)**: TCN-based onset tracking and beatgrid estimation.

### 2. Subgenre Specialists (Proprietary Training)
We provide fine-tuned specialist models for nuanced subgenre classification, critical for high-energy sets:
*   **Brazilian Funk Specialist**: Detecting Carioca, Mandelão, and Automotivo.
*   **Phonk Specialist**: Splitting American and Brazilian Phonk.
*   **Bass & Trap Specialist**: Sub-bass energy detection.
*   **Techno, Trance, House Specialists**: High-accuracy BPM and structure awareness.

## 📦 How to Use

These models are designed to be consumed by the **AI DJ Desktop Application**.

1. **Manual Download**: Place the `.onnx` and `.onnx.data` (plus `.json` label maps) into your local `ml-sidecar/models/` directory.
2. **CLI Usage**:
   ```bash
   # Use the Hugging Face CLI to pull the full repo
   hf download Themoor/Ai-DJ-Mixer . --local-dir path/to/ai-dj/ml-sidecar/models
   ```

## 🛠 Model Technical Details

| Model | Format | Precision | Size | Purpose |
|-------|--------|-----------|------|---------|
| Specialists | ONNX | Int8 | ~345MB | Granular Subgenre Logic |
| Genre CNN | ONNX | Int8 | 12.4MB | Global Genre Tags |
| CLAP | ONNX | FP32/Int8 | 142MB | Similarity Embeddings |
| HuBERT Mood | ONNX | Int8 | 89MB | Mood-based Sequencing |

## 📜 License & Credits

*   **Software**: MIT License.
*   **Models**: Released under Open Source for the DJ community.
*   **Training**: Powered by PyTorch and fine-tuned on custom datasets.

Developed by **[Moorish.dev](https://www.moorish.dev)**.
