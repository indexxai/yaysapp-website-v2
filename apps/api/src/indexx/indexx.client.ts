import { ErrorCode } from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Logger } from '../common/logger';

/** Indexx said the login token is missing, expired or no longer valid. */
export class IndexxSignedOut extends Error {}

/** What the server sends as our name: Indexx refuses requests whose User-Agent says curl or postman. */
const USER_AGENT = 'YaysApp/2.0 (+https://yaysapp.com)';
const NO_ANSWER = 'Indexx didn’t answer. Try again in a minute.';

/**
 * The Indexx API (test: https://test.api.v1.indexx.ai/api/v1, production: https://api.v1.indexx.ai/api/v1).
 * Sign-in is POST /inex/user/login with the person's email and password, which returns their login token;
 * every /yays route is then called with that token. Every success is { data: ... }.
 */
export class IndexxClient {
  constructor(private readonly base: string, private readonly log: Logger, private readonly f: typeof fetch = fetch) {}

  private async send(method: 'GET' | 'POST', path: string, o: { token?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 20_000);
    try {
      return await this.f(`${this.base.replace(/\/$/, '')}${path}`, {
        method, signal: ctrl.signal,
        headers: {
          accept: 'application/json', 'user-agent': USER_AGENT,
          ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
          ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...o.headers,
        },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      });
    } catch {
      this.log.warn({ path }, 'Indexx did not answer');
      throw new AppError(503, ErrorCode.PROVIDER_UNAVAILABLE, NO_ANSWER);
    } finally { clearTimeout(timer); }
  }

  private static async body(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text().catch(() => '');
    try { const j = JSON.parse(text) as unknown; return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; }
  }
  private static message(b: Record<string, unknown>): string | null {
    const d = b.data as Record<string, unknown> | undefined;
    const m = b.message ?? d?.message ?? b.error;
    return typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : null;
  }

  /** Email and password → the person's Indexx login token. The password is never kept or logged. */
  async login(email: string, password: string): Promise<{ token: string; expiresAt: Date | null }> {
    const res = await this.send('POST', '/inex/user/login', { body: { email, password }, timeoutMs: 20_000 });
    const b = await IndexxClient.body(res);
    const d = (b.data ?? {}) as Record<string, unknown>;
    const token = [d.access_token, d.accessToken, d.token, b.access_token].find((t): t is string => typeof t === 'string' && t.length > 10);
    if (res.ok && token) return { token, expiresAt: expiryOf(token) };
    if (res.status >= 500) { this.log.warn({ status: res.status }, 'Indexx sign-in failed'); throw new AppError(503, ErrorCode.PROVIDER_UNAVAILABLE, NO_ANSWER); }
    const said = IndexxClient.message(b);
    this.log.info({ status: res.status, said }, 'Indexx sign-in refused');
    throw AppError.validation(said && !/^(ok|success)$/i.test(said) ? `Indexx said: ${said}` : 'That email and password didn’t work for Indexx.');
  }

  async get<T>(token: string, path: string, timeoutMs?: number): Promise<T> { return this.read<T>(await this.send('GET', path, { token, timeoutMs }), path); }
  async post<T>(token: string, path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    return this.read<T>(await this.send('POST', path, { token, body, headers, timeoutMs: 45_000 }), path);
  }

  private async read<T>(res: Response, path: string): Promise<T> {
    const b = await IndexxClient.body(res);
    if (res.ok) return b.data as T;
    const said = IndexxClient.message(b);
    this.log.warn({ status: res.status, code: b.code, path }, 'Indexx request failed');
    if (res.status === 401) throw new IndexxSignedOut();
    if (res.status === 400) throw AppError.validation(said ?? 'Indexx didn’t accept that.');
    if (res.status === 409) throw AppError.conflict(said ?? 'Another withdrawal is still running. Wait a moment, then refresh.');
    if (res.status === 503) throw new AppError(503, ErrorCode.PROVIDER_UNAVAILABLE, said ?? 'Indexx Exchange couldn’t take the INEX. Nothing was spent. Try again later.');
    throw new AppError(503, ErrorCode.PROVIDER_UNAVAILABLE, NO_ANSWER);
  }
}

/** When a JWT login token runs out (read from the token, not checked: Indexx checks it). */
export function expiryOf(token: string): Date | null {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof p.exp === 'number' ? new Date(p.exp * 1000) : null;
  } catch { return null; }
}
