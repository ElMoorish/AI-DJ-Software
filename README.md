<div align="center">
  <img src="https://raw.githubusercontent.com/electron-react-boilerplate/electron-react-boilerplate/main/assets/logo.svg" alt="AI DJ Logo" width="120" />
  <h1>🎛️ AI DJ</h1>
  <p><strong>An open-source, AI-native desktop DJ application running entirely locally.</strong></p>
  
  <p>
    <a href="#-features"><img src="https://img.shields.io/badge/Features-Local_ML-6c63ff?style=for-the-badge&logo=pytorch" alt="Features" /></a>
    <a href="#-tech-stack"><img src="https://img.shields.io/badge/Tech-Electron_%7C_React-00d4ff?style=for-the-badge&logo=react" alt="Tech" /></a>
    <a href="#-open-source-visibility"><img src="https://img.shields.io/badge/Open-Source-brightgreen?style=for-the-badge" alt="Open Source" /></a>
  </p>
</div>

<br />

<div align="center">
  <!-- Place your actual recorded UI GIF here! -->
  <img src="https://via.placeholder.com/800x450/111118/00d4ff?text=++[Drop+your+Animated+UI+GIF+Here]++" alt="AI DJ Demo" width="100%" style="border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);" />
</div>

---

## 🚀 The Concept

**AI DJ** brings sophisticated machine learning to automated playlist generation and micro-genre classification. Unlike cloud-based solutions, this app is **Offline-First & SOC2 Compliant**—all audio analysis, AI inference, and rendering happen directly on your machine. Zero audio data leaves your device.

<div align="center">
  <img src="https://via.placeholder.com/600x200/16161f/6c63ff?text=++[Insert+Mixer/Waveform+Animation]++" alt="Mixer View" style="border-radius: 8px;" />
</div>

## 🧠 Model Weights

To keep the repository lightweight, the pre-trained ONNX models are hosted on **Hugging Face**.

1. **Download the models** from: [Themoor/Ai-DJ-Mixer](https://huggingface.co/Themoor/Ai-DJ-Mixer)
2. Place all `.onnx`, `.onnx.data`, and `.json` files into the `ml-sidecar/models/` directory.

### Quick Install (Cli)
If you have the HF CLI installed:
```bash
hf download Themoor/Ai-DJ-Mixer --local-dir ml-sidecar/models
```

## ✨ Key Features

### 🧠 Hierarchical Genre Classification (AST)
Powered by MIT's **Audio Spectrogram Transformer**, a macro model routes your tracks to highly specialized, custom-trained subgenre models:
*   🔥 **Brazilian Funk** — Discriminates between *Carioca, Mandelão, Automotivo, 150BPM, Brega Funk, and Ostentação.*
*   💀 **Phonk** — Identifies *American Phonk* vs *Brazilian Phonk* crossovers.
*   🎛️ **House & Techno** — Sorts into 14 distinct underground subgenres (Peak Time, Acid, Slap, Minimal, etc.)

### 🎚️ Intelligent Mix Sequencer
An AI **lookahead tree search** selects the perfect next track based on:
*   **Camelot Wheel Harmonic Mixing** 🎶
*   **BPM Compatibility** ⏱️
*   **Energy / Mood Arcs** 📈 (Build, Peak, Cool-down, Wave)

### 🎧 FFmpeg Render Engine
Generates flawless, gapless MP3 mixes complete with professional DJ transitions including **EQ sweeps, echo-outs, and backspins**.

### 🔍 Semantic Audio Search
Powered by 512-dim **CLAP embeddings**, allowing you to search your local library using text prompts like *"dark driving bass"* or *"melodic euphoric vocals"*.

---

## 🛠️ Tech Stack

| Domain | Technologies |
| :--- | :--- |
| **Frontend** | Electron, React 18, Vite, TypeScript, Zustand, TailwindCSS |
| **Backend** | Node.js (Main Process), better-sqlite3 (WAL mode) |
| **ML Sidecar** | Python 3.11, FastAPI, ONNX Runtime, librosa, PyTorch |
| **Audio Engine** | FFmpeg, FFprobe (Local binaries) |

---

## ⚡ Getting Started

### Prerequisites
*   Node.js 18+
*   Python 3.11+
*   FFmpeg installed and available in your system `PATH`
*   *(Optional but recommended)* NVIDIA GPU for CUDA-accelerated inference.

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ElMoorish/AI-DJ-Software.git
   cd ai-dj
   ```

2. **Install Frontend Dependencies:**
   ```bash
   npm install
   ```

3. **Setup the Python ML Sidecar:**
   We use a dedicated virtual environment for the heavy lifting.
   ```bash
   cd ml-sidecar
   python -m venv venv
   
   # Windows
   source venv/Scripts/activate
   # Mac/Linux
   # source venv/bin/activate
   
   pip install -r requirements.txt
   ```

4. **Pull the ONNX Models (Git LFS):**
   This repository uses Git LFS to host the pre-trained `_int8.onnx` models. Ensure you have [Git LFS installed](https://git-lfs.com/), then run:
   ```bash
   git lfs pull
   ```

5. **Run the App:**
   ```bash
   cd ..
   npm run electron:dev
   ```

---

## 📈 Open Source Visibility & Forking

This project builds upon the shoulders of giants in the audio ML notation and Electron communities. If you are discovering this project and want to help increase its visibility, please consider starring ⭐ this repository and exploring our upstream inspirations:

*   [LAION-AI/CLAP](https://github.com/LAION-AI/CLAP) — The incredible contrastive language-audio pretraining ecosystem.
*   [electron-react-boilerplate](https://github.com/electron-react-boilerplate/electron-react-boilerplate) — The rock-solid foundation for our desktop shell.
*   [Mixxx](https://github.com/mixxxdj/mixxx) — The legendary open-source DJ software that paved the way.

**Want to train your own models?** The repository includes our custom scraping and training pipeline (`auto_scrape_edm.py` and `train_specialist_ast.py`) to fine-tune the AST models on your own granular subgenres using SoundCloud data!

---
<div align="center">
  <i>Built with 🎵 by modern DJs, for modern DJs.</i>
</div>
