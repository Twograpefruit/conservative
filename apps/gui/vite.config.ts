import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function runtimeBff(): string {
  if (process.env.OCG_BFF) return process.env.OCG_BFF;
  try {
    const file = path.join(process.env.LOCALAPPDATA ?? '', 'opencode-gui', 'runtime.json');
    if (fs.existsSync(file)) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (json?.bff?.url) return json.bff.url;
    }
  } catch {
    /* fall through */
  }
  return 'http://127.0.0.1:4310';
}

const target = runtimeBff();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ocg/protocol': fileURLToPath(new URL('../../packages/protocol/src/index.ts', import.meta.url)),
      '@ocg/diff': fileURLToPath(new URL('../../packages/diff/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      // Resolve the BFF port at request time so auto-fallback (4310 -> 4311...) works.
      '/api': { target, changeOrigin: false, ws: true, router: () => runtimeBff() },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
