"""
pseudo3d-parallax V2.2 server — instruct-pix2pix local inference.

Requires the model to be downloaded (~2.1 GB fp16):
    python download_model.py

Then start with:
    ./start_server.sh
"""
import asyncio
import base64
import io
import logging
import os
import threading
from contextlib import asynccontextmanager
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
INFERENCE_STEPS = 3       # balance speed vs quality on CPU
INFERENCE_TIMEOUT = 300   # seconds — fail fast if hardware is too slow

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
_current_step: dict = {"map": None, "step": 0, "total": 0}


def _is_model_cached() -> bool:
    cache = Path.home() / ".cache" / "huggingface" / "hub"
    model_dir = cache / "models--timbrooks--instruct-pix2pix"
    return model_dir.exists() and any(model_dir.rglob("*.safetensors"))


def _load_pipeline() -> None:
    """Load the pipeline into memory once, thread-safe."""
    global _pipeline, _pipeline_error
    with _pipeline_lock:
        if _pipeline is not None:
            return
        try:
            import torch
            from diffusers import StableDiffusionInstructPix2PixPipeline

            torch.set_num_threads(os.cpu_count() or 4)
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


def _preload_in_background() -> None:
    """Start loading the model in the background so first request isn't cold."""
    if _is_model_cached():
        threading.Thread(target=_load_pipeline, daemon=True).start()
    else:
        logger.warning("Model not cached — run `python download_model.py` first.")


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
    global _current_step
    if _pipeline is None:
        if _pipeline_error:
            raise RuntimeError(f"Model failed to load: {_pipeline_error}")
        _load_pipeline()

    orig_size = img.size
    img512 = _resize_to_512(img)
    results = {}

    for key, prompt in PROMPTS.items():
        _current_step = {"map": key, "step": 0, "total": INFERENCE_STEPS}
        logger.info("Generating '%s' (%d steps)…", key, INFERENCE_STEPS)

        def _callback(pipe, step, timestep, kwargs):
            _current_step["step"] = step + 1
            logger.info("  %s step %d/%d", key, step + 1, INFERENCE_STEPS)
            return kwargs

        out = _pipeline(
            prompt=prompt,
            image=img512,
            num_inference_steps=INFERENCE_STEPS,
            image_guidance_scale=1.5,
            guidance_scale=7.5,
            callback_on_step_end=_callback,
        ).images[0]
        out = out.resize(orig_size, Image.LANCZOS)
        results[key] = _pil_to_b64(out)

    _current_step = {"map": None, "step": 0, "total": 0}
    results["source"] = "pix2pix"
    return results


# ── FastAPI app ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _preload_in_background()
    yield

app = FastAPI(title="pseudo3d-parallax V2.2 server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "hf_token": bool(HF_TOKEN),
        "model_cached": _is_model_cached(),
        "model_ready": _pipeline is not None,
        "model_error": _pipeline_error,
    }


@app.get("/status")
async def status():
    """Current inference progress — poll this while /process is running."""
    s = _current_step
    maps = list(PROMPTS.keys())
    map_idx = maps.index(s["map"]) if s["map"] in maps else -1
    total_steps = len(maps) * (s["total"] or INFERENCE_STEPS)
    done_steps = max(0, map_idx) * (s["total"] or INFERENCE_STEPS) + s["step"]
    return {
        "busy": s["map"] is not None,
        "current_map": s["map"],
        "map_step": s["step"],
        "map_total": s["total"],
        "overall_pct": round(done_steps / total_steps * 100) if total_steps else 0,
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
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(None, _run_pix2pix, img),
            timeout=INFERENCE_TIMEOUT,
        )
        return JSONResponse(content=result)
    except asyncio.TimeoutError:
        logger.error("Inference timeout after %ds", INFERENCE_TIMEOUT)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Inference exceeded {INFERENCE_TIMEOUT}s timeout. "
                "A GPU is recommended for interactive use."
            ),
        )
    except Exception as exc:
        logger.error("Inference failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}")
