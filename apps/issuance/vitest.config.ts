import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Tests run the sources through SWC (the same .swcrc as the build): Nest's
 * dependency injection needs the decorator metadata that Vite's own
 * TypeScript transform doesn't emit.
 */
export default defineConfig({
  plugins: [swc.vite()],
  test: { include: ['test/**/*.test.ts'] },
});
