import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The kiosk page, a plain Vite app:
 *
 *   pnpm kiosk:dev       hot reload on :5181, for development
 *   pnpm kiosk:build     the page → dist/
 *   pnpm kiosk:preview   serves dist/ as the ATM does (on the Raspberry Pi)
 *
 * In both servers /api goes to the ATM server (apps/atm), so the page talks
 * to its own origin and the ATM server never has to be reachable from the
 * network. On the Pi the settings come from <repository root>/.env.atm:
 *
 *   NEARCASH_KIOSK_HOST       0.0.0.0                  the iPhone connects over the network
 *   NEARCASH_KIOSK_PORT       8791
 *   NEARCASH_KIOSK_TLS_CERT   PEM certificate file  ┐ both set: HTTPS, so the screen's
 *   NEARCASH_KIOSK_TLS_KEY    PEM key file          ┘ pairing key never crosses the Wi-Fi in clear
 *   NEARCASH_ATM_SERVER_URL   http://127.0.0.1:8792    where /api is forwarded
 */
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env.atm');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;

const atmServer = env.NEARCASH_ATM_SERVER_URL ?? 'http://127.0.0.1:8792';
const certFile = env.NEARCASH_KIOSK_TLS_CERT;
const keyFile = env.NEARCASH_KIOSK_TLS_KEY;
if (Boolean(certFile) !== Boolean(keyFile)) throw new Error('set both NEARCASH_KIOSK_TLS_CERT and NEARCASH_KIOSK_TLS_KEY, or neither');
const https = certFile && keyFile ? { cert: readFileSync(certFile), key: readFileSync(keyFile) } : undefined;

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5181,
    proxy: { '/api': atmServer },
  },
  preview: {
    host: env.NEARCASH_KIOSK_HOST ?? '0.0.0.0',
    port: Number(env.NEARCASH_KIOSK_PORT ?? 8791),
    strictPort: true,
    https,
    proxy: { '/api': atmServer },
    headers: {
      // The page loads nothing from elsewhere and uses no camera, microphone or location.
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-Content-Type-Options': 'nosniff',
    },
  },
});
