# pseudo3d-parallax — WebGL Parallax 3D Simulator

A browser-based proof of concept that simulates the visual effect of a **lenticular lens sheet** applied to a flat 2D image, creating a convincing depth-into-screen 3D illusion in real time.

Upload any image and the app generates depth, normal, and ambient occlusion maps — either through a **local V2 generative server** (Stable Diffusion img2img) or entirely in the browser using ONNX — then renders the parallax effect through a custom GLSL shader driven by your mouse, gyroscope, or webcam.

![Parallax demo](docs/parallax_demo.gif)

---

## Version History

### V1 — Browser-only ONNX pipeline

All processing ran entirely in the browser with no server. Depth maps were generated using **Depth Anything V2** via ONNX Runtime Web (`@huggingface/transformers`). Normal and AO maps were derived algorithmically from the depth map (5×5 Sobel kernel for normals, local depth variance for AO).

| Component | Implementation |
|---|---|
| Depth | Depth Anything V2 Base/Small (ONNX, ~90 MB, cached in browser) |
| Normal | 5×5 Sobel kernel from depth (CPU, JavaScript) |
| AO | Local variance from depth (CPU, JavaScript) |
| Upscale | None |

**Limitation:** Normals derived from depth miss fine surface detail. AO from variance is approximate.

### V2 — Local generative server (current)

A local Python server (`server.py`) runs at `localhost:8000` and processes images through a **Stable Diffusion img2img pipeline** using four targeted prompts. The browser probes `/v2/health` on load — if the server is running, all maps are generated generatively; otherwise the app silently falls back to V1.

| Component | Implementation |
|---|---|
| Upscale | SD img2img, strength 0.15 — faithful to original |
| Normal | SD img2img, strength 0.82 — `"normal map, RGB surface normals, tangent space…"` |
| Depth | SD img2img, strength 0.82 — `"depth map, grayscale, white near black far…"` |
| AO | SD img2img, strength 0.82 — `"ambient occlusion map, dark crevices…"` |

**Primary:** HuggingFace Inference API (`stabilityai/stable-diffusion-2-1`) — no local download if token is set.
**Fallback 1:** `segmind/tiny-sd` loaded locally (~450 MB, downloaded once on first use).
**Fallback 2:** V1 ONNX pipeline (automatic, if Python server is not running).

---

## Pipeline Visualization

| Original | Depth Map | Normal Map | AO Map |
|:---:|:---:|:---:|:---:|
| ![Original](docs/sample_image.png) | ![Depth](docs/sample_depth_map.png) | ![Normal](docs/sample_normal_map.png) | ![AO](docs/sample_AO_map.png) |

The **Depth Map** separates foreground (white/bright) from background (dark). The **Normal Map** encodes surface orientation as color — blues/purples face the camera, reds/greens face sideways. The **AO Map** reveals surface concavities as darker regions, adding perceived volume to the flat image.

---

## How It Works

### 1. Map Generation

When you upload an image, the app first probes the V2 Python server at `localhost:8000/v2/health`. If the server is running, all four maps (upscaled original, depth, normal, AO) are generated via **Stable Diffusion img2img**. If the server is not running, the app silently falls back to the V1 ONNX pipeline.

**V2 server pipeline** (primary):
- Runs `server.py` locally using FastAPI + Diffusers
- Uses the HuggingFace Inference API (`stabilityai/stable-diffusion-2-1`) if `HF_TOKEN` is set — no local download
- Falls back to `segmind/tiny-sd` (~450 MB, cached locally after first use)

**V1 ONNX fallback** (automatic if server not running):

The app runs **Depth Anything V2** locally in your browser using ONNX Runtime Web via `@huggingface/transformers`. The model is downloaded once (~90 MB) and cached in the browser. Normal and AO maps are derived algorithmically from the depth map.

**Model fallback chain** (V1, tries in order):
| Model | Size | Notes |
|---|---|---|
| `onnx-community/depth-anything-v2-base` | ~90 MB | Primary — best quality |
| `onnx-community/depth-anything-v2-small` | ~25 MB | Fallback |
| `Xenova/depth-anything-small-hf` | ~49 MB | Last resort |

### 2. Surface Map Generation (V1 CPU path)

From the depth map, two additional maps are computed on the CPU:

- **Normal Map** — derived from a 5×5 Sobel kernel applied at full resolution. Encodes surface orientation as RGB. Used for dynamic lighting that follows the viewer.
- **Ambient Occlusion Map** — derived from local depth variance. Darker in concavities, brighter on exposed surfaces. Adds perceived volume.

### 3. Parallax Rendering (WebGL / GLSL)

A Three.js full-screen quad renders all four maps through a custom GLSL shader:

- **Far-anchored parallax**: background (depth=1) stays fixed; foreground moves most. Displacement follows a quadratic curve `nearness = (1 - depth)²` so near objects feel strongly separated from the background.
- **Edge suppression**: depth discontinuities are detected via `dFdx/dFdy` and suppressed with `smoothstep` to prevent fringing artifacts at object boundaries.
- **Normal-map lighting**: a virtual light follows the viewer position, brightening surfaces facing the viewer and adding subtle depth cues.
- **AO contribution**: concavities are darkened proportionally to local variance, also suppressed at edges.
- **Movement cap**: parallax offset is hard-capped at ±0.35 to prevent visible smearing at extreme positions.

### 4. Tracking Modes

| Mode | How it works |
|---|---|
| 🖱 Mouse | Normalized cursor position across the viewport |
| 📱 Gyro | `DeviceOrientation` API — tilt the device |
| 📷 Webcam | Chrome 113+ `FaceDetector` API; motion-centroid fallback on other browsers |
| ▶ Animate | Automatic Lissajous figure-8 loop (0.18 Hz × 0.09 Hz) |

---

## Getting Started

### Option A — V2 generative pipeline (recommended)

```bash
# Terminal 1 — Python server (reads HF_TOKEN from .env.local automatically)
pip install -r requirements.txt
./start_server.sh
```

```bash
# Terminal 2 — Vite dev server
npm install
npm run dev
```

Open `http://localhost:5173`. Maps are generated by the Python server using the HF API or the local TinySD model.

### Option B — Browser-only / V1 fallback

```bash
npm install
npm run dev
```

If the Python server is not running, the app automatically falls back to the V1 ONNX pipeline (Depth Anything V2, ~90 MB, cached in browser on first load).

### Running Tests

```bash
npm test
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Rendering | [Three.js](https://threejs.org/) r160, WebGL, GLSL ES |
| V2 map generation | Python FastAPI + Stable Diffusion img2img (HF API / TinySD local) |
| V1 map generation | [@huggingface/transformers](https://github.com/huggingface/transformers.js) (ONNX Runtime Web) |
| UI | React 18, inline styles |
| Build | Vite 5 |
| Tests | Vitest + Testing Library (58 tests) |

---

## Project Structure

```
server.py                        # V2 Python server (FastAPI + SD img2img pipeline)
requirements.txt                 # Python dependencies
start_server.sh                  # Server launcher (reads token from .env.local)
src/
├── App.jsx                      # Root component, state management
├── components/
│   ├── ParallaxRenderer.js      # Three.js WebGL renderer + uniforms
│   ├── DepthMapGenerator.js     # V2 server → V1 ONNX → heuristic pipeline
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
├── resources/                   # Demo image + sample maps
└── tests/
    ├── unit/                    # mathUtils, shader config, animation params
    ├── integration/             # Depth pipeline + model fallback
    └── component/               # App preload + overlay behavior
```

---

## Key Shader Parameters

These values are locked by the test suite — changing them will cause test failures, signaling an intentional configuration change.

| Parameter | Value | Effect |
|---|---|---|
| `uSensitivity` | 2.2 | Global parallax strength multiplier |
| Strength formula | `nearness × edgeFactor × 0.04` | Per-pixel displacement scale |
| `uLightStrength` | 0.12 | Normal map lighting intensity |
| AO factor | `× 0.4` | AO contribution weight |
| Parallax cap | ±0.35 | Max offset before edge smearing |
| Edge smoothstep | `(0.006, 0.02)` | Depth discontinuity suppression range |
| Nearness curve | `pow(1 - depth, 2.0)` | Quadratic depth-to-displacement mapping |

---

## Browser Support

| Browser | Mouse | Gyro | Webcam (FaceDetector) |
|---|---|---|---|
| Chrome 113+ | ✓ | ✓ | ✓ |
| Chrome Android | ✓ | ✓ | ✓ |
| Firefox | ✓ | ✓ | motion fallback |
| Safari iOS 15+ | ✓ | ✓* | motion fallback |

*iOS requires a permission prompt for `DeviceOrientation` — handled automatically.

---

## Limitations

- V2 server must be running locally for generative maps; the app silently falls back to V1 ONNX if not running.
- TinySD first load downloads ~450 MB; subsequent runs use the cached model.
- SD img2img generation takes 5–30 s depending on hardware (GPU recommended).
- The depth model (V1 ONNX fallback) runs in the main thread — large images may cause a brief pause.
- Webcam face tracking requires Chrome 113+ for the native `FaceDetector` API; other browsers use a motion-centroid fallback.
- Parallax is a 2D illusion — extreme viewing angles reveal the flat nature of the source image.
- Object boundary artifacts can appear where depth changes abruptly; edge-masked blur and shader edge suppression minimize but do not eliminate this.
