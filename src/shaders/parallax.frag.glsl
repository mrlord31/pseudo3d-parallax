// NOTE: lenticularOverlay() is prepended from lenticular.frag.glsl at runtime

uniform sampler2D uTexture;
uniform sampler2D uDepthMap;
uniform sampler2D uNormalMap;
uniform sampler2D uAOMap;
uniform vec2      uParallaxOffset;    // normalized head/mouse offset [-1..1]
uniform float     uSensitivity;       // parallax strength
uniform float     uLenticularFreq;    // unused (kept for compat)
uniform float     uLenticularOpacity; // unused (kept for compat)
uniform float     uLightStrength;     // subtle normal-map lighting intensity
uniform float     uShowMode;          // 0=final, 1=depth, 2=normal, 3=AO
uniform vec2      uResolution;
uniform float     uImageAspect;
uniform float     uCanvasAspect;

varying vec2 vUv;

// Map canvas UV [0,1]² → image UV [0,1]², object-fit:contain
vec2 canvasToImageUV(vec2 uv) {
  vec2 imgUV;
  if (uCanvasAspect > uImageAspect) {
    float scale  = uImageAspect / uCanvasAspect;
    float margin = (1.0 - scale) * 0.5;
    imgUV = vec2((uv.x - margin) / scale, uv.y);
  } else {
    float scale  = uCanvasAspect / uImageAspect;
    float margin = (1.0 - scale) * 0.5;
    imgUV = vec2(uv.x, (uv.y - margin) / scale);
  }
  return imgUV;
}

void main() {
  vec2 imgUV = canvasToImageUV(vUv);

  // Letterbox / pillarbox background
  if (imgUV.x < 0.0 || imgUV.x > 1.0 || imgUV.y < 0.0 || imgUV.y > 1.0) {
    gl_FragColor = vec4(0.04, 0.04, 0.06, 1.0);
    return;
  }

  float depth = texture2D(uDepthMap, imgUV).r;

  // Debug views — no parallax displacement needed
  if (uShowMode > 2.5) {
    float ao = texture2D(uAOMap, imgUV).r;
    gl_FragColor = vec4(ao, ao, ao, 1.0);
    return;
  }
  if (uShowMode > 1.5) {
    gl_FragColor = vec4(texture2D(uNormalMap, imgUV).rgb, 1.0);
    return;
  }
  if (uShowMode > 0.5) {
    gl_FragColor = vec4(depth, depth, depth, 1.0);
    return;
  }

  // ── Parallax displacement ────────────────────────────────────────────────────
  // Convention: depth=1 (white) → near/foreground moves most, depth=0 (black) → far/static.
  // Quadratic curve: near objects dominate, mid-grays fall off quickly.
  float nearness = pow(depth, 2.0);

  // Suppress displacement only at sharp depth discontinuities.
  // The full-res blur already softens most edges; this catches any remaining hard jumps.
  float depthEdge  = length(vec2(dFdx(depth), dFdy(depth)));
  float edgeFactor = 1.0 - smoothstep(0.006, 0.02, depthEdge);

  float strength = nearness * edgeFactor * uSensitivity * 0.04;
  vec2 displUV = clamp(imgUV - uParallaxOffset * strength, 0.0, 1.0);

  // ── Base color ───────────────────────────────────────────────────────────────
  vec4 color = texture2D(uTexture, displUV);

  // ── Normal-map lighting ──────────────────────────────────────────────────────
  // Light direction follows viewer: moving left → light from left.
  // Suppress at depth edges (same edgeFactor) so normal map never creates halos.
  vec3 nrm      = normalize(texture2D(uNormalMap, imgUV).rgb * 2.0 - 1.0);
  vec3 lightDir = normalize(vec3(-uParallaxOffset.x * 1.5, uParallaxOffset.y * 1.5, 1.0));
  float diffuse = max(0.0, dot(nrm, lightDir)) * edgeFactor;

  float ao    = texture2D(uAOMap, imgUV).r;
  // AO darkens concavities; edgeFactor suppresses it at boundaries (no halo)
  float aoContrib = (1.0 - ao) * edgeFactor * uLightStrength * 0.4;
  float light = 1.0 + diffuse * uLightStrength - aoContrib;

  color.rgb = clamp(color.rgb * light, 0.0, 1.0);

  gl_FragColor = color;
}
