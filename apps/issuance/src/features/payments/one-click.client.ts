/**
 * The 1Click HTTP API (docs.near-intents.org, 1Click API; specification at
 * https://1click.chaindefuser.com/docs/v0/openapi.yaml). Shared by the
 * payments feature (the quotes customers pay) and the refunds feature (the
 * quotes that send refunds back to the customer).
 */

export type OneClickConnection = {
  baseUrl?: string;
  /**
   * Partner JWT, sent as X-API-Key: required for everything on FAR
   * (CONFIDENTIAL_INTENTS). 1Click's user sessions (Authorization: Bearer)
   * are not used: they only read a user's private balances and history, and
   * on these endpoints that header would be taken for a partner key.
   */
  apiKey?: string;
};

/** A non-2xx answer, with its status and body (1Click explains itself in `{"message": …}`). */
export class OneClickError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    super(`1Click ${method} ${path} failed (${status}): ${body}`);
    this.name = 'OneClickError';
    this.status = status;
    this.body = body;
  }

  /** The API's own explanation, when it gave one. */
  get apiMessage(): string {
    try {
      const parsed = JSON.parse(this.body) as { message?: unknown };
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // Not JSON: the body itself is the explanation.
    }
    return this.body;
  }
}

export class OneClickClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(connection: OneClickConnection) {
    this.baseUrl = (connection.baseUrl ?? 'https://1click.chaindefuser.com').replace(/\/+$/, '');
    this.apiKey = connection.apiKey;
  }

  /** One request; throws OneClickError for any non-2xx answer. */
  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new OneClickError(method, path, response.status, text);
    return JSON.parse(text) as T;
  }
}
