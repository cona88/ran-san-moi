import { defineConfig } from 'vitest/config';

// Relative base so the production build works both on GitHub Pages
// (project subpath) and from a local `vite preview`.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // Three.js alone is ~500 kB; that is the floor for a WebGL game, not bloat.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep Three.js in its own long-cached vendor chunk so game-code edits
        // don't invalidate it and neither chunk trips the size warning.
        manualChunks: { three: ['three'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
