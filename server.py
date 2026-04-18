import base64
import io
import logging
import os
import threading
from typing import Optional

import torch
from diffusers import StableDiffusionImg2ImgPipeline
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HF_TOKEN: Optional[str] = os.environ.get("HF_TOKEN") or None
HF_MODEL = "stabilityai/stable-diffusion-2-1"
LOCAL_MODEL = "segmind/tiny-sd"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

PROMPTS = {
    "upscale": (
        "photograph, highly detailed, sharp focus, 8k resolution, "
        "photorealistic, preserve original scene exactly, faithful upscale",
        0.15,
    ),
    "normal": (
        "normal map, RGB surface normals, tangent space, blue purple green "
        "color encoded orientation, 3D rendering normal map, flat lighting",
        0.82,
    ),
    "depth": (
        "depth map, grayscale, white near objects foreground, black far "
        "background, smooth depth gradient, no color",
        0.82,
    ),
    "ao": (
        "ambient occlusion map, grayscale, dark contact shadows crevices, "
        "bright exposed surfaces, cavity map, no color",
        0.82,
    ),
}

app = FastAPI(title="pseudo3d-parallax V2 server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_local_pipe: Optional[StableDiffusionImg2ImgPipeline] = None
_local_pipe_lock = threading.Lock()


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


def _run_hf_api(img: Image.Image) -> dict:
    from huggingface_hub import InferenceClient

    client = InferenceClient(token=HF_TOKEN)
    orig_size = img.size
    img512 = _resize_to_512(img)

    results = {}
    for key, (prompt, strength) in PROMPTS.items():
        buf = io.BytesIO()
        img512.save(buf, format="PNG")
        buf.seek(0)
        out = client.image_to_image(
            image=buf,
            prompt=prompt,
            model=HF_MODEL,
            strength=strength,
            num_inference_steps=8,
        )
        if not isinstance(out, Image.Image):
            out = Image.open(io.BytesIO(out)).convert("RGB")
        out = out.resize(orig_size, Image.LANCZOS)
        results[key] = _pil_to_b64(out)

    return results


def _load_local_pipe():
    global _local_pipe
    if _local_pipe is not None:
        return _local_pipe
    with _local_pipe_lock:
        if _local_pipe is not None:  # re-check after acquiring lock
            return _local_pipe
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        _local_pipe = StableDiffusionImg2ImgPipeline.from_pretrained(
            LOCAL_MODEL,
            torch_dtype=dtype,
            safety_checker=None,
            requires_safety_checker=False,
        )
        if torch.cuda.is_available():
            _local_pipe = _local_pipe.to("cuda")
    return _local_pipe


def _run_local(img: Image.Image) -> dict:
    pipe = _load_local_pipe()
    orig_size = img.size
    img512 = _resize_to_512(img)

    results = {}
    for key, (prompt, strength) in PROMPTS.items():
        out = pipe(
            prompt=prompt,
            image=img512,
            strength=strength,
            num_inference_steps=8,
            guidance_scale=7.5,
        ).images[0]
        out = out.resize(orig_size, Image.LANCZOS)
        results[key] = _pil_to_b64(out)

    return results


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
        print(f"[server] Image decode error: {exc}")
        raise HTTPException(status_code=400, detail="Invalid or unreadable image file")

    result = None
    source = None

    if HF_TOKEN:
        try:
            result = _run_hf_api(img)
            source = "hf_api"
        except Exception as exc:
            logger.warning("HF API failed, falling back to local: %s", exc)

    if result is None:
        try:
            result = _run_local(img)
            source = "local"
        except Exception as exc:
            print(f"[server] All pipelines failed: {exc}")
            raise HTTPException(status_code=500, detail="Map generation failed. Check server logs.")

    result["source"] = source
    return JSONResponse(content=result)
