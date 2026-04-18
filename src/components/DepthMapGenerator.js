/**
 * DepthMapGenerator — V2.1
 *
 * Architecture:
 *   generateAllMaps  → probes /v2/health, then POST /v2/process (proxied to localhost:8000)
 *                      which calls the HuggingFace Inference API server-side.
 *                      Throws if the server is unreachable — no local fallback.
 *
 *   generateMapsFromDepth → user-supplied depth map → derive normal + AO locally.
 *
 * Conventions:
 *   depth = 0 (black) → near / close to camera
 *   depth = 1 (white) → far / deep in scene
 *
 * onProgress(0..100)  — numeric progress callback
 * onStatus(string)    — human-readable status message
 */

// ── V2 server strategy ────────────────────────────────────────────────────────
const SERVER_URL = '/v2';   // proxied by Vite to localhost:8000

async function _probeServer() {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function _allMapsServer(imgElement, onProgress, onStatus) {
  onStatus?.('Sending to V2 generative server…');
  onProgress?.(5);

  const canvas = document.createElement('canvas');
  canvas.width  = imgElement.naturalWidth;
  canvas.height = imgElement.naturalHeight;
  canvas.getContext('2d').drawImage(imgElement, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));

  const form = new FormData();
  form.append('file', blob, 'image.png');

  onProgress?.(10);
  onStatus?.('Generating maps with AI model…');

  const res = await fetch(`${SERVER_URL}/process`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Server error ${res.status}`);

  const data = await res.json();
  onProgress?.(95);
  onStatus?.('');

  return {
    upscaledUrl: `data:image/png;base64,${data.upscale}`,
    depthUrl:    `data:image/png;base64,${data.depth}`,
    normalUrl:   `data:image/png;base64,${data.normal}`,
    aoUrl:       `data:image/png;base64,${data.ao}`,
    source:      data.source,
  };
}

// ── Public entry points ───────────────────────────────────────────────────────

// generateAllMaps — V2.1: HF API server only. Throws if server unavailable.
export async function generateAllMaps(imgElement, onProgress, onStatus) {
  if (!(await _probeServer())) {
    throw new Error('Generative server not running. Start server.py and try again.');
  }
  return await _allMapsServer(imgElement, onProgress, onStatus);
}

// generateMapsFromDepth — when user uploads a custom depth map.
// Loads the depth URL, derives normal + AO from it.
export async function generateMapsFromDepth(depthUrl, origW, origH, onProgress, onStatus) {
  onStatus?.('Analysing depth map…');
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = depthUrl;
  });
  const W = img.naturalWidth || origW;
  const H = img.naturalHeight || origH;
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const pixels = tmp.getContext('2d').getImageData(0, 0, W, H).data;
  const floatData = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) floatData[i] = pixels[i * 4] / 255;
  onProgress?.(30);
  onStatus?.('Generating surface maps…');
  const [normalUrl, aoUrl] = await Promise.all([
    _floatToDataUrl(_normalMapPixels(floatData, W, H), W, H, origW, origH),
    _floatToDataUrl(_aoMapPixels(floatData, W, H),     W, H, origW, origH),
  ]);
  onProgress?.(100); onStatus?.('');
  return { normalUrl, aoUrl };
}

// ── Surface map generators ────────────────────────────────────────────────────

// Normal map from depth float array — Sobel-based surface normals.
// Output: RGBA Uint8ClampedArray (normal packed to [0,255], z always positive)
function _normalMapPixels(depth, w, h) {
  // Scale inversely with resolution so perceptual bump strength stays constant
  const scale = Math.max(2.0, 800 / Math.max(w, h)) * 12.0;
  const out = new Uint8ClampedArray(w * h * 4);
  const clampX = (x) => Math.max(0, Math.min(w - 1, x));
  const clampY = (y) => Math.max(0, Math.min(h - 1, y));
  const s = (x, y) => depth[clampY(y) * w + clampX(x)];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 5×5 Sobel (radius 2) — captures more surface structure than 3×3
      const gx =
        -1*s(x-2,y-2) - 2*s(x-2,y-1) - 3*s(x-2,y) - 2*s(x-2,y+1) - 1*s(x-2,y+2)
        -2*s(x-1,y-2) - 4*s(x-1,y-1) - 6*s(x-1,y) - 4*s(x-1,y+1) - 2*s(x-1,y+2)
        +2*s(x+1,y-2) + 4*s(x+1,y-1) + 6*s(x+1,y) + 4*s(x+1,y+1) + 2*s(x+1,y+2)
        +1*s(x+2,y-2) + 2*s(x+2,y-1) + 3*s(x+2,y) + 2*s(x+2,y+1) + 1*s(x+2,y+2);
      const gy =
        -1*s(x-2,y-2) - 2*s(x-1,y-2) - 3*s(x,y-2) - 2*s(x+1,y-2) - 1*s(x+2,y-2)
        -2*s(x-2,y-1) - 4*s(x-1,y-1) - 6*s(x,y-1) - 4*s(x+1,y-1) - 2*s(x+2,y-1)
        +2*s(x-2,y+1) + 4*s(x-1,y+1) + 6*s(x,y+1) + 4*s(x+1,y+1) + 2*s(x+2,y+1)
        +1*s(x-2,y+2) + 2*s(x-1,y+2) + 3*s(x,y+2) + 2*s(x+1,y+2) + 1*s(x+2,y+2);
      const nx = -gx * scale;
      const ny = -gy * scale;
      const nz = 52.0; // keep Z large → normals stay mostly pointing forward
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      const i = (y * w + x) * 4;
      out[i]     = Math.round((nx/len * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny/len * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz/len * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

// AO map — local variance based (surface crevices get darker).
// Shader handles boundary suppression via edgeFactor, so no edge mask needed here.
function _aoMapPixels(depth, w, h) {
  const r = Math.max(3, Math.round(Math.min(w, h) * 0.006));

  const sq     = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) sq[i] = depth[i] * depth[i];
  const mean   = boxBlur(depth, w, h, r);
  const meanSq = boxBlur(sq,    w, h, r);

  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const variance = Math.max(0, meanSq[i] - mean[i] * mean[i]);
    // Surface roughness → slight darkening; max 15%
    const ao = 1.0 - Math.min(Math.sqrt(variance) * 2.5, 0.15);
    const v  = Math.round(ao * 255);
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// Upscale a raw RGBA pixel array (depW×depH) to origW×origH and return PNG data URL
function _floatToDataUrl(pixels, w, h, origW, origH) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
  const out = document.createElement('canvas');
  out.width = origW; out.height = origH;
  out.getContext('2d').drawImage(c, 0, 0, origW, origH);
  return out.toDataURL('image/png');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function boxBlur(data, w, h, r) {
  const temp = new Float32Array(w*h);
  const out  = new Float32Array(w*h);
  const pH   = new Float32Array(w+1);
  for (let y = 0; y < h; y++) {
    const row = y*w; pH[0]=0;
    for (let x=0;x<w;x++) pH[x+1]=pH[x]+data[row+x];
    for (let x=0;x<w;x++) {
      const lo=Math.max(0,x-r), hi=Math.min(w-1,x+r);
      temp[row+x]=(pH[hi+1]-pH[lo])/(hi-lo+1);
    }
  }
  const pV = new Float32Array(h+1);
  for (let x = 0; x < w; x++) {
    pV[0]=0;
    for (let y=0;y<h;y++) pV[y+1]=pV[y]+temp[y*w+x];
    for (let y=0;y<h;y++) {
      const lo=Math.max(0,y-r), hi=Math.min(h-1,y+r);
      out[y*w+x]=(pV[hi+1]-pV[lo])/(hi-lo+1);
    }
  }
  return out;
}

export function normalizeInPlace(arr) {
  let min=Infinity, max=-Infinity;
  for (const v of arr) { if(v<min) min=v; if(v>max) max=v; }
  const range = max-min||1;
  for (let i=0;i<arr.length;i++) arr[i]=(arr[i]-min)/range;
}
