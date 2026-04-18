import React, { useState } from 'react';
import ImageLoader from './ImageLoader.jsx';

const css = {
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    height: '100%',
    width: 260,
    background: 'rgba(8,10,18,0.92)',
    backdropFilter: 'blur(12px)',
    borderLeft: '1px solid #1a2030',
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform 0.25s ease',
    zIndex: 20,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  panelCollapsed: {
    transform: 'translateX(248px)',
  },
  collapseBtn: {
    position: 'absolute',
    top: '50%',
    left: -28,
    transform: 'translateY(-50%)',
    width: 28,
    height: 56,
    background: 'rgba(8,10,18,0.92)',
    border: '1px solid #1a2030',
    borderRight: 'none',
    borderRadius: '6px 0 0 6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#445',
    fontSize: 16,
    userSelect: 'none',
  },
  header: {
    padding: '16px 16px 8px',
    borderBottom: '1px solid #1a2030',
    fontSize: 11,
    color: '#445',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fps: {
    fontSize: 11,
    color: '#4af',
    fontVariantNumeric: 'tabular-nums',
  },
  section: {
    padding: '12px 16px',
    borderBottom: '1px solid #111820',
  },
  sectionTitle: {
    fontSize: 10,
    color: '#334',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  label: {
    fontSize: 12,
    color: '#778',
  },
  modeBtn: (active) => ({
    flex: 1,
    padding: '6px 0',
    background: active ? 'rgba(68,170,255,0.18)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${active ? '#4af' : '#223'}`,
    borderRadius: 4,
    color: active ? '#4af' : '#556',
    cursor: 'pointer',
    fontSize: 11,
    letterSpacing: '0.04em',
    transition: 'all 0.15s',
  }),
  toggleSwitch: (on) => ({
    position: 'relative',
    display: 'inline-block',
    width: 36,
    height: 18,
    background: on ? '#4af' : '#223',
    borderRadius: 9,
    cursor: 'pointer',
    transition: 'background 0.15s',
    flexShrink: 0,
  }),
  toggleKnob: (on) => ({
    position: 'absolute',
    top: 2,
    left: on ? 18 : 2,
    width: 14,
    height: 14,
    background: '#fff',
    borderRadius: '50%',
    transition: 'left 0.15s',
  }),
  actionBtn: (danger) => ({
    width: '100%',
    padding: '8px 0',
    marginTop: 4,
    background: danger ? 'rgba(255,80,80,0.08)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${danger ? '#422' : '#223'}`,
    borderRadius: 4,
    color: danger ? '#a66' : '#778',
    cursor: 'pointer',
    fontSize: 12,
    letterSpacing: '0.05em',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  }),
  hint: {
    fontSize: 10,
    color: '#334',
    marginTop: 6,
    lineHeight: 1.5,
  },
};

function ActionBtn({ danger, disabled, onClick, children }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const base = css.actionBtn(danger);
  const style = {
    ...base,
    opacity: disabled ? 0.35 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: pressed
      ? (danger ? 'rgba(255,80,80,0.22)' : 'rgba(68,170,255,0.14)')
      : hovered
        ? (danger ? 'rgba(255,80,80,0.14)' : 'rgba(255,255,255,0.09)')
        : base.background,
    borderColor: pressed
      ? (danger ? '#744' : '#4af')
      : hovered
        ? (danger ? '#633' : '#335')
        : base.borderColor,
    color: pressed
      ? (danger ? '#d88' : '#4af')
      : hovered
        ? (danger ? '#c77' : '#99b')
        : base.color,
  };

  return (
    <button
      style={style}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
    >
      {children}
    </button>
  );
}

function AnimateBtn({ active, onClick }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const style = {
    width: '100%',
    marginTop: 8,
    padding: '7px 0',
    borderRadius: 4,
    fontSize: 11,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
    background: active
      ? 'rgba(140,100,255,0.18)'
      : pressed
        ? 'rgba(140,100,255,0.14)'
        : hovered
          ? 'rgba(140,100,255,0.09)'
          : 'rgba(255,255,255,0.03)',
    border: `1px solid ${active ? '#a78' : hovered || pressed ? '#654' : '#223'}`,
    color: active ? '#c9a' : hovered || pressed ? '#a88' : '#556',
  };

  return (
    <button
      style={style}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
    >
      {active ? '⏹ Stop Animation' : '▶ Animate'}
    </button>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div style={{ ...css.row, cursor: 'pointer' }} onClick={() => onChange(!value)}>
      <span style={css.label}>{label}</span>
      <div style={css.toggleSwitch(value)}>
        <div style={css.toggleKnob(value)} />
      </div>
    </div>
  );
}

export default function Controls({
  settings, setSettings, fps,
  onImage, onReset,
  imageSrc, isProcessing,
  animating, setAnimating,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const set = (key) => (val) => setSettings((s) => ({ ...s, [key]: val }));

  const handleTrackingMode = (id) => {
    if (animating) setAnimating(false);
    set('trackingMode')(id);
  };

  const handleAnimate = () => {
    setAnimating((a) => !a);
  };

  return (
    <div style={{ ...css.panel, ...(collapsed ? css.panelCollapsed : {}) }}>
      <div style={css.collapseBtn} onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? '‹' : '›'}
      </div>

      {/* Header */}
      <div style={css.header}>
        <span>pseudo3d-parallax</span>
        <span style={css.fps}>{fps} fps</span>
      </div>

      {/* Source */}
      <div style={css.section}>
        <div style={css.sectionTitle}>Source</div>
        <ImageLoader
          onImage={onImage}
          imageSrc={imageSrc}
          disabled={isProcessing}
        />
      </div>

      {/* Tracking */}
      <div style={css.section}>
        <div style={css.sectionTitle}>Tracking Mode</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { id: 'mouse',  label: '🖱 Mouse' },
            { id: 'device', label: '📱 Gyro'  },
            { id: 'webcam', label: '📷 Cam'   },
          ].map(({ id, label }) => (
            <button
              key={id}
              style={{ ...css.modeBtn(settings.trackingMode === id && !animating), opacity: animating ? 0.4 : 1 }}
              onClick={() => handleTrackingMode(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Animate button */}
        <AnimateBtn active={animating} onClick={handleAnimate} />

        {!animating && settings.trackingMode === 'webcam' && (
          <div style={css.hint}>Requires Chrome 113+. Keep your face visible in the webcam.</div>
        )}
        {!animating && settings.trackingMode === 'device' && (
          <div style={css.hint}>Tilt the device left/right to control parallax.</div>
        )}
      </div>

      {/* View */}
      <div style={css.section}>
        <div style={css.sectionTitle}>View</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {[
            { id: 'final',  label: 'Final'  },
            { id: 'depth',  label: 'Depth'  },
            { id: 'normal', label: 'Normal' },
            { id: 'ao',     label: 'AO'     },
          ].map(({ id, label }) => (
            <button
              key={id}
              style={css.modeBtn(settings.viewMode === id)}
              onClick={() => set('viewMode')(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <ActionBtn danger={true} onClick={onReset}>
          Reset View
        </ActionBtn>
      </div>

      <div style={{ flex: 1 }} />
      <div style={{ padding: '10px 16px', fontSize: 10, color: '#223', textAlign: 'center' }}>
        three.js · WebGL · pseudo3d-parallax v2.1
      </div>
    </div>
  );
}
