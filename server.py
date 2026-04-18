import base64
import io
import logging
import os
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter, convolve

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HF_TOKEN: Optional[str] = os.environ.get("HF_TOKEN") or None
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

app = FastAPI(title="pseudo3d-parallax V2.1 server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 5×5 Sobel kernels (same as JS implementation) ────────────────────────────
_SOBEL_X = np.array([
    [-1, -2, -3, -2, -1],
    [-2, -4, -6, -4, -2],
    [ 0,  0,  0,  0,  0],
    [ 2,  4,  6,  4,  2],
    [ 1,  2,  3,  2,  1],
], dtype=np.float32).T   # transposed: X gradient → horizontal

_SOBEL_Y = np.array([
    [-1, -2, -3, -2, -1],
    [-2, -4, -6, -4, -2],
    [ 0,  0,  0,  0,  0],
    [ 2,  4,  6,  4,  2],
    [ 1,  2,  3,  2,  1],
], dtype=np.float32)     # Y gradient → vertical


def _pil_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _depth_map(img: Image.Image) -> np.ndarray:
    """
    Sharpness-based depth estimation.
    Convention: white (1.0) = near/foreground, black (0.0) = far/background.

    Strategy: in-focus areas have high local sharpness → treated as near.
    Combined with a center-weight bias (subject usually at center).
    """
    gray = np.array(img.convert("L"), dtype=np.float32) / 255.0
    h, w = gray.shape

    # High-frequency content = sharpness = focus = near
    blurred = gaussian_filter(gray, sigma=2.0)
    hf = np.abs(gray - blurred)

    # Local variance of high-frequency (= local sharpness map)
    size = max(11, min(w, h) // 30) | 1   # odd window, ~3% of smallest dim
    mean_hf = uniform_filter(hf, size=size)
    mean_sq = uniform_filter(hf ** 2, size=size)
    sharpness = np.sqrt(np.maximum(0.0, mean_sq - mean_hf ** 2))

    # Gaussian center-weight bias: assume subject is roughly centered
    y_idx, x_idx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.sqrt(((x_idx / w - 0.5) * 2) ** 2 + ((y_idx / h - 0.5) * 2) ** 2)
    center_w = np.exp(-dist * 1.5)

    # Combine sharpness (dominant) + center bias
    depth = sharpness * 0.75 + center_w * 0.25

    # Smooth to fill holes and reduce noise
    depth = gaussian_filter(depth, sigma=max(3, min(w, h) // 80))

    # Normalise to [0, 1]
    lo, hi = depth.min(), depth.max()
    depth = (depth - lo) / (hi - lo + 1e-6)

    return depth.astype(np.float32)


def _normal_map(depth: np.ndarray) -> np.ndarray:
    """5×5 Sobel surface normals. white (1.0) depth = near convention."""
    h, w = depth.shape
    scale = max(2.0, 800.0 / max(w, h)) * 12.0

    gx = convolve(depth, _SOBEL_X, mode="nearest")
    gy = convolve(depth, _SOBEL_Y, mode="nearest")

    nx = (-gx * scale).astype(np.float32)
    ny = (-gy * scale).astype(np.float32)
    nz = np.full_like(nx, 52.0)
    length = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    length = np.maximum(length, 1e-6)

    r = ((nx / length) * 0.5 + 0.5) * 255
    g = ((ny / length) * 0.5 + 0.5) * 255
    b = ((nz / length) * 0.5 + 0.5) * 255
    return np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)


def _ao_map(depth: np.ndarray) -> np.ndarray:
    """
    Ambient occlusion from depth concavities.
    Crevices (local depth below surroundings) → dark; exposed surfaces → bright.
    Uses a wider radius and stronger range than the JS version for server-side maps.
    """
    r = max(5, round(min(depth.shape) * 0.015))
    size = 2 * r + 1

    mean = uniform_filter(depth, size=size)
    mean_sq = uniform_filter(depth ** 2, size=size)
    variance = np.maximum(0.0, mean_sq - mean ** 2)

    # How much this pixel is below its neighbourhood average → concavity
    concavity = np.maximum(0.0, mean - depth)

    # AO = combination of variance (surface roughness) and concavity
    raw_ao = np.sqrt(variance) * 1.5 + concavity * 3.0

    # Normalise and invert: bright = exposed, dark = occluded
    ao_norm = raw_ao / (raw_ao.max() + 1e-6)
    ao = 1.0 - np.minimum(ao_norm * 0.7, 0.7)   # up to 70% darkening

    v = (ao * 255).clip(0, 255).astype(np.uint8)
    return np.stack([v, v, v], axis=-1)


def _process_image(img: Image.Image) -> dict:
    orig_size = img.size
    up_w, up_h = orig_size[0] * 2, orig_size[1] * 2
    upscaled = img.resize((up_w, up_h), Image.LANCZOS)

    depth = _depth_map(img)
    normal_rgb = _normal_map(depth)
    ao_rgb = _ao_map(depth)

    depth_uint8 = (depth * 255).clip(0, 255).astype(np.uint8)
    depth_img = Image.fromarray(np.stack([depth_uint8] * 3, axis=-1))
    normal_img = Image.fromarray(normal_rgb)
    ao_img = Image.fromarray(ao_rgb)

    return {
        "upscale": _pil_to_b64(upscaled),
        "depth":   _pil_to_b64(depth_img),
        "normal":  _pil_to_b64(normal_img),
        "ao":      _pil_to_b64(ao_img),
        "source":  "local",
    }


@app.get("/health")
async def health():
    return {"status": "ok", "hf_token": bool(HF_TOKEN)}


@app.post("/process")
async def process(file: UploadFile):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        logger.error("Image decode error: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid or unreadable image file")

    try:
        result = _process_image(img)
        return JSONResponse(content=result)
    except Exception as exc:
        logger.error("Processing failed: %s", exc)
        raise HTTPException(status_code=500, detail="Image processing failed. Check server logs.")
