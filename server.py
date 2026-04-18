import base64
import io
import logging
import os
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageFilter

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


def _pil_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _depth_map(img: Image.Image) -> np.ndarray:
    """Luminance-based depth: bright/saturated pixels → near (1.0), dark → far (0.0)."""
    gray = np.array(img.convert("L"), dtype=np.float32) / 255.0
    # Soft blur to reduce noise before treating as depth signal
    gray_pil = Image.fromarray((gray * 255).astype(np.uint8))
    blurred = np.array(gray_pil.filter(ImageFilter.GaussianBlur(radius=3)), dtype=np.float32) / 255.0
    # Normalise to [0, 1]
    lo, hi = blurred.min(), blurred.max()
    if hi > lo:
        depth = (blurred - lo) / (hi - lo)
    else:
        depth = blurred
    return depth  # shape (H, W), float32


def _normal_map(depth: np.ndarray) -> np.ndarray:
    """Sobel surface normals from depth array, packed to uint8 RGB."""
    h, w = depth.shape
    scale = max(2.0, 800.0 / max(w, h)) * 12.0

    # Sobel kernels via finite differences (equivalent to JS 5×5 Sobel)
    gx = np.zeros_like(depth)
    gy = np.zeros_like(depth)
    p = np.pad(depth, 2, mode="edge")
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            w_x = dx * max(1, 3 - abs(dy))  # rough Sobel weight
            w_y = dy * max(1, 3 - abs(dx))
            patch = p[2 + dy : 2 + dy + h, 2 + dx : 2 + dx + w]
            gx += w_x * patch
            gy += w_y * patch

    nx = (-gx * scale).astype(np.float32)
    ny = (-gy * scale).astype(np.float32)
    nz = np.full_like(nx, 52.0)
    length = np.sqrt(nx**2 + ny**2 + nz**2)
    length = np.maximum(length, 1e-6)

    r = ((nx / length) * 0.5 + 0.5) * 255
    g = ((ny / length) * 0.5 + 0.5) * 255
    b = ((nz / length) * 0.5 + 0.5) * 255
    rgb = np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)
    return rgb


def _ao_map(depth: np.ndarray) -> np.ndarray:
    """Local variance AO: crevices darken by up to 15%."""
    from scipy.ndimage import uniform_filter  # scipy included via numpy deps

    r = max(3, round(min(depth.shape) * 0.006))
    mean = uniform_filter(depth, size=2 * r + 1)
    mean_sq = uniform_filter(depth**2, size=2 * r + 1)
    variance = np.maximum(0.0, mean_sq - mean**2)
    ao = 1.0 - np.minimum(np.sqrt(variance) * 2.5, 0.15)
    v = (ao * 255).clip(0, 255).astype(np.uint8)
    rgb = np.stack([v, v, v], axis=-1)
    return rgb


def _process_image(img: Image.Image) -> dict:
    orig_size = img.size
    # Upscale 2× with LANCZOS then return — keeps full resolution while sharpening
    up_w, up_h = orig_size[0] * 2, orig_size[1] * 2
    upscaled = img.resize((up_w, up_h), Image.LANCZOS)

    depth = _depth_map(img)

    try:
        normal_rgb = _normal_map(depth)
        ao_rgb = _ao_map(depth)
        use_scipy = True
    except ImportError:
        # scipy not available — fallback normal/ao via PIL
        use_scipy = False
        normal_rgb = _normal_map(depth)
        ao_rgb = (np.full((*depth.shape, 3), 230, dtype=np.uint8))

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
