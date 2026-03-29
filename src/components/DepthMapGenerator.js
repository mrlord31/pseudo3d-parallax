/**
 * DepthMapGenerator
 *
 * Attempts two strategies in order:
 *
 *  1. ML — Depth Anything Small via @huggingface/transformers (ONNX Runtime Web)
 *     Model: Xenova/depth-anything-small-hf  (~49 MB, cached after first download)
 *     Quality: near-ML-level, handles complex scenes well.
 *
 *  2. Heuristic fallback — multi-scale local sharpness + saturation cue.
 *     Used if model download fails or throws.
 *
 * Conventions:
 *   depth = 0 (black) → near / close to camera
 *   depth = 1 (white) → far / deep in scene
 *
 * onProgress(0..100)  — numeric progress callback
 * onStatus(string)    — human-readable status message
 */

// ── Singleton pipeline (cached across calls within the same session) ─────────
let _pipeline     = null;
let _pipelineLoad = null;  // pending Promise

// Try V2 first (more detailed, continuous depth); fall back to V1 if unavailable
// needsInvert: V1 outputs inverse depth (high=near), V2 outputs metric depth (high=far)
// Both models output disparity (inverse depth: high = near).
// We invert to our convention: 0 = near (dark), 1 = far (white).
const DEPTH_MODELS = [
  { id: 'onnx-community/depth-anything-v2-base',  size: '~90 MB', needsInvert: true },
  { id: 'onnx-community/depth-anything-v2-small', size: '~25 MB', needsInvert: true },
  { id: 'Xenova/depth-anything-small-hf',         size: '~49 MB', needsInvert: true },
];

let _modelMeta = null; // { needsInvert }

async function getDepthPipeline(onProgress, onStatus) {
  if (_pipeline) return { pipeline: _pipeline, ..._modelMeta };

  if (!_pipelineLoad) {
    _pipelineLoad = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;

      for (const model of DEPTH_MODELS) {
        try {
          onStatus?.(`Downloading AI model (${model.size}, first time only)…`);
          _pipeline = await pipeline('depth-estimation', model.id, {
            progress_callback: (evt) => {
              if (evt.status === 'downloading' && evt.total) {
                onProgress?.(10 + (evt.loaded / evt.total) * 55);
              }
            },
          });
          _modelMeta = { needsInvert: model.needsInvert };
          onStatus?.('');
          return { pipeline: _pipeline, ..._modelMeta };
        } catch (e) {
          console.warn(`[DepthMap] ${model.id} failed, trying next:`, e.message);
          _pipeline = null;
        }
      }
      throw new Error('No depth model available');
    })().catch((err) => {
      _pipelineLoad = null;
      throw err;
    });
  }

  return _pipelineLoad;
}

// ── Preload API ───────────────────────────────────────────────────────────────

export async function preloadDepthModel(onProgress, onStatus) {
  await getDepthPipeline(onProgress, onStatus);
}

// ── Public entry points ───────────────────────────────────────────────────────

// generateAllMaps — local inference. Returns { depthUrl, normalUrl, aoUrl }.
export async function generateAllMaps(imgElement, onProgress, onStatus) {
  try {
    return await _allMapsML(imgElement, onProgress, onStatus);
  } catch (err) {
    console.warn('[DepthMap] ML failed, using heuristic:', err.message);
    onStatus?.('');
    return await _allMapsHeuristic(imgElement, onProgress);
  }
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

// Kept for backward compat — returns only depthUrl string.
export async function generateDepthMap(imgElement, onProgress, onStatus) {
  const { depthUrl } = await generateAllMaps(imgElement, onProgress, onStatus);
  return depthUrl;
}

// ── Strategy 1: ML — orchestrators ───────────────────────────────────────────

async function _allMapsML(imgElement, onProgress, onStatus) {
  const { naturalWidth: origW, naturalHeight: origH } = imgElement;
  const { url: depthUrl, floatData, w, h } =
    await generateDepthMapML(imgElement, p => onProgress?.(p * 0.75), onStatus);
  onStatus?.('Generating surface maps…');
  const [normalUrl, aoUrl] = await Promise.all([
    _floatToDataUrl(_normalMapPixels(floatData, w, h), w, h, origW, origH),
    _floatToDataUrl(_aoMapPixels(floatData, w, h),     w, h, origW, origH),
  ]);
  onProgress?.(100); onStatus?.('');
  return { depthUrl, normalUrl, aoUrl };
}

async function _allMapsHeuristic(imgElement, onProgress) {
  const { naturalWidth: origW, naturalHeight: origH } = imgElement;
  const { url: depthUrl, floatData, w, h } =
    await generateDepthMapHeuristic(imgElement, p => onProgress?.(p * 0.75));
  const [normalUrl, aoUrl] = await Promise.all([
    _floatToDataUrl(_normalMapPixels(floatData, w, h), w, h, origW, origH),
    _floatToDataUrl(_aoMapPixels(floatData, w, h),     w, h, origW, origH),
  ]);
  onProgress?.(100);
  return { depthUrl, normalUrl, aoUrl };
}

// ── Strategy 1: ML (Depth Anything Small) ────────────────────────────────────

async function generateDepthMapML(imgElement, onProgress, onStatus) {
  const { naturalWidth: origW, naturalHeight: origH } = imgElement;

  onProgress?.(5);
  const { pipeline: pipe, needsInvert } = await getDepthPipeline(onProgress, onStatus);
  onProgress?.(68);
  onStatus?.('Running depth inference…');

  // Resize to max 518px (Depth Anything optimal input) before sending to model
  const maxPipe = 518;
  const pRatio  = Math.min(maxPipe / origW, maxPipe / origH, 1);
  const pipeCanvas = document.createElement('canvas');
  pipeCanvas.width  = Math.round(origW * pRatio);
  pipeCanvas.height = Math.round(origH * pRatio);
  pipeCanvas.getContext('2d').drawImage(imgElement, 0, 0, pipeCanvas.width, pipeCanvas.height);
  const pipeDataUrl = pipeCanvas.toDataURL('image/jpeg', 0.92);

  const output = await pipe(pipeDataUrl);
  onProgress?.(88);

  // predicted_depth: Tensor with dims [H, W] or [1, H, W]
  const tensor = output.predicted_depth;
  const rawData = tensor.data;            // Float32Array
  const dims    = tensor.dims;
  const [depH, depW] = dims.length === 3 ? [dims[1], dims[2]] : [dims[0], dims[1]];

  // Normalize raw values to [0, 1]
  let minD = Infinity, maxD = -Infinity;
  for (const v of rawData) { if (v < minD) minD = v; if (v > maxD) maxD = v; }
  const range = maxD - minD || 1;

  // Model outputs INVERSE depth (high = close). Invert to our convention (0 = near).
  const depCanvas = document.createElement('canvas');
  depCanvas.width  = depW;
  depCanvas.height = depH;
  const depCtx  = depCanvas.getContext('2d');
  const depData = depCtx.createImageData(depW, depH);

  for (let i = 0; i < depW * depH; i++) {
    const modelNorm = (rawData[i] - minD) / range; // normalized 0..1
    // Convention: 0=near(dark), 1=far(white)
    // V1 outputs inverse depth (high=near) → needs inversion
    // V2 outputs metric depth (high=far)   → already correct
    const ourDepth  = needsInvert ? 1 - modelNorm : modelNorm;
    const v = Math.round(ourDepth * 255);
    depData.data[i * 4]     = v;
    depData.data[i * 4 + 1] = v;
    depData.data[i * 4 + 2] = v;
    depData.data[i * 4 + 3] = 255;
  }
  depCtx.putImageData(depData, 0, 0);

  // Smooth depth at object boundaries to prevent parallax "dragging" artifacts.
  // Bilateral filter preserves hard edges — exactly what causes the ghost.
  // Box blur with moderate radius creates gradients at edges (correct behavior).
  // Single light blur pass — just enough to dissolve hard edges, preserves detail
  onStatus?.('Refining depth map…');
  const rawDepth = new Float32Array(depW * depH);
  for (let i = 0; i < depW * depH; i++) rawDepth[i] = depData.data[i * 4] / 255;
  const smoothDepth = boxBlur(rawDepth, depW, depH, 2);
  normalizeInPlace(smoothDepth);

  const smoothData = depCtx.createImageData(depW, depH);
  for (let i = 0; i < depW * depH; i++) {
    const v = Math.round(smoothDepth[i] * 255);
    smoothData.data[i * 4]     = v;
    smoothData.data[i * 4 + 1] = v;
    smoothData.data[i * 4 + 2] = v;
    smoothData.data[i * 4 + 3] = 255;
  }
  depCtx.putImageData(smoothData, 0, 0);

  // Upscale to original resolution (bilinear via drawImage)
  const out = document.createElement('canvas');
  out.width  = origW;
  out.height = origH;
  out.getContext('2d').drawImage(depCanvas, 0, 0, origW, origH);

  // Blur at FULL resolution after upscale — this is the key step.
  // At 518px, r=2 blur = ~4px gradient. After 8× upscale = ~32px gradient.
  // We add an additional pass at full res to properly smooth the boundary.
  const outCtx    = out.getContext('2d');
  const outPixels = outCtx.getImageData(0, 0, origW, origH).data;
  let fullFloat = new Float32Array(origW * origH);
  for (let i = 0; i < origW * origH; i++) fullFloat[i] = outPixels[i * 4] / 255;

  // Edge-masked blur: only feather depth at object boundaries, keep interior sharp.
  // 1. Detect edges via dilate - erode (morphological gradient)
  // 2. Widen the edge mask to cover the full parallax displacement range (~3% of image)
  // 3. Blend: output = lerp(original, blurred, widened_edge_mask)
  const edgeR  = Math.max(3, Math.round(Math.min(origW, origH) * 0.003));
  const blurR  = Math.max(8, Math.round(Math.min(origW, origH) * 0.030));

  const dilated = morphDilate(fullFloat, origW, origH, edgeR);
  const eroded  = morphErode(fullFloat,  origW, origH, edgeR);

  // Edge mask: 1 at boundaries, 0 in flat regions
  const edgeMask = new Float32Array(origW * origH);
  for (let i = 0; i < origW * origH; i++)
    edgeMask[i] = Math.min(1, (dilated[i] - eroded[i]) * 4.0);

  // Widen mask so the feather zone covers the full displacement distance
  const wideMask = boxBlur(edgeMask, origW, origH, blurR);
  for (let i = 0; i < origW * origH; i++)
    wideMask[i] = Math.min(1, wideMask[i] * 6.0);

  // Blurred version for the boundary zone only
  const blurred = boxBlur(fullFloat, origW, origH, blurR);

  // Blend: sharp interior, smooth boundary
  for (let i = 0; i < origW * origH; i++)
    fullFloat[i] = fullFloat[i] * (1 - wideMask[i]) + blurred[i] * wideMask[i];

  normalizeInPlace(fullFloat);

  // Write back blurred depth to canvas
  const blurredData = outCtx.createImageData(origW, origH);
  for (let i = 0; i < origW * origH; i++) {
    const v = Math.round(fullFloat[i] * 255);
    blurredData.data[i*4] = blurredData.data[i*4+1] = blurredData.data[i*4+2] = v;
    blurredData.data[i*4+3] = 255;
  }
  outCtx.putImageData(blurredData, 0, 0);
  onProgress?.(88);

  return { url: out.toDataURL('image/png'), floatData: fullFloat, w: origW, h: origH };
}

// ── Strategy 2: Heuristic (local sharpness + saturation) ─────────────────────

const PROC_MAX = 1024;

async function generateDepthMapHeuristic(imgElement, onProgress) {
  const { naturalWidth: origW, naturalHeight: origH } = imgElement;

  const ratio = Math.min(PROC_MAX / origW, PROC_MAX / origH, 1);
  const w = Math.round(origW * ratio);
  const h = Math.round(origH * ratio);

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w; srcCanvas.height = h;
  srcCanvas.getContext('2d').drawImage(imgElement, 0, 0, w, h);
  const { data } = srcCanvas.getContext('2d').getImageData(0, 0, w, h);
  onProgress?.(8);

  const gray       = new Float32Array(w * h);
  const saturation = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i*4]/255, g = data[i*4+1]/255, b = data[i*4+2]/255;
    gray[i] = 0.299*r + 0.587*g + 0.114*b;
    const maxC = Math.max(r,g,b), minC = Math.min(r,g,b);
    saturation[i] = maxC > 0.01 ? (maxC-minC)/maxC : 0;
  }
  onProgress?.(18);

  const var_fine   = localVariance(gray, w, h,  3);
  const var_medium = localVariance(gray, w, h,  9);
  const var_coarse = localVariance(gray, w, h, 20);
  normalizeInPlace(var_fine); normalizeInPlace(var_medium); normalizeInPlace(var_coarse);
  onProgress?.(38);

  const sharpness = new Float32Array(w * h);
  for (let i = 0; i < w*h; i++) {
    sharpness[i] = Math.max(var_fine[i], var_medium[i]*0.75, var_coarse[i]*0.45);
  }
  normalizeInPlace(sharpness);

  const satSmooth = boxBlur(saturation, w, h, 6);
  const edges     = sobelMagnitude(gray, w, h);
  normalizeInPlace(edges);
  const smoothEdges = boxBlur(edges, w, h, 5);
  normalizeInPlace(smoothEdges);
  onProgress?.(58);

  const depth = new Float32Array(w * h);
  for (let i = 0; i < w*h; i++) {
    depth[i] = (1-sharpness[i])*0.65 + (1-satSmooth[i])*0.25 + smoothEdges[i]*0.10;
  }

  let smooth = depth;
  for (const r of [5,10,18,26,18,10,5]) smooth = boxBlur(smooth, w, h, r);
  normalizeInPlace(smooth);
  onProgress?.(82);

  // S-curve (two passes)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < smooth.length; i++) {
      const v = smooth[i]; smooth[i] = v*v*(3-2*v);
    }
  }
  normalizeInPlace(smooth);
  onProgress?.(93);

  const procCanvas = document.createElement('canvas');
  procCanvas.width = w; procCanvas.height = h;
  const procCtx = procCanvas.getContext('2d');
  const procData = procCtx.createImageData(w, h);
  for (let i = 0; i < w*h; i++) {
    const v = Math.round(smooth[i]*255);
    procData.data[i*4]=v; procData.data[i*4+1]=v; procData.data[i*4+2]=v; procData.data[i*4+3]=255;
  }
  procCtx.putImageData(procData, 0, 0);

  const out = document.createElement('canvas');
  out.width = origW; out.height = origH;
  out.getContext('2d').drawImage(procCanvas, 0, 0, origW, origH);
  onProgress?.(88);
  return { url: out.toDataURL('image/png'), floatData: smooth, w, h };
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

// ── Morphological helpers ─────────────────────────────────────────────────────

// Separable max-filter (dilation) using sliding window O(n)
function morphDilate(data, w, h, r) {
  return _morphOp(data, w, h, r, Math.max);
}

// Separable min-filter (erosion) using sliding window O(n)
function morphErode(data, w, h, r) {
  return _morphOp(data, w, h, r, Math.min);
}

function _morphOp(data, w, h, r, fn) {
  const temp = new Float32Array(w * h);
  const out  = new Float32Array(w * h);
  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = data[y * w + x];
      for (let dx = 1; dx <= r; dx++) {
        if (x - dx >= 0) val = fn(val, data[y * w + (x - dx)]);
        if (x + dx < w)  val = fn(val, data[y * w + (x + dx)]);
      }
      temp[y * w + x] = val;
    }
  }
  // Vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let val = temp[y * w + x];
      for (let dy = 1; dy <= r; dy++) {
        if (y - dy >= 0) val = fn(val, temp[(y - dy) * w + x]);
        if (y + dy < h)  val = fn(val, temp[(y + dy) * w + x]);
      }
      out[y * w + x] = val;
    }
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function localVariance(gray, w, h, r) {
  const sq = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++) sq[i] = gray[i]*gray[i];
  const meanSq = boxBlur(sq,   w, h, r);
  const mean   = boxBlur(gray, w, h, r);
  const out    = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++) out[i] = Math.max(0, meanSq[i]-mean[i]*mean[i]);
  return out;
}

function boxBlur(data, w, h, r) {
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

function sobelMagnitude(gray, w, h) {
  const out = new Float32Array(w*h);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const gx =
      -gray[(y-1)*w+(x-1)]+gray[(y-1)*w+(x+1)]
      -2*gray[y*w+(x-1)]  +2*gray[y*w+(x+1)]
      -gray[(y+1)*w+(x-1)]+gray[(y+1)*w+(x+1)];
    const gy =
      -gray[(y-1)*w+(x-1)]-2*gray[(y-1)*w+x]-gray[(y-1)*w+(x+1)]
      +gray[(y+1)*w+(x-1)]+2*gray[(y+1)*w+x]+gray[(y+1)*w+(x+1)];
    out[y*w+x]=Math.sqrt(gx*gx+gy*gy);
  }
  return out;
}

function normalizeInPlace(arr) {
  let min=Infinity, max=-Infinity;
  for (const v of arr) { if(v<min) min=v; if(v>max) max=v; }
  const range = max-min||1;
  for (let i=0;i<arr.length;i++) arr[i]=(arr[i]-min)/range;
}
