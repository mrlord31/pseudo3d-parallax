import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.glsl'],
  optimizeDeps: {
    // @huggingface/transformers ships WASM files — Vite must not pre-bundle it
    exclude: ['@huggingface/transformers'],
  },
  server: {
    proxy: {
      '/v2': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/v2/, ''),
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.js'],
    include: ['src/tests/**/*.test.{js,jsx}'],
  },
});
