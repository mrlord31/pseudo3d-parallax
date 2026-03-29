/** Linear interpolation */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Clamp value between min and max */
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** Map value from one range to another */
export const map = (v, inMin, inMax, outMin, outMax) =>
  outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);

/** Exponential smoothing (low-pass filter) — call each frame */
export const smooth = (current, target, factor = 0.1) =>
  lerp(current, target, clamp(factor, 0, 1));

/** Smooth a 2D vector in-place, returns { x, y } */
export function smooth2D(current, target, factor = 0.1) {
  return {
    x: smooth(current.x, target.x, factor),
    y: smooth(current.y, target.y, factor),
  };
}

/** Deadzone: zero out values within threshold */
export const deadzone = (v, threshold = 0.02) =>
  Math.abs(v) < threshold ? 0 : v;
