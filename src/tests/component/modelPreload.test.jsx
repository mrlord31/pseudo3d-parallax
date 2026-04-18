/**
 * Component tests — Model preload behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  generateAllMaps: vi.fn(),
}));

vi.mock('../../resources/astronaut.jpg', () => ({ default: 'mock-astronaut.jpg' }));
vi.mock('../../resources/sample_image.png', () => ({ default: 'mock-sample.png' }));
vi.mock('../../utils/imageUtils.js', () => ({
  loadImage: vi.fn().mockResolvedValue({ naturalWidth: 100, naturalHeight: 100 }),
}));
vi.mock('../../shaders/parallax.vert.glsl?raw',   () => ({ default: 'void main(){}' }));
vi.mock('../../shaders/parallax.frag.glsl?raw',   () => ({ default: 'void main(){}' }));
vi.mock('../../shaders/lenticular.frag.glsl?raw', () => ({ default: 'float lenticularOverlay(vec2 uv){ return 0.0; }' }));

import App from '../../App.jsx';

describe('App — overlay behavior', () => {
  it('renders intro overlay with project name on first load', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /pseudo3d-parallax/i })).toBeInTheDocument();
  });

  it('shows Load Demo Scene button immediately — no model preload needed', () => {
    render(<App />);
    expect(screen.getByText(/Load Demo Scene/i)).toBeInTheDocument();
  });

  it('shows error feedback when generateAllMaps rejects', async () => {
    const { generateAllMaps } = await import('../../components/DepthMapGenerator.js');
    generateAllMaps.mockRejectedValue(new Error('server not running'));
    render(<App />);
    // close overlay first
    const btn = screen.getByText(/Load Demo Scene/i);
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText(/server not running/i)).toBeInTheDocument()
    );
  });
});
