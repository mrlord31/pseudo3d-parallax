"""
Download timbrooks/instruct-pix2pix (~2.1 GB fp16) to the local HF cache.
Run once before starting the server:
    python download_model.py
"""
import logging

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

MODEL_ID = "timbrooks/instruct-pix2pix"


def main():
    try:
        import torch
        from diffusers import StableDiffusionInstructPix2PixPipeline
    except ImportError as exc:
        print(f"Missing dependency: {exc}")
        print("Run: pip install -r requirements.txt")
        raise SystemExit(1)

    logger.info("Downloading %s (fp16, ~2.1 GB)…", MODEL_ID)
    logger.info("This is a one-time download. Progress shown below.\n")

    StableDiffusionInstructPix2PixPipeline.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16,
        safety_checker=None,
        requires_safety_checker=False,
    )

    logger.info("\nModel downloaded and cached. You can now start the server.")


if __name__ == "__main__":
    main()
