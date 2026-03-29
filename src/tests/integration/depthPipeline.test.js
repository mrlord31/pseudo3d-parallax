/**
 * Integration tests — Depth pipeline
 *
 * Validates model config, pipeline exports, and the processing chain
 * without actually downloading ONNX models (mocked).
 */
import { describe, it, expect, vi } from 'vitest';

// ── Exports check (static import, no singleton concern) ───────────────────────
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: { allowLocalModels: true },
}));

import { generateAllMaps, preloadDepthModel } from '../../components/DepthMapGenerator.js';
import { pipeline as mockPipeline } from '@huggingface/transformers';

describe('DepthMapGenerator — exports', () => {
  it('exports generateAllMaps', () => expect(typeof generateAllMaps).toBe('function'));
  it('exports preloadDepthModel', () => expect(typeof preloadDepthModel).toBe('function'));
});

describe('DepthMapGenerator — model config', () => {
  it('preloadDepthModel calls pipeline with depth-estimation task', async () => {
    const fakePipeline = vi.fn(async () => ({
      depth: { data: new Float32Array(64 * 64).fill(0.5), width: 64, height: 64 },
    }));
    mockPipeline.mockResolvedValueOnce(fakePipeline);

    await preloadDepthModel(() => {}, () => {});
    expect(mockPipeline).toHaveBeenCalledWith(
      'depth-estimation',
      expect.stringContaining('depth-anything'),
      expect.any(Object),
    );
  });

  it('pipeline is called with progress_callback option', async () => {
    // Pipeline already cached from previous test — check the recorded call
    const options = mockPipeline.mock.calls[0]?.[2];
    expect(options).toHaveProperty('progress_callback');
    expect(typeof options.progress_callback).toBe('function');
  });
});

// ── Fallback chain: verified via source inspection (singleton prevents runtime isolation) ──
const depthSrc = await import('../../components/DepthMapGenerator.js?raw').then(m => m.default);

describe('DepthMapGenerator — model fallback chain (source guard)', () => {
  it('has at least 2 fallback models defined', () => {
    const matches = [...depthSrc.matchAll(/id:\s*['"]([^'"]+depth-anything[^'"]+)['"]/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('fallback uses try/catch to continue to next model', () => {
    expect(depthSrc).toContain('catch');
    expect(depthSrc).toContain('trying next');
  });

  it('throws No depth model available when all fail', () => {
    expect(depthSrc).toContain('No depth model available');
  });

  it('resets _pipelineLoad on failure so retries are possible', () => {
    expect(depthSrc).toContain('_pipelineLoad = null');
  });
});
