import { readFileSync } from 'node:fs';
import { defaultClientConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Lets the page use threads (SharedArrayBuffer), which the stem model needs to run at a bearable
 * speed on a processor. A host serving the built game has to send the same two headers.
 */
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  // The website is served from a sub-path on GitHub Pages (/soundwave/); the release workflow sets it.
  base: process.env.BASE_PATH ?? '/',
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? version) },
  plugins: [react()],
  clearScreen: false,
  preview: { headers: isolation },
  server: {
    port: 5173,
    strictPort: true,
    headers: isolation,
    // The ML service's virtualenv, the Rust build output and the test audio hold tens of
    // thousands of files the app never imports; watching them slows every dev start.
    // The built stage files are left out too: a change under public/ reloads the whole page, and
    // rebuilding the stage rewrites them one after another (refresh by hand to see a new build).
    watch: { ignored: ['**/ml-service/.venv/**', '**/src-tauri/target/**', '**/local-audio/**', '**/public/stage/**'] },
  },
  // Only index.html is an entry. By default every .html under the project is scanned for
  // dependencies (including stray ones in the virtualenv), and the page waits for that scan.
  // Bundled up front so the dev server does not reload the page mid-analysis on finding it.
  // ONNX Runtime in the build that loads its script and WebAssembly file from public/ort (see
  // scripts/copy-models.mjs) instead of carrying them inside the bundle.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  optimizeDeps: { entries: ['index.html'], include: ['fft.js'], exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'server/tests/**/*.test.ts'] },
});
