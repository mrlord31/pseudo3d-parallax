"""
E2E server connectivity tests for pseudo3d-parallax V2.2.

Validates that the server is reachable and the pix2pix model is ready.
No image inference — just connectivity and health checks.

Requires the server running at localhost:8000 (./start_server.sh).

Run:
    .venv/bin/pytest test_server.py -v
"""

import httpx
import pytest

BASE_URL = "http://localhost:8000"
TIMEOUT = 5


class TestServerConnectivity:
    def test_server_is_reachable(self):
        """Server must respond to /health."""
        r = httpx.get(f"{BASE_URL}/health", timeout=TIMEOUT)
        assert r.status_code == 200

    def test_health_response_shape(self):
        """Health endpoint returns expected keys."""
        r = httpx.get(f"{BASE_URL}/health", timeout=TIMEOUT)
        body = r.json()
        for key in ("status", "model_cached", "model_ready"):
            assert key in body, f"Missing key '{key}'"
        assert body["status"] == "ok"

    def test_model_is_cached(self):
        """Model files must be present on disk before /process can work."""
        r = httpx.get(f"{BASE_URL}/health", timeout=TIMEOUT)
        assert r.json()["model_cached"] is True, (
            "Model not downloaded. Run `python download_model.py` first."
        )

    def test_model_is_ready(self):
        """Pipeline must be loaded in memory (background preload on startup)."""
        import time
        deadline = time.time() + 60
        body = {}
        while time.time() < deadline:
            r = httpx.get(f"{BASE_URL}/health", timeout=TIMEOUT)
            body = r.json()
            if body.get("model_ready"):
                break
            time.sleep(3)
        assert body.get("model_ready") is True, (
            f"Pipeline not ready after 60 s. error={body.get('model_error')}"
        )

    def test_process_rejects_invalid_image(self):
        """Non-image payload must return 400 — validates /process is wired up."""
        r = httpx.post(
            f"{BASE_URL}/process",
            files={"file": ("bad.png", b"not an image", "image/png")},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    def test_process_rejects_oversized_file(self):
        """Files over 10 MB must return 413."""
        big = b"x" * (11 * 1024 * 1024)
        r = httpx.post(
            f"{BASE_URL}/process",
            files={"file": ("big.png", big, "image/png")},
            timeout=10,
        )
        assert r.status_code == 413
