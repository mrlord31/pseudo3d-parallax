/**
 * HeadTracker
 *
 * Normalized [-1, 1] X/Y tracking from:
 *   'mouse'  — mouse/touch position across the viewport
 *   'device' — DeviceOrientation (gyroscope / accelerometer)
 *   'webcam' — Native FaceDetector API (Chrome 113+) with canvas-motion fallback
 *
 * Key design:
 *   _webcamStream is stored immediately on this instance so _stopMode()
 *   can halt the camera synchronously, regardless of async setup state.
 */

import { smooth2D, clamp } from '../utils/mathUtils.js';

const SMOOTH_FACTOR = 0.08; // lower = smoother but more lag

export class HeadTracker {
  constructor(onUpdate) {
    this.onUpdate       = onUpdate;   // (x, y) => void
    this.mode           = null;
    this.raw            = { x: 0, y: 0 };
    this.smoothed       = { x: 0, y: 0 };
    this.rafId          = null;
    this._cleanup       = [];
    this._webcamStream  = null;       // always stopped synchronously in _stopMode
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async setMode(mode) {
    this._stopMode();
    this.mode = mode;

    switch (mode) {
      case 'mouse':  this._startMouse();          break;
      case 'device': await this._startDevice();   break;
      case 'webcam': await this._startWebcam();   break;
    }

    this._startLoop();
  }

  destroy() {
    this._stopMode();
  }

  // ── Mouse / Touch ──────────────────────────────────────────────────────────

  _startMouse() {
    const onMove = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      this.raw.x = clamp(-((cx / window.innerWidth)  * 2 - 1), -1, 1);
      this.raw.y = clamp( ((cy / window.innerHeight) * 2 - 1), -1, 1);
    };
    const onLeave = () => { this.raw.x = 0; this.raw.y = 0; };

    window.addEventListener('mousemove',  onMove);
    window.addEventListener('touchmove',  onMove, { passive: true });
    window.addEventListener('mouseleave', onLeave);

    this._cleanup.push(() => {
      window.removeEventListener('mousemove',  onMove);
      window.removeEventListener('touchmove',  onMove);
      window.removeEventListener('mouseleave', onLeave);
    });
  }

  // ── DeviceOrientation ──────────────────────────────────────────────────────

  async _startDevice() {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      try {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') {
          this._startMouse(); return;
        }
      } catch { this._startMouse(); return; }
    }

    const onOrientation = (e) => {
      this.raw.x = clamp((e.gamma ?? 0) / 30, -1, 1);
      this.raw.y = clamp(((e.beta ?? 0) - 45) / 30, -1, 1);
    };

    window.addEventListener('deviceorientation', onOrientation);
    this._cleanup.push(() => window.removeEventListener('deviceorientation', onOrientation));
  }

  // ── Webcam ─────────────────────────────────────────────────────────────────

  async _startWebcam() {
    // Acquire stream first — store on instance for immediate cleanup
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
    } catch (err) {
      console.warn('[HeadTracker] Camera access denied:', err.message);
      this._startMouse();
      return;
    }

    this._webcamStream = stream; // ← available for synchronous stop immediately

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    await new Promise((res) => {
      video.addEventListener('loadeddata', res, { once: true });
      video.play().catch(res);
    });

    const W = video.videoWidth  || 640;
    const H = video.videoHeight || 480;

    let running = true;
    this._cleanup.push(() => { running = false; });

    if (typeof window.FaceDetector !== 'undefined') {
      // ── Native FaceDetector (Chrome 113+) ─────────────────────────────────
      const detector = new window.FaceDetector({ maxDetectedFaces: 1, fastMode: true });

      // Neutral position: face centered at ~35% height in frame
      const tick = async () => {
        if (!running) return;

        if (video.readyState >= 2) {
          try {
            const faces = await detector.detect(video);
            if (faces.length > 0) {
              const box = faces[0].boundingBox;
              const fx = (box.x + box.width  / 2) / W;
              const fy = (box.y + box.height / 2) / H;
              // Mirror X (front camera) then invert for correct parallax direction
              // Head moves left → offset negative → near objects shift right
              this.raw.x = clamp( (fx - 0.5) * 4, -1, 1);
              this.raw.y = clamp( (fy - 0.35) * 4, -1, 1);
            }
          } catch { /* ignore per-frame errors */ }
        }

        if (running) setTimeout(tick, 50); // 20 fps
      };
      tick();
    } else {
      // ── Motion centroid fallback (all browsers) ────────────────────────────
      // Tracks the CENTER OF MASS of motion between frames.
      // Requires continuous movement; auto-returns to center when still.
      const canvas = document.createElement('canvas');
      canvas.width  = 160;
      canvas.height = 120;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      let prevGray = null;
      let lastMotionAt = 0;

      const tick = () => {
        if (!running) return;

        if (video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const cW = canvas.width, cH = canvas.height;

          const gray = new Uint8Array(cW * cH);
          for (let i = 0; i < cW * cH; i++) {
            gray[i] = (data[i*4] + data[i*4+1] + data[i*4+2]) / 3;
          }

          if (prevGray) {
            let sumX = 0, sumY = 0, total = 0;
            for (let y = 0; y < cH; y++) {
              for (let x = 0; x < cW; x++) {
                const diff = Math.abs(gray[y*cW+x] - prevGray[y*cW+x]);
                if (diff > 12) { sumX += x*diff; sumY += y*diff; total += diff; }
              }
            }

            if (total > cW * cH * 3) {
              // Significant motion: update position
              this.raw.x = clamp(-((sumX / total / cW) * 2 - 1), -1, 1);
              this.raw.y = clamp(-((sumY / total / cH) * 2 - 1), -1, 1);
              lastMotionAt = Date.now();
            } else if (Date.now() - lastMotionAt > 1500) {
              // No motion for 1.5 s — drift back to center
              this.raw.x *= 0.96;
              this.raw.y *= 0.96;
            }
          }
          prevGray = gray;
        }

        if (running) setTimeout(tick, 50);
      };
      tick();
    }
  }

  // ── Smooth render loop ─────────────────────────────────────────────────────

  _startLoop() {
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.smoothed = smooth2D(this.smoothed, this.raw, SMOOTH_FACTOR);
      this.onUpdate(this.smoothed.x, this.smoothed.y);
    };
    loop();
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  _stopMode() {
    // Cancel RAF loop
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }

    // Stop webcam tracks IMMEDIATELY — before async teardown
    if (this._webcamStream) {
      this._webcamStream.getTracks().forEach((t) => t.stop());
      this._webcamStream = null;
    }

    // Run all other cleanup functions (event listener removals, etc.)
    this._cleanup.forEach((fn) => fn());
    this._cleanup = [];

    this.raw      = { x: 0, y: 0 };
    this.smoothed = { x: 0, y: 0 };
  }
}
