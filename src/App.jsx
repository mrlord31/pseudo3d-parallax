import React, { useEffect, useRef, useState, useCallback } from 'react';
import Controls from './components/Controls.jsx';
import { ParallaxRenderer } from './components/ParallaxRenderer.js';
import { HeadTracker } from './components/HeadTracker.js';
import { generateAllMaps, preloadDepthModel } from './components/DepthMapGenerator.js';
import { loadImage } from './utils/imageUtils.js';
import demoImageUrl from './resources/sample_image.png';

const DEFAULT_SETTINGS = {
  viewMode:     'final', // 'final' | 'depth' | 'normal' | 'ao'
  trackingMode: 'mouse',
};

export default function App() {
  const containerRef  = useRef(null);
  const rendererRef   = useRef(null);
  const trackerRef    = useRef(null);

  const [settings,     setSettings]     = useState(DEFAULT_SETTINGS);
  const [fps,          setFps]          = useState(0);
  const [imageSrc,     setImageSrc]     = useState(null);
  const [depthSrc,     setDepthSrc]     = useState(null);
  const [normalSrc,    setNormalSrc]    = useState(null);
  const [aoSrc,        setAoSrc]        = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress,     setProgress]     = useState(0);
  const [statusMsg,    setStatusMsg]    = useState('');
  const [statusLevel,  setStatusLevel]  = useState('info'); // 'info'|'warn'|'error'
  const [showOverlay,  setShowOverlay]  = useState(true);
  const [modelReady,   setModelReady]   = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [animating,    setAnimating]    = useState(false);
  const animatingRef = useRef(false);

  // ── Model preload on startup ─────────────────────────────────────────────────

  useEffect(() => {
    preloadDepthModel(
      (p) => setModelProgress(Math.round(p)),
      () => {},
    ).then(() => {
      setModelReady(true);
      setModelProgress(100);
    }).catch(() => {
      // Preload failed — still allow usage (will retry on process)
      setModelReady(true);
    });
  }, []);

  // ── Renderer init ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = new ParallaxRenderer();
    renderer.init(containerRef.current);
    renderer.onFpsUpdate = setFps;
    renderer.start();
    rendererRef.current = renderer;
    return () => renderer.dispose();
  }, []);

  useEffect(() => {
    rendererRef.current?.updateSettings(settings);
  }, [settings]);

  useEffect(() => {
    const tracker = new HeadTracker((x, y) => {
      if (!animatingRef.current) rendererRef.current?.setParallaxOffset(x, y);
    });
    tracker.setMode(settings.trackingMode);
    trackerRef.current = tracker;
    return () => tracker.destroy();
  }, [settings.trackingMode]);

  // ── Auto-animate loop ───────────────────────────────────────────────────────
  useEffect(() => {
    animatingRef.current = animating;
    if (!animating) {
      rendererRef.current?.setParallaxOffset(0, 0);
      return;
    }
    let rafId;
    const start = performance.now();
    const tick = (now) => {
      const t = (now - start) / 1000;
      // Slow figure-8 (Lissajous): x at 0.18 Hz, y at 0.09 Hz — gentle and natural
      const x =  Math.sin(t * 0.18 * Math.PI * 2) * 0.28;
      const y =  Math.sin(t * 0.09 * Math.PI * 2) * 0.14;
      rendererRef.current?.setParallaxOffset(x, y);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [animating]);

  // ── Scene loading ────────────────────────────────────────────────────────────

  const loadScene = useCallback(async (imageUrl) => {
    setIsProcessing(true);
    setProgress(0);
    setStatusMsg('Loading image…');
    setStatusLevel('info');

    try {
      const img = await loadImage(imageUrl);
      setImageSrc(imageUrl);

      setProgress(5);
      const maps = await generateAllMaps(
        img,
        (p) => setProgress(5 + p * 0.9),
        (msg) => setStatusMsg(msg),
      );
      setDepthSrc(maps.depthUrl);
      setNormalSrc(maps.normalUrl);
      setAoSrc(maps.aoUrl);

      setStatusMsg('Rendering…');
      rendererRef.current?.loadTextures(imageUrl, maps.depthUrl, maps.normalUrl, maps.aoUrl);
      setShowOverlay(false);
    } catch (err) {
      console.error('[App] Failed to load scene:', err);
    } finally {
      setIsProcessing(false);
      setProgress(0);
      setStatusMsg('');
      setStatusLevel('info');
    }
  }, []);

  // Image upload → immediately start processing
  const handleImage = useCallback((url) => {
    setDepthSrc(null);
    setNormalSrc(null);
    setAoSrc(null);
    loadScene(url);
  }, [loadScene]);

  // Demo: available only from intro overlay
  const handleDemo = useCallback(async () => {
    await loadScene(demoImageUrl);
  }, [loadScene]);

  const handleReset = useCallback(() => {
    rendererRef.current?.reset();
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={rootStyle}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div ref={containerRef} style={canvasContainerStyle} />

      {/* Intro overlay — demo button only available here */}
      {showOverlay && (
        <div style={overlayStyle} onClick={() => modelReady && setShowOverlay(false)}>
          <div style={overlayCardStyle} onClick={(e) => e.stopPropagation()}>
            <h1 style={{ fontSize: 22, marginBottom: 8, fontWeight: 400, letterSpacing: '0.04em' }}>
              pseudo3d-parallax
            </h1>
            <p style={{ color: '#556', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              Simulates a lenticular lens sheet to create a depth-into-screen illusion.<br />
              Load the demo or upload your own image using the panel on the right.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 20 }}>
              <Pill>🖱 Mouse parallax</Pill>
              <Pill>📱 Gyroscope on mobile</Pill>
              <Pill>📷 Face tracking via webcam</Pill>
            </div>

            {!modelReady ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, color: '#4af', marginBottom: 12, letterSpacing: '0.05em' }}>
                  Initialising pipeline…
                </div>
                <div style={progressTrackStyle}>
                  <div style={{ ...progressFillStyle, width: `${modelProgress}%` }} />
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: '#334' }}>
                  Loading fallback depth model — cached for future sessions
                </div>
              </div>
            ) : (
              <>
                <button style={overlayBtnStyle} onClick={handleDemo} disabled={isProcessing}>
                  {isProcessing ? 'Loading…' : 'Load Demo Scene'}
                </button>
                <p style={{ marginTop: 12, fontSize: 11, color: '#334' }}>
                  Or upload your own image via the panel →
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Processing overlay — spinner + status + progress */}
      {isProcessing && (
        <div style={loadingOverlayStyle}>
          <div style={spinnerStyle} />
          <div style={{
            ...loadingTextStyle,
            color: statusLevel === 'warn' ? '#fa3' : statusLevel === 'error' ? '#f55' : '#aac',
          }}>
            {statusMsg || 'Processing…'}
          </div>
          {progress > 0 && progress < 100 && (
            <div style={progressTrackStyle}>
              <div style={{ ...progressFillStyle, width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}

      <Controls
        settings={settings}
        setSettings={setSettings}
        fps={fps}
        onImage={handleImage}
        onReset={handleReset}
        imageSrc={imageSrc}
        isProcessing={isProcessing}
        animating={animating}
        setAnimating={setAnimating}
      />
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const rootStyle = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' };
const canvasContainerStyle = { position: 'absolute', inset: 0 };

const overlayStyle = {
  position: 'absolute', inset: 0,
  background: 'rgba(5,7,14,0.88)',
  backdropFilter: 'blur(8px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 30,
};

const overlayCardStyle = {
  maxWidth: 460, padding: 36,
  background: 'rgba(12,14,24,0.9)',
  border: '1px solid #1a2030',
  borderRadius: 12, textAlign: 'center',
};

const overlayBtnStyle = {
  padding: '10px 28px',
  background: 'rgba(68,170,255,0.15)',
  border: '1px solid #4af',
  borderRadius: 6, color: '#4af',
  cursor: 'pointer', fontSize: 14,
  letterSpacing: '0.06em',
};

const loadingOverlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  gap: 16,
  background: 'rgba(5,7,14,0.72)',
  backdropFilter: 'blur(6px)',
  zIndex: 25,
  pointerEvents: 'none',
};

const spinnerStyle = {
  width: 40, height: 40,
  borderRadius: '50%',
  border: '3px solid #1a2030',
  borderTop: '3px solid #4af',
  animation: 'spin 0.8s linear infinite',
};

const loadingTextStyle = {
  fontSize: 13, color: '#aac',
  letterSpacing: '0.06em',
  fontVariantNumeric: 'tabular-nums',
};

const progressTrackStyle = {
  width: 200, height: 2,
  background: '#1a2030', borderRadius: 1,
};

const progressFillStyle = {
  height: '100%', background: '#4af',
  borderRadius: 1, transition: 'width 0.2s ease',
};

function Pill({ children }) {
  return (
    <span style={{
      display: 'inline-block', padding: '4px 10px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid #223',
      borderRadius: 20, fontSize: 12, color: '#667',
    }}>
      {children}
    </span>
  );
}
