/**
 * Integration tests — Depth pipeline V2.1
 *
 * Validates V2.1 exports and server-probe behavior.
 * No network calls, no ONNX models.
 */
import { describe, it, expect } from 'vitest';
import { generateAllMaps, generateMapsFromDepth } from '../../components/DepthMapGenerator.js';

describe('DepthMapGenerator V2.1 — exports', () => {
  it('exports generateAllMaps as a function', () => {
    expect(typeof generateAllMaps).toBe('function');
  });
  it('exports generateMapsFromDepth as a function', () => {
    expect(typeof generateMapsFromDepth).toBe('function');
  });
  it('does NOT export preloadDepthModel', async () => {
    const mod = await import('../../components/DepthMapGenerator.js');
    expect(mod.preloadDepthModel).toBeUndefined();
  });
});

describe('DepthMapGenerator V2.1 — server probe', () => {
  it('generateAllMaps throws when server is unreachable', async () => {
    // fetch will fail in jsdom with no mock
    await expect(generateAllMaps({ naturalWidth: 100, naturalHeight: 100 }))
      .rejects.toThrow();
  });
});
