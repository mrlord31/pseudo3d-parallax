"""
pseudo3d-parallax V2.1 server — instruct-pix2pix local inference.

Requires the model to be downloaded (~2.1 GB fp16):
    python download_model.py

Then start with:
    ./start_server.sh
"""
import base64
import io
import logging
import os
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HF_TOKEN: Optional[str] = os.environ.get("HF_TOKEN") or None
MODEL_ID = "timbrooks/instruct-pix2pix"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
INFERENCE_STEPS = 7  # 5-8 is enough for map generation

PROMPTS = {
    "upscale": (
        "Make this a sharp, high-resolution photograph. "
        "Preserve all details, colours and composition faithfully."
    ),
    "depth": (
        "Convert this image into a greyscale depth map. "
        "Paint near objects white and distant background black. "
        "Use smooth gradients to show depth transitions."
    ),
    "normal": (
        "Convert this image into a surface normal map. "
        "Encode normals as RGB: red=X, green=Y, blue=Z. "
        "Flat surfaces facing the camera should be blue-purple."
    ),
    "ao": (
        "Convert this image into an ambient occlusion map. "
        "Paint concave areas, crevices and corners dark grey. "
        "Paint exposed, convex surfaces bright white."
    ),
}

# ── Model state ───────────────────────────────────────────────────────────────
_pipeline = None
_pipeline_error: Optional[str] = None
_pipeline_lock = threading.Lock()


def _is_model_cached() -> bool:
    cache = Path.home() / ".cache" / "huggingface" / "hub"
    model_dir = cache / "models--timbrooks--instruct-pix2pix"
    return model_dir.exists() and any(model_dir.rglob("*.safetensors"))


def _load_pipeline() -> None:
    """Load the pipeline into memory (called once, thread-safe)."""
    global _pipeline, _pipeline_error
    with _pipeline_lock:
        if _pipeline is not None:
            return
        try:
            import torch
            from diffusers import StableDiffusionInstructPix2PixPipeline

            logger.info("Loading instruct-pix2pix pipeline (fp16, CPU)…")
            pipe = StableDiffusionInstructPix2PixPipeline.from_pretrained(
                MODEL_ID,
                torch_dtype=torch.float16,
                safety_checker=None,
                requires_safety_checker=False,
            )
            pipe.enable_attention_slicing()
            _pipeline = pipe
            logger.info("Pipeline ready.")
        except Exception as exc:
            _pipeline_error = str(exc)
            logger.error("Pipeline load failed: %s", exc)
            raise


# Kick off background model load on startup so first request doesn't wait cold
def _preload_in_background() -> None:
    if _is_model_cached():
        t = threading.Thread(target=_load_pipeline, daemon=True)
        t.start()
    else:
        logger.warning(
            "Model not cached — run `python download_model.py` to download it."
        )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pil_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _resize_to_512(img: Image.Image) -> Image.Image:
    w, h = img.size
    if w >= h:
        new_w, new_h = 512, max(1, int(h * 512 / w))
    else:
        new_w, new_h = max(1, int(w * 512 / h)), 512
    return img.resize((new_w, new_h), Image.LANCZOS)


# ── Inference ─────────────────────────────────────────────────────────────────

def _run_pix2pix(img: Image.Image) -> dict:
    if _pipeline is None:
        if _pipeline_error:
            raise RuntimeError(f"Model failed to load: {_pipeline_error}")
        # Model cached but not yet loaded (background thread still warming up)
        _load_pipeline()

    orig_size = img.size
    img512 = _resize_to_512(img)

    results = {}
    for key, prompt in PROMPTS.items():
        logger.info("Generating '%s'…", key)
        out = _pipeline(
            prompt=prompt,
            image=img512,
            num_inference_steps=INFERENCE_STEPS,
            image_guidance_scale=1.5,
            guidance_scale=7.5,
        ).images[0]
        out = out.resize(orig_size, Image.LANCZOS)
        results[key] = _pil_to_b64(out)

    results["source"] = "pix2pix"
    return results


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="pseudo3d-parallax V2.2 server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    _preload_in_background()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "hf_token": bool(HF_TOKEN),
        "model_cached": _is_model_cached(),
        "model_ready": _pipeline is not None,
        "model_error": _pipeline_error,
    }


@app.post("/process")
async def process(file: UploadFile):
    if not _is_model_cached():
        raise HTTPException(
            status_code=503,
            detail=(
                "Model not downloaded. "
                "Run `python download_model.py` then restart the server."
            ),
        )

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        logger.error("Image decode error: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid or unreadable image file")

    try:
        import asyncio
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _run_pix2pix, img)
        return JSONResponse(content=result)
    except Exception as exc:
        logger.error("Inference failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}")
