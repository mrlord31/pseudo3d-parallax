/**
 * Parallax Configuration Guard Tests
 *
 * These tests lock in the exact parameter values that produce the current
 * visual result. If any of these fail after a code change, a critical
 * rendering parameter has changed.
 */
import { describe, it, expect } from 'vitest';

// ── Read source files as text to extract constants without importing WebGL deps ──

const rendererSrc = await import('../../components/ParallaxRenderer.js?raw').then(m => m.default);
const headTrackerSrc = await import('../../components/HeadTracker.js?raw').then(m => m.default);
const fragSrc = await import('../../shaders/parallax.frag.glsl?raw').then(m => m.default);
const depthSrc = await import('../../components/DepthMapGenerator.js?raw').then(m => m.default);

describe('Parallax renderer — configuration guard', () => {
  it('uSensitivity is 2.2', () => {
    expect(rendererSrc).toContain('uSensitivity:       { value: 2.2 }');
  });

  it('uLightStrength is 0.12', () => {
    expect(rendererSrc).toContain('uLightStrength:     { value: 0.12 }');
  });

  it('uLenticularOpacity is 0.0 (disabled)', () => {
    expect(rendererSrc).toContain('uLenticularOpacity: { value: 0.0 }');
  });

  it('parallax offset cap is ±0.35', () => {
    expect(rendererSrc).toContain('const CAP = 0.35');
  });

  it('texture color space: depth/normal/AO use LinearSRGBColorSpace', () => {
    expect(rendererSrc).toContain('LinearSRGBColorSpace');
  });

  it('image texture uses SRGBColorSpace', () => {
    expect(rendererSrc).toContain('SRGBColorSpace');
  });
});

describe('GLSL shader — parallax formula guard', () => {
  it('uses quadratic nearness curve: pow(depth, 2.0)', () => {
    expect(fragSrc).toContain('pow(depth, 2.0)');
  });

  it('applies strength factor of 0.04', () => {
    expect(fragSrc).toContain('uSensitivity * 0.04');
  });

  it('edge suppression uses smoothstep(0.006, 0.02, depthEdge)', () => {
    expect(fragSrc).toContain('smoothstep(0.006, 0.02, depthEdge)');
  });

  it('AO contribution factor is 0.4', () => {
    expect(fragSrc).toContain('uLightStrength * 0.4');
  });

  it('normal light direction multiplier is 1.5', () => {
    expect(fragSrc).toContain('uParallaxOffset.x * 1.5');
  });

  it('near-anchored: foreground depth=1 moves most', () => {
    // Convention: white=near. nearness = pow(depth, 2.0) → depth=1 moves most
    expect(fragSrc).toContain('pow(depth, 2.0)');
  });
});

describe('HeadTracker — direction convention guard', () => {
  it('mouse X is negated (parallax opposite to movement)', () => {
    expect(headTrackerSrc).toContain('-((cx / window.innerWidth)');
  });

  it('smooth factor is 0.08', () => {
    expect(headTrackerSrc).toContain('SMOOTH_FACTOR = 0.08');
  });

  it('animate Lissajous X frequency is 0.18 Hz', async () => {
    const appSrc = await import('../../App.jsx?raw').then(m => m.default);
    expect(appSrc).toContain('0.18 * Math.PI * 2');
  });
});

describe('Depth model config guard — V2.1', () => {
  it('uses V2 server URL /v2', () => {
    expect(depthSrc).toContain("SERVER_URL = '/v2'");
  });

  it('server probe uses 1500ms timeout', () => {
    expect(depthSrc).toContain('AbortSignal.timeout(1500)');
  });

  it('does not contain ONNX model list', () => {
    expect(depthSrc).not.toContain('DEPTH_MODELS');
  });

  it('does not export preloadDepthModel', () => {
    expect(depthSrc).not.toContain('export async function preloadDepthModel');
  });

  it('normal map nz component is 52', () => {
    expect(depthSrc).toContain('52');
  });

  it('AO max darkening is 15%', () => {
    expect(depthSrc).toContain('0.15');
  });
});
