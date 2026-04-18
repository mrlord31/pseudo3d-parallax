"""
E2E / API tests for the pseudo3d-parallax V2.1 Python server.

Tests validate real connectivity: server health + HF inference API response.
Requires the server running at localhost:8000 (./start_server.sh).

Run:
    .venv/bin/pytest test_server.py -v
"""

import io
import base64
import pytest
import httpx
from PIL import Image

BASE_URL = "http://localhost:8000"
TIMEOUT = 120  # HF API can be slow on cold start


def _make_test_image_bytes(size: int = 64) -> bytes:
    """Create a minimal solid-colour PNG in memory."""
    img = Image.new("RGB", (size, size), color=(120, 80, 60))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Health ──────────────────────────────────────────────────────────────────

class TestHealth:
    def test_server_is_reachable(self):
        """Server must respond to /health within 3 seconds."""
        r = httpx.get(f"{BASE_URL}/health", timeout=3)
        assert r.status_code == 200

    def test_health_response_shape(self):
        """Health endpoint returns expected JSON keys."""
        r = httpx.get(f"{BASE_URL}/health", timeout=3)
        body = r.json()
        assert "status" in body
        assert "hf_token" in body
        assert body["status"] == "ok"


# ── Process ─────────────────────────────────────────────────────────────────

class TestProcess:
    def test_process_returns_200(self):
        """POST /process with a valid image must return 200."""
        r = httpx.post(
            f"{BASE_URL}/process",
            files={"file": ("test.png", _make_test_image_bytes(), "image/png")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    def test_process_response_has_all_map_keys(self):
        """Response must contain upscale, normal, depth, ao, and source."""
        r = httpx.post(
            f"{BASE_URL}/process",
            files={"file": ("test.png", _make_test_image_bytes(), "image/png")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        for key in ("upscale", "normal", "depth", "ao", "source"):
            assert key in body, f"Missing key '{key}' in response"

    def test_process_maps_are_valid_base64_png(self):
        """Each map value must be valid base64-encoded PNG data."""
        r = httpx.post(
            f"{BASE_URL}/process",
            files={"file": ("test.png", _make_test_image_bytes(), "image/png")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        for key in ("upscale", "normal", "depth", "ao"):
            raw = base64.b64decode(body[key])
            img = Image.open(io.BytesIO(raw))
            assert img.format in ("PNG", "JPEG"), f"'{key}' is not a valid image"
            assert img.width > 0 and img.height > 0

    def test_process_source_is_local(self):
        """Source field must be 'local' confirming local processing ran."""
        r = httpx.post(
            f"{BASE_URL}/process",
            files={"file": ("test.png", _make_test_image_bytes(), "image/png")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json()["source"] == "local"

    def test_process_rejects_oversized_file(self):
        """Files over 10 MB must return 413."""
        big = b"x" * (11 * 1024 * 1024)
        r = httpx.post(
            f"{BASE_URL}/process",
            files={"file": ("big.png", big, "image/png")},
            timeout=10,
        )
        assert r.status_code == 413

    def test_process_rejects_invalid_image(self):
        """Non-image binary data must return 400."""
        r = httpx.post(
            f"{BASE_URL}/process",
            files={"file": ("bad.png", b"not an image", "image/png")},
            timeout=10,
        )
        assert r.status_code == 400
