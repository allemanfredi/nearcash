import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A static single-page site: `pnpm website:build` writes plain files to dist/,
// which any static host can serve. Fonts are bundled, so the page makes no
// requests to third parties.
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the build works from any folder or sub-path.
  base: './',
  server: { port: 5180 },
});
