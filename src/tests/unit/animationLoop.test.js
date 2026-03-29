/**
 * Animation loop parameter guard
 * Locks in the Lissajous figure-8 frequencies and amplitudes.
 */
import { describe, it, expect } from 'vitest';

const appSrc = await import('../../App.jsx?raw').then(m => m.default);

describe('Animate loop — Lissajous guard', () => {
  it('X frequency is 0.18 Hz', () => {
    expect(appSrc).toContain('0.18 * Math.PI * 2');
  });

  it('Y frequency is 0.09 Hz (half of X)', () => {
    expect(appSrc).toContain('0.09 * Math.PI * 2');
  });

  it('X amplitude is 0.28', () => {
    expect(appSrc).toContain('* 0.28');
  });

  it('Y amplitude is 0.14 (half of X)', () => {
    expect(appSrc).toContain('* 0.14');
  });
});
