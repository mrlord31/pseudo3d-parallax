// Lenticular overlay function — import this via string concatenation before main shader
// Simulates the refractive bands of a lenticular lens sheet

// Returns a [0,1] mask value for lenticular highlight intensity
// uv        : fragment UV coordinate (0..1)
// frequency : lines-per-unit (e.g. 60.0 maps to ~60 LPI at screen scale)
// opacity   : overall strength of the effect (0.05–0.3 recommended)
float lenticularOverlay(vec2 uv, float frequency, float opacity) {
  // Pure sinusoidal lens pattern: 0 = valley, 1 = peak — no harsh edges
  return sin(uv.x * frequency * 6.28318530718) * 0.5 + 0.5;
}
