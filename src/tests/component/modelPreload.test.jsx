/**
 * Component tests — Model preload behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// All factories must be self-contained — no external refs (hoisting limitation)
vi.mock('../../components/ParallaxRenderer.js', () => ({
  ParallaxRenderer: class {
    init() {}
    start() {}
    dispose() {}
    updateSettings() {}
    setParallaxOffset() {}
    loadTextures() {}
    reset() {}
  },
}));

vi.mock('../../components/HeadTracker.js', () => ({
  HeadTracker: class {
    setMode() {}
    destroy() {}
  },
}));

vi.mock('../../components/DepthMapGenerator.js', () => ({
  preloadDepthModel: vi.fn(),
  generateAllMaps: vi.fn(),
}));

vi.mock('../../resources/astronaut.jpg', () => ({ default: 'mock-astronaut.jpg' }));
vi.mock('../../shaders/parallax.vert.glsl?raw',   () => ({ default: 'void main(){}' }));
vi.mock('../../shaders/parallax.frag.glsl?raw',   () => ({ default: 'void main(){}' }));
vi.mock('../../shaders/lenticular.frag.glsl?raw', () => ({ default: 'float lenticularOverlay(vec2 uv){ return 0.0; }' }));

import { preloadDepthModel } from '../../components/DepthMapGenerator.js';
import App from '../../App.jsx';

describe('App — model preload on mount', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('calls preloadDepthModel on mount', async () => {
    preloadDepthModel.mockResolvedValue(undefined);
    render(<App />);
    await waitFor(() => expect(preloadDepthModel).toHaveBeenCalledTimes(1));
  });

  it('shows "Initialising pipeline" while model is loading', async () => {
    preloadDepthModel.mockReturnValue(new Promise(() => {}));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Initialising pipeline/i)).toBeInTheDocument()
    );
  });

  it('shows Load Demo Scene button after model is ready', async () => {
    preloadDepthModel.mockResolvedValue(undefined);
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Load Demo Scene/i)).toBeInTheDocument()
    );
  });

  it('preloadDepthModel receives a progress callback as first arg', async () => {
    preloadDepthModel.mockResolvedValue(undefined);
    render(<App />);
    await waitFor(() => expect(preloadDepthModel).toHaveBeenCalledTimes(1));
    const [progressCb] = preloadDepthModel.mock.calls[0];
    expect(typeof progressCb).toBe('function');
  });
});

describe('App — overlay behavior', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('renders intro overlay on first load', () => {
    preloadDepthModel.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole('heading', { name: /pseudo3d-parallax/i })).toBeInTheDocument();
  });

  it('shows "Loading fallback depth model" text while model is loading', async () => {
    preloadDepthModel.mockReturnValue(new Promise(() => {}));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Loading fallback depth model/i)).toBeInTheDocument()
    );
  });
});
