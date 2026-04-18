# pseudo3d-parallax — WebGL Parallax 3D Simulator

A browser-based proof of concept that simulates the visual effect of a **lenticular lens sheet** applied to a flat 2D image, creating a convincing depth-into-screen 3D illusion in real time.

Upload any image. The app sends it to a local Python server that runs **instruct-pix2pix** (Stable Diffusion img2img) to generate depth, normal, AO, and upscale maps via targeted prompts. The resulting maps are rendered through a custom GLSL shader driven by your mouse, gyroscope, or webcam.

---

## Version History

### V1 — Browser-only ONNX pipeline
All processing ran in the browser using **Depth Anything V2** via ONNX Runtime Web. Normal and AO maps were derived algorithmically from the depth map.

### V2 — HuggingFace Inference API
A local Python server called the HF Inference API (`instruct-pix2pix`) to generate all maps generatively. Removed in V2.1 after the free HF API discontinued support for image-to-image inference providers.

### V2.1 — HF API only, no fallback
Removed V1 ONNX pipeline and local model fallback. Server called HF API directly. Removed when HF dropped free-tier image-to-image support entirely.

### V2.2 — Local instruct-pix2pix (current)
Replaced the broken HF API with a fully local **`timbrooks/instruct-pix2pix`** pipeline. Model is downloaded once (~2.1 GB fp16) and cached. All inference runs on-device via `diffusers`. Fixed depth convention to `white = near, black = far`. Added `/status` endpoint for real-time inference progress polling. Added inference timeout (300 s) with a clear GPU-required error if exceeded.

| Component | Implementation |
|---|---|
| Upscale | instruct-pix2pix — `"Make this a sharp high-resolution photograph…"` |
| Depth | instruct-pix2pix — `"Depth map, white near, black far…"` |
| Normal | instruct-pix2pix — `"Surface normal map, RGB-encoded…"` |
| AO | instruct-pix2pix — `"Ambient occlusion map, dark crevices…"` |

**Depth convention:** `depth = 1 (white)` → near/foreground · `depth = 0 (black)` → far/background

**Hardware note:** instruct-pix2pix on CPU is slow (~5–15 min per image with 3 steps). A GPU is strongly recommended for interactive use. The server auto-cancels inference after 300 s and returns a clear error.

---

## Getting Started

### 1. Download the model (one time, ~2.1 GB)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python download_model.py
```

### 2. Start the Python server

```bash
./start_server.sh
```

Reads `HF_TOKEN` from `.env.local` (optional — not required for local inference). Model loads into memory on startup (~25 s). Server runs at `http://localhost:8000`.

### 3. Start the frontend

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

### Running Tests

```bash
# JavaScript (unit + integration + component)
npm test

# Python E2E — server must be running
.venv/bin/pytest test_server.py -v
```

---

## Architecture

```
Image upload
    │
    ▼
DepthMapGenerator.js
    ├── probes /v2/health (1.5 s timeout)
    ├── POST /v2/process  ──────────────► server.py (FastAPI)
    │       polls /v2/status every 2 s        └── instruct-pix2pix (local, fp16)
    │                                               ├── upscale prompt
    │                                               ├── depth prompt
    │                                               ├── normal prompt
    │                                               └── ao prompt
    └── returns { upscaledUrl, depthUrl, normalUrl, aoUrl }
            │
            ▼
    ParallaxRenderer.js
        └── GLSL shader (parallax + normal lighting + AO)
```

---

## Pipeline Visualization

| Original | Depth Map | Normal Map | AO Map |
|:---:|:---:|:---:|:---:|
| ![Original](docs/sample_image.png) | ![Depth](docs/sample_depth_map.png) | ![Normal](docs/sample_normal_map.png) | ![AO](docs/sample_AO_map.png) |

---

## How the Parallax Shader Works

A Three.js full-screen quad renders through `parallax.frag.glsl`:

- **Convention:** `depth=1` (white) = near/foreground moves most; `depth=0` (black) = far/background stays fixed.
- **Displacement:** `nearness = pow(depth, 2.0)` — quadratic so near objects dominate.
- **Edge suppression:** `dFdx/dFdy` detects depth discontinuities; `smoothstep(0.006, 0.02)` suppresses fringing.
- **Normal-map lighting:** virtual light follows viewer position, brightening surfaces facing the viewer.
- **AO:** concavities darkened proportionally, suppressed at edges to prevent halos.

---

## Tracking Modes

| Mode | How it works |
|---|---|
| 🖱 Mouse | Normalized cursor position across the viewport |
| 📱 Gyro | `DeviceOrientation` API — tilt the device |
| 📷 Webcam | Chrome 113+ `FaceDetector` API; motion-centroid fallback on other browsers |
| ▶ Animate | Automatic Lissajous figure-8 loop (0.18 Hz × 0.09 Hz) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Rendering | Three.js r160, WebGL, GLSL ES |
| Map generation | Python FastAPI + `diffusers` (instruct-pix2pix fp16) |
| UI | React 18, inline styles |
| Build | Vite 5 |
| JS Tests | Vitest + Testing Library |
| Python Tests | pytest + httpx (E2E server connectivity) |

---

## Project Structure

```
server.py              # FastAPI server — instruct-pix2pix inference
download_model.py      # One-time model download script
start_server.sh        # Server launcher (loads HF_TOKEN from .env.local)
requirements.txt       # Python deps (torch, diffusers, transformers, accelerate)
test_server.py         # Python E2E tests (server health + connectivity)
src/
├── App.jsx                      # Root component, state management
├── components/
│   ├── ParallaxRenderer.js      # Three.js WebGL renderer + uniforms
│   ├── DepthMapGenerator.js     # Server probe + map fetch + status polling
│   ├── HeadTracker.js           # Mouse / gyro / webcam tracking
│   ├── Controls.jsx             # Side panel UI
│   └── ImageLoader.jsx          # Drag-and-drop image input
├── shaders/
│   ├── parallax.vert.glsl       # Pass-through vertex shader
│   ├── parallax.frag.glsl       # Main parallax + lighting shader
│   └── lenticular.frag.glsl    # Lenticular overlay function
├── utils/
│   ├── mathUtils.js             # lerp, clamp, smooth, smooth2D
│   └── imageUtils.js            # Image loading helpers
├── resources/                   # Demo image
└── tests/
    ├── unit/                    # mathUtils, shader config, animation params
    ├── integration/             # Depth pipeline integration
    └── component/               # App overlay behavior
```

---

## Limitations

- Inference on CPU is slow — expect 5–15 min per image (3 steps). A GPU dramatically reduces this.
- Server auto-cancels after 300 s and returns `503` with a clear message.
- instruct-pix2pix was not trained specifically for technical map generation — output quality varies by image content.
- Webcam face tracking requires Chrome 113+ for `FaceDetector`; other browsers use motion-centroid fallback.
- Parallax is a 2D illusion — extreme angles reveal the flat source image.
