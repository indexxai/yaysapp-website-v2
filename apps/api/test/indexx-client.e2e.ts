import pino from 'pino';
import { AppError } from '../src/common/app-error';
import { expiryOf, IndexxClient, IndexxSignedOut } from '../src/indexx/indexx.client';

const log = pino({ level: 'silent' });
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error('no error'); };

describe('Indexx client', () => {
  it('sends the token and a User-Agent Indexx accepts, to the right address', async () => {
    let seen: { url: string; h: Headers } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, h: new Headers(init.headers) }; return new Response(JSON.stringify({ data: { ok: 1 } })); }) as unknown as typeof fetch;
    expect(await new IndexxClient('https://test.api.v1.indexx.ai/api/v1/', log, f).get('tok-123', '/yays/wallet/summary')).toEqual({ ok: 1 });
    expect(seen!.url).toBe('https://test.api.v1.indexx.ai/api/v1/yays/wallet/summary');
    expect(seen!.h.get('authorization')).toBe('Bearer tok-123');
    expect(seen!.h.get('user-agent')).not.toMatch(/curl|postman/i);
  });

  it('sign-in: a token in data.access_token; anything else is a clear message', async () => {
    const jwt = `x.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url')}.y`;
    expect(await new IndexxClient('https://i', log, reply(200, { data: { access_token: jwt } })).login('a@b.io', 'p')).toEqual({ token: jwt, expiresAt: new Date(2_000_000_000_000) });
    const noToken = await err(new IndexxClient('https://i', log, reply(200, { status: 401, message: 'Incorrect password' })).login('a@b.io', 'p')) as AppError;
    expect(noToken.message).toBe('Indexx said: Incorrect password');
    expect(((await err(new IndexxClient('https://i', log, reply(404, {})).login('a@b.io', 'p'))) as AppError).message).toBe('That email and password didn’t work for Indexx.');
    expect(((await err(new IndexxClient('https://i', log, reply(502, {})).login('a@b.io', 'p'))) as AppError).status).toBe(503);
  });

  it('errors: 401 ends the sign-in; 400, 409 and 503 keep Indexx’s message; down or unknown says try later', async () => {
    expect(await err(new IndexxClient('https://i', log, reply(401, { message: 'Unauthorized: jwt expired' })).get('t', '/x'))).toBeInstanceOf(IndexxSignedOut);
    expect(((await err(new IndexxClient('https://i', log, reply(400, { message: 'The minimum withdrawal is 25 INEX.', code: 'validation' })).get('t', '/x'))) as AppError)).toMatchObject({ status: 400, message: 'The minimum withdrawal is 25 INEX.' });
    expect(((await err(new IndexxClient('https://i', log, reply(409, { code: 'in_progress' })).post('t', '/x', {}))) as AppError).status).toBe(409);
    expect(((await err(new IndexxClient('https://i', log, reply(503, { message: 'Exchange is down' })).post('t', '/x', {}))) as AppError).message).toBe('Exchange is down');
    expect(((await err(new IndexxClient('https://i', log, reply(500, { code: 'server' })).get('t', '/x'))) as AppError).message).toContain('didn’t answer');
    const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(((await err(new IndexxClient('https://i', log, offline).get('t', '/x'))) as AppError).status).toBe(503);
    expect(expiryOf('not-a-jwt')).toBeNull();
  });
});
