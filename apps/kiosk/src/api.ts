/**
 * Talks to the ATM controller (src/controller/server.ts). The page holds no
 * secret except the kiosk key, which only proves this is the paired screen.
 */
import { KIOSK_KEY_HEADER, type SessionView, type Setup, type StartRequest } from '@nearcash/kiosk-api';

const KEY_STORAGE = 'nearcash-kiosk-key';

/**
 * Pairing: the operator opens the page once as …/#key=<NEARCASH_KIOSK_KEY>
 * (the pairing QR code), and the key is kept in this browser.
 *
 * The key stays in the address on purpose. On an iPhone, the Home Screen
 * app (Share → Add to Home Screen) has its own storage, apart from Safari's:
 * it saves the address as it is when added, and pairs itself from it the
 * first time it starts. Removing the key from the address would leave the
 * Home Screen app unpaired. (The fragment after # is never sent to a server.)
 */
export function pairFromUrl(): void {
  const match = /(?:^#|&)key=([^&]+)/.exec(window.location.hash);
  if (!match) return;
  try {
    window.localStorage.setItem(KEY_STORAGE, decodeURIComponent(match[1]!));
  } catch {
    // Storage blocked: the screen will report it is not paired.
  }
}

function kioskKey(): string | null {
  try {
    return window.localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

/** A non-2xx answer; `message` is the controller's explanation. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const key = kioskKey();
  const response = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { [KIOSK_KEY_HEADER]: key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `error ${response.status}`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      // Not JSON: keep the status.
    }
    throw new ApiError(response.status, message);
  }
  return JSON.parse(text) as T;
}

export const api = {
  setup: () => call<Setup>('GET', '/api/setup'),
  session: () => call<SessionView | null>('GET', '/api/session'),
  start: (request: StartRequest) => call<SessionView>('POST', '/api/session', request),
  cancel: () => call<SessionView>('POST', '/api/session/cancel'),
  finish: () => call<null>('POST', '/api/session/finish'),
  simulatePayment: () => call<SessionView>('POST', '/api/session/simulate-payment'),
};
