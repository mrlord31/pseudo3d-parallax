/**
 * ParallaxRenderer
 *
 * Three.js-based WebGL renderer that applies the depth-parallax + lenticular effect.
 *
 * Pipeline:
 *   1. OrthographicCamera + PlaneGeometry covering the full canvas
 *   2. ShaderMaterial with parallax displacement driven by depth map + head offset
 *   3. Lenticular overlay blended in the same pass
 */

import * as THREE from 'three';
import vertSrc  from '../shaders/parallax.vert.glsl?raw';
import fragBody from '../shaders/parallax.frag.glsl?raw';
import lenticularFn from '../shaders/lenticular.frag.glsl?raw';

// Strip comments from lenticular.frag.glsl and keep only the function definition
function buildFragSrc() {
  // Extract just the function body (everything after the comment block)
  const fnStart = lenticularFn.indexOf('float lenticularOverlay');
  const fnCode  = fnStart >= 0 ? lenticularFn.slice(fnStart) : '';
  // Replace the NOTE comment placeholder in the main shader
  return fragBody.replace(
    '// NOTE: lenticularOverlay() is prepended from lenticular.frag.glsl at runtime',
    fnCode
  );
}

const FRAG_SRC = buildFragSrc();

export class ParallaxRenderer {
  constructor() {
    this.renderer  = null;
    this.scene     = null;
    this.camera    = null;
    this.mesh      = null;
    this.material  = null;
    this.rafId     = null;

    this._offset   = new THREE.Vector2(0, 0);
    this._target   = new THREE.Vector2(0, 0);

    this.onFpsUpdate = null;     // (fps: number) => void
    this._lastTime   = 0;
    this._frameCount = 0;
    this._fpsAccum   = 0;
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  init(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Canvas must fill its parent div completely
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width   = '100%';
    canvas.style.height  = '100%';
    container.appendChild(canvas);

    // Orthographic camera: maps NDC directly to clip space (-1..1 each axis)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 1;

    this.scene = new THREE.Scene();

    // Full-screen quad
    const geo = new THREE.PlaneGeometry(2, 2);
    this._blank = this._makeBlankTexture();
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertSrc,
      fragmentShader: FRAG_SRC,
      uniforms: {
        uTexture:           { value: this._blank },
        uDepthMap:          { value: this._blank },
        uNormalMap:         { value: this._blank },
        uAOMap:             { value: this._blank },
        uParallaxOffset:    { value: new THREE.Vector2(0, 0) },
        uSensitivity:       { value: 2.2 },
        uLenticularFreq:    { value: 60.0 },
        uLenticularOpacity: { value: 0.0 },
        uLightStrength:     { value: 0.12 },
        uShowMode:          { value: 0.0 },
        uResolution:        { value: new THREE.Vector2(1, 1) },
        uImageAspect:       { value: 1.0 },
        uCanvasAspect:      { value: 1.0 },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.scene.add(this.mesh);

    this._resize();
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(container);
  }

  // ── Texture loading ────────────────────────────────────────────────────────

  loadTextures(imageUrl, depthUrl, normalUrl, aoUrl) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    const loadTex = (url, linear = false) =>
      new Promise((resolve) => {
        if (!url) { resolve(this._blank); return; }
        loader.load(url, (tex) => {
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.colorSpace = linear ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
          resolve(tex);
        });
      });

    Promise.all([
      loadTex(imageUrl),
      loadTex(depthUrl,  true),
      loadTex(normalUrl, true),
      loadTex(aoUrl,     true),
    ]).then(([imgTex, depTex, nrmTex, aoTex]) => {
      const u = this.material.uniforms;

      // Dispose old textures (never dispose the shared blank)
      for (const [key, newTex] of [
        ['uTexture', imgTex], ['uDepthMap', depTex],
        ['uNormalMap', nrmTex], ['uAOMap', aoTex],
      ]) {
        const old = u[key].value;
        if (old !== this._blank && old !== newTex) old.dispose();
        u[key].value = newTex;
      }

      this._imageAspect = imgTex.image.width / imgTex.image.height;
      u.uImageAspect.value = this._imageAspect;
      this._resize();
    });
  }

  // ── Per-frame updates ──────────────────────────────────────────────────────

  setParallaxOffset(x, y) {
    // Hard cap at ±0.35 — beyond this the parallax displacement becomes visible
    // as edge smearing regardless of depth map quality.
    const CAP = 0.35;
    this._target.set(
      Math.max(-CAP, Math.min(CAP, x)),
      Math.max(-CAP, Math.min(CAP, y)),
    );
  }

  updateSettings(s) {
    if (!this.material) return;
    const u = this.material.uniforms;

    // ── Physics-fixed constants (not user-adjustable) ──────────────────────────
    // Sensitivity: derived from effective human viewing angle on a flat screen.
    // Assumption: 60 cm viewing distance, ±3 cm natural head movement, ~15 cm scene depth.
    // Max UV parallax ≈ 3 cm / 30 cm screen = ~3% → sensitivity 1.5 gives ±3% at full sweep.
    u.uSensitivity.value       = 2.2;
    u.uLenticularFreq.value    = 60.0;
    u.uLenticularOpacity.value = 0.0;
    u.uLightStrength.value     = 0.12; // subtle — just enough to feel surface relief

    // viewMode: 'final' | 'depth' | 'normal' | 'ao'
    const MODES = { final: 0.0, depth: 1.0, normal: 2.0, ao: 3.0 };
    u.uShowMode.value = MODES[s.viewMode] ?? 0.0;
  }

  // ── Animation loop ─────────────────────────────────────────────────────────

  start() {
    const loop = (time) => {
      this.rafId = requestAnimationFrame(loop);
      this._updateFps(time);

      // Smooth offset towards target
      const LERP = 0.12;
      this._offset.x += (this._target.x - this._offset.x) * LERP;
      this._offset.y += (this._target.y - this._offset.y) * LERP;
      this.material.uniforms.uParallaxOffset.value.copy(this._offset);

      this.renderer.render(this.scene, this.camera);
    };
    loop(0);
  }

  stop() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  reset() {
    this._target.set(0, 0);
    this._offset.set(0, 0);
    if (this.material) {
      this.material.uniforms.uParallaxOffset.value.set(0, 0);
    }
  }

  dispose() {
    this.stop();
    this._resizeObserver?.disconnect();
    this.material?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _makeBlankTexture() {
    const tex = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  }

  _resize() {
    if (!this.container || !this.renderer) return;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    if (!cw || !ch) return;

    // Canvas always fills the container — aspect ratio is handled in the shader
    this.renderer.setSize(cw, ch);

    if (this.material) {
      const canvasAspect = cw / ch;
      this.material.uniforms.uResolution.value.set(cw, ch);
      this.material.uniforms.uCanvasAspect.value = canvasAspect;
    }
  }

  _updateFps(time) {
    const delta = time - this._lastTime;
    this._lastTime = time;
    this._frameCount++;
    this._fpsAccum += delta;

    if (this._fpsAccum >= 500) {
      const fps = Math.round((this._frameCount * 1000) / this._fpsAccum);
      this.onFpsUpdate?.(fps);
      this._frameCount = 0;
      this._fpsAccum   = 0;
    }
  }
}
