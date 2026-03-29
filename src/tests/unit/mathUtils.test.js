import { describe, it, expect } from 'vitest';
import { lerp, clamp, map, smooth, smooth2D, deadzone } from '../../utils/mathUtils.js';

describe('mathUtils — unit', () => {
  describe('clamp', () => {
    it('returns value when within range', () => expect(clamp(0.5, 0, 1)).toBe(0.5));
    it('clamps to min', () => expect(clamp(-2, -1, 1)).toBe(-1));
    it('clamps to max', () => expect(clamp(2, -1, 1)).toBe(1));
    it('clamps at exact boundaries', () => {
      expect(clamp(-1, -1, 1)).toBe(-1);
      expect(clamp(1, -1, 1)).toBe(1);
    });
  });

  describe('lerp', () => {
    it('returns a at t=0', () => expect(lerp(0, 10, 0)).toBe(0));
    it('returns b at t=1', () => expect(lerp(0, 10, 1)).toBe(10));
    it('returns midpoint at t=0.5', () => expect(lerp(0, 10, 0.5)).toBe(5));
  });

  describe('map', () => {
    it('maps center of input range to center of output range', () =>
      expect(map(5, 0, 10, 0, 100)).toBe(50));
    it('maps min of input to min of output', () =>
      expect(map(0, 0, 10, -1, 1)).toBe(-1));
    it('maps max of input to max of output', () =>
      expect(map(10, 0, 10, -1, 1)).toBe(1));
  });

  describe('smooth', () => {
    it('moves toward target', () => {
      const result = smooth(0, 10, 0.1);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(10);
    });
    it('reaches target at factor=1', () => expect(smooth(0, 10, 1)).toBe(10));
    it('stays put at factor=0', () => expect(smooth(5, 10, 0)).toBe(5));
    it('clamps factor above 1', () => expect(smooth(0, 10, 2)).toBe(10));
  });

  describe('smooth2D', () => {
    it('returns object with x and y', () => {
      const result = smooth2D({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5);
      expect(result).toHaveProperty('x');
      expect(result).toHaveProperty('y');
    });
    it('moves both axes toward target', () => {
      const result = smooth2D({ x: 0, y: 0 }, { x: 10, y: 10 }, 0.1);
      expect(result.x).toBeGreaterThan(0);
      expect(result.y).toBeGreaterThan(0);
    });
  });

  describe('deadzone', () => {
    it('zeroes values within default threshold', () => expect(deadzone(0.01)).toBe(0));
    it('passes values outside threshold', () => expect(deadzone(0.05)).toBe(0.05));
    it('respects custom threshold', () => expect(deadzone(0.05, 0.1)).toBe(0));
  });
});
