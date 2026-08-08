import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Cloudflare Pages SPA target. Workspace @penny/* packages are consumed as
// TS source via aliases so we don't depend on a build step of the packages.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@penny/db-types': r('../../packages/db-types/src/index.ts'),
      '@penny/api-client': r('../../packages/api-client/src/index.ts'),
      '@penny/geo': r('../../packages/geo/src/index.ts'),
      '@penny/ui': r('../../packages/ui/src/index.ts'),
      '@': r('./src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
