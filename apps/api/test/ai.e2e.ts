// The light Jack's AI: talking through OpenRouter or OpenAI, pictures made and changed in the conversation,
// documents, "use the full Jack's AI" for specialised work, and sending pictures and documents into chats.
import type { AiChat, AiInfo, AiReply, ChatMessage } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { makeUser, type TUser } from './chat-helpers';

const TZ = { 'x-time-zone': 'Asia/Karachi' };
const noLog = { warn() {} } as never;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OpenRouter and OpenAI talking', () => {
  it('OpenRouter: the model, key and app name are sent; web answers use the web plugin and list their sources', async () => {
    const { OpenAiCompatProvider } = await import('../src/ai/ai.provider');
    let sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | null = null;
    const fake = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      sent = { url, body: JSON.parse(init.body), headers: init.headers };
      return reply({ choices: [{ finish_reason: 'stop', message: { content: 'Run early ([weather.example.com](https://weather.example.com/lhr)). Air is worse later ([air.example.org](https://air.example.org/x)).', annotations: [
        { type: 'url_citation', url_citation: { url: 'https://weather.example.com/lhr', title: 'Lahore hourly', content: 'Coolest 6–8 am' } },
        { type: 'url_citation', url_citation: { url: 'https://air.example.org/x', title: '', content: 'Rises after 6 pm' } },
        { type: 'url_citation', url_citation: { url: 'https://weather.example.com/lhr', title: 'dup' } },
      ] } }] });
    }) as unknown as typeof fetch;
    const p = new OpenAiCompatProvider('openrouter', { baseUrl: 'https://openrouter.ai/api/v1/', key: 'sk-or', model: 'openai/gpt-4o-mini', webUrl: 'https://web.yays.app' }, noLog, fake);
    const r = await p.complete({ system: 'sys', turns: [{ role: 'user', text: 'Best time to run?' }], search: true, maxTokens: 300 });
    expect(sent!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(sent!.headers).toMatchObject({ authorization: 'Bearer sk-or', 'HTTP-Referer': 'https://web.yays.app', 'X-Title': 'YaysApp' });
    expect(sent!.body).toMatchObject({ model: 'openai/gpt-4o-mini', max_tokens: 300, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Best time to run?' }], plugins: [{ id: 'web', max_results: 5 }] });
    expect(r.text).toBe('Run early (weather.example.com [1]). Air is worse later (air.example.org [2]).');
    expect(r.sources.map((s) => `${s.n} ${s.domain} ${s.title}`)).toEqual(['1 weather.example.com Lahore hourly', '2 air.example.org air.example.org']);
    // A plain question has no plugin.
    await p.complete({ system: 'sys', turns: [{ role: 'user', text: 'hi' }] });
    expect(sent!.body.plugins).toBeUndefined();
  });

  it('OpenAI: web answers switch to its search model; no OpenRouter headers', async () => {
    const { OpenAiCompatProvider } = await import('../src/ai/ai.provider');
    const bodies: Array<Record<string, unknown>> = []; let headers: Record<string, string> = {};
    const fake = (async (_u: string, init: { body: string; headers: Record<string, string> }) => { bodies.push(JSON.parse(init.body)); headers = init.headers; return reply({ choices: [{ message: { content: 'ok' } }] }); }) as unknown as typeof fetch;
    const p = new OpenAiCompatProvider('openai', { baseUrl: 'https://api.openai.com/v1', key: 'sk-x', model: 'gpt-4o-mini', webUrl: 'x' }, noLog, fake);
    await p.complete({ system: 's', turns: [{ role: 'user', text: 'news?' }], search: true });
    await p.complete({ system: 's', turns: [{ role: 'user', text: 'hi' }] });
    expect(bodies[0]).toMatchObject({ model: 'gpt-4o-mini-search-preview', web_search_options: {} });
    expect(bodies[1]).toMatchObject({ model: 'gpt-4o-mini' });
    expect(headers['X-Title']).toBeUndefined();
  });

  it('busy, wrong key, out of credit, no answer and refusals give plain messages', async () => {
    const { OpenAiCompatProvider } = await import('../src/ai/ai.provider');
    const make = (res: () => Response | Promise<Response>) => new OpenAiCompatProvider('openrouter', { baseUrl: 'https://x', key: 'k', model: 'm', webUrl: 'w' }, noLog, (async () => res()) as unknown as typeof fetch);
    const ask = (p: InstanceType<typeof OpenAiCompatProvider>) => p.complete({ system: 's', turns: [{ role: 'user', text: 'q' }] });
    await expect(ask(make(() => reply({ error: 'rate' }, 429)))).rejects.toThrow('busy right now');
    await expect(ask(make(() => reply({ error: 'key' }, 401)))).rejects.toThrow('isn’t set up correctly');
    await expect(ask(make(() => reply({ error: 'credit' }, 402)))).rejects.toThrow('paused for now');
    await expect(ask(make(() => reply({ error: 'x' }, 500)))).rejects.toThrow('couldn’t answer just now');
    await expect(ask(make(() => reply({ choices: [{ message: { content: '' } }] })))).rejects.toThrow('couldn’t answer just now');
    await expect(ask(make(() => { throw new Error('network'); }))).rejects.toThrow('didn’t answer in time');
    expect((await ask(make(() => reply({ choices: [{ finish_reason: 'content_filter', message: { content: null } }] })))).text).toBe('I can’t help with that one.');
    expect((await ask(make(() => reply({ choices: [{ message: { content: null, refusal: 'I can’t do that.' } }] })))).text).toBe('I can’t do that.');
  });
});

describe('OpenAI pictures', () => {
  it('new pictures: model, size and count are sent, PNGs come back; edits send the picture as a file', async () => {
    const { OpenAiImages } = await import('../src/ai/ai.images');
    const calls: Array<{ url: string; json?: Record<string, unknown>; form?: FormData }> = [];
    const b64 = Buffer.from('fake-png').toString('base64');
    const fake = (async (url: string, init: { body: string | FormData }) => {
      calls.push({ url, ...(typeof init.body === 'string' ? { json: JSON.parse(init.body) } : { form: init.body }) });
      return reply({ data: url.endsWith('/generations') ? [{ b64_json: b64 }, { b64_json: b64 }] : [{ b64_json: b64 }] });
    }) as unknown as typeof fetch;
    const p = new OpenAiImages({ baseUrl: 'https://api.openai.com/v1', key: 'sk-x', model: 'gpt-image-1' }, noLog, fake);
    const made = await p.generate({ prompt: 'a bunny running at sunset', n: 2 });
    expect(calls[0]).toMatchObject({ url: 'https://api.openai.com/v1/images/generations', json: { model: 'gpt-image-1', prompt: 'a bunny running at sunset', n: 2, size: '1024x1024' } });
    expect(made).toHaveLength(2);
    expect(made[0]!.png.toString()).toBe('fake-png');
    const edited = await p.edit({ prompt: 'more orange', image: Buffer.from('src'), mime: 'image/png' });
    expect(calls[1]!.url).toBe('https://api.openai.com/v1/images/edits');
    expect(calls[1]!.form!.get('prompt')).toBe('more orange');
    expect(calls[1]!.form!.get('model')).toBe('gpt-image-1');
    expect((calls[1]!.form!.get('image') as File).size).toBe(3);
    expect(edited.width).toBe(1024);
  });

  it('a refused prompt, being busy and a bad key each say what happened', async () => {
    const { OpenAiImages } = await import('../src/ai/ai.images');
    const make = (status: number, body: unknown) => new OpenAiImages({ baseUrl: 'https://x', key: 'k', model: 'gpt-image-1' }, noLog, (async () => reply(body, status)) as unknown as typeof fetch);
    await expect(make(400, { error: { code: 'moderation_blocked', message: 'safety system' } }).generate({ prompt: 'x', n: 1 })).rejects.toThrow('Jack can’t make that picture');
    await expect(make(429, {}).generate({ prompt: 'x', n: 1 })).rejects.toThrow('busy making pictures');
    await expect(make(401, {}).generate({ prompt: 'x', n: 1 })).rejects.toThrow('aren’t set up correctly');
    await expect(make(200, { data: [] }).generate({ prompt: 'x', n: 1 })).rejects.toThrow('didn’t come out');
  });
});

describe('Jack’s AI in the app (sample mode)', () => {
  let t: TestApp; let sara: TUser; let amara: TUser; let lena: TUser;
  beforeAll(async () => {
    t = await startApp({ AI_IMAGE_OPTIONS: '2', AI_IMAGES_PER_DAY: '5', JACK_AI_URL: 'https://jack.example.com' });
    sara = await makeUser(t, 'Sara'); amara = await makeUser(t, 'Amara'); lena = await makeUser(t, 'Lena');
  });
  afterAll(async () => { await t.close(); });
  const ask = (u: TUser, chat: string | null, body: Record<string, unknown>) => t.http.post(chat ? `/v1/ai/chats/${chat}/messages` : '/v1/ai/chats').set(u.auth).set(TZ).send(body);
  const fetchFile = (url: string) => t.http.get(new URL(url).pathname);

  it('says what it can do', async () => {
    const info = (await t.http.get('/v1/ai/info').set(sara.auth).expect(200)).body as AiInfo;
    expect(info).toEqual({ model: 'demo', images: true, search: false, demo: true, fullJackUrl: 'https://jack.example.com' });
  });

  it('pictures: two options saved in the conversation, then a change to number 1; today’s picture count goes down', async () => {
    const r = (await ask(sara, null, { text: 'Our bunny mascot running a race in Lahore at sunset', mode: 'image' }).expect(200)).body as AiReply;
    expect(r.assistant.mode).toBe('image');
    expect(r.assistant.text).toMatch(/Here are 2 options/);
    expect(r.assistant.images!.map((i) => i.n)).toEqual([1, 2]);
    for (const i of r.assistant.images!) {
      const f = await fetchFile(i.url).expect(200);
      expect(f.headers['content-type']).toMatch(/image\/png/);
    }
    expect(r.quota.images).toEqual({ used: 2, limit: 5, perRequest: 2 });
    expect(r.quota.used).toBe(0); // pictures don't use up messages

    const e = (await ask(sara, r.chat.id, { text: 'Make it more orange', mode: 'image', editOf: { messageId: r.assistant.id, n: 1 } }).expect(200)).body as AiReply;
    expect(e.assistant.images).toHaveLength(1);
    expect(e.assistant.text).toBe('Here’s number 1 with your change.');
    expect(e.user.editOf).toEqual({ messageId: r.assistant.id, n: 1 });
    expect(e.quota.images.used).toBe(3);
    // The whole conversation comes back with the pictures, in order.
    const chat = (await t.http.get(`/v1/ai/chats/${r.chat.id}`).set(sara.auth).set(TZ).expect(200)).body as AiChat;
    expect(chat.messages.map((m) => `${m.role}:${m.images?.length ?? 0}`)).toEqual(['user:0', 'assistant:2', 'user:0', 'assistant:1']);
    await fetchFile(chat.messages[3]!.images![0]!.url).expect(200);

    // A picture that isn't there, or someone else's.
    expect((await ask(sara, r.chat.id, { text: 'x', mode: 'image', editOf: { messageId: r.assistant.id, n: 4 } })).status).toBe(404);
    const other = (await ask(amara, null, { text: 'hello', mode: 'chat' }).expect(200)).body as AiReply;
    expect((await ask(amara, other.chat.id, { text: 'x', mode: 'image', editOf: { messageId: r.assistant.id, n: 1 } })).status).toBe(404);
    expect((await ask(sara, null, { text: 'x', editOf: { messageId: r.assistant.id, n: 1 } })).status).toBe(400);
  });

  it('a refused picture and running out don’t use up pictures; asking for a picture in Chat makes one', async () => {
    const before = ((await t.http.get('/v1/ai/quota').set(sara.auth).set(TZ).expect(200)).body).images.used as number; // 3 of 5
    const no = await ask(sara, null, { text: 'refuse-me please', mode: 'image' });
    expect(no.status).toBe(400);
    expect(no.body.error.message).toMatch(/Jack can’t make that picture/);
    expect(((await t.http.get('/v1/ai/quota').set(sara.auth).set(TZ)).body).images.used).toBe(before);
    // "Draw…" in Chat mode is a picture request too.
    const auto = (await ask(sara, null, { text: 'Draw a poster of a cat drinking chai' }).expect(200)).body as AiReply;
    expect(auto.assistant.images).toHaveLength(2);
    expect(auto.quota.images.used).toBe(5);
    const out = await ask(sara, null, { text: 'a dog', mode: 'image' });
    expect(out.status).toBe(409);
    expect(out.body.error.message).toBe('You’ve made today’s 5 pictures. They reset at midnight.');
    expect(out.body.error.details).toEqual({ imageQuota: true });
  });

  it('specialised work points to the full Jack’s AI; documents still work', async () => {
    const r = (await ask(amara, null, { text: 'Book me the cheapest flight to Dubai on 5 Nov' }).expect(200)).body as AiReply;
    expect(r.assistant.handoff).toEqual({ url: 'https://jack.example.com', label: 'Open the full Jack’s AI' });
    expect(r.assistant.text).not.toContain('---JACK---');
    const d = (await ask(amara, null, { text: 'Write a sponsorship proposal for our running club', mode: 'document' }).expect(200)).body as AiReply;
    expect(d.assistant.document!.title).toBe('Sponsorship proposal for our running club');
    expect(d.assistant.handoff).toBeUndefined();
  });

  it('a picture or a document goes into a YaysApp chat as a normal photo or file; not into chats I’m not in', async () => {
    const conv = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: amara.id }).expect(200)).body.id as string;
    const pic = (await ask(amara, null, { text: 'A sunrise over Lahore', mode: 'image' })).body as AiReply;
    // Amara is out of nothing yet (her own limit).
    expect(pic.assistant.images).toHaveLength(2);
    const shared = (await t.http.post(`/v1/ai/messages/${pic.assistant.id}/share`).set(amara.auth).send({ conversationId: conv, n: 2 }).expect(200)).body;
    expect(shared.conversationId).toBe(conv);
    const doc = (await ask(amara, null, { text: 'Write a menu for Sunday lunch', mode: 'document' })).body as AiReply;
    await t.http.post(`/v1/ai/messages/${doc.assistant.id}/share`).set(amara.auth).send({ conversationId: conv, caption: 'Menu for Sunday' }).expect(200);
    const msgs = (await t.http.get(`/v1/conversations/${conv}/messages`).set(sara.auth).expect(200)).body.items as ChatMessage[];
    const photo = msgs.find((m) => m.attachment?.kind === 'image')!;
    expect(photo.text).toBe('Made with Jack’s AI');
    expect(photo.attachment).toMatchObject({ name: 'jacks-ai-2.png', mime: 'image/png' });
    await fetchFile(photo.attachment!.url!).expect(200);
    const file = msgs.find((m) => m.attachment?.kind === 'file')!;
    expect(file.text).toBe('Menu for Sunday');
    expect(file.attachment!.name).toBe('Menu for Sunday lunch.doc');
    const res = await fetchFile(file.attachment!.url!).buffer(true).parse((r, cb) => { const parts: Buffer[] = []; r.on('data', (c: Buffer) => parts.push(c)); r.on('end', () => cb(null, Buffer.concat(parts))); }).expect(200);
    expect((res.body as Buffer).toString()).toContain('<h1>Menu for Sunday lunch</h1>');

    // Not my message, no picture there, a chat I'm not in.
    expect((await t.http.post(`/v1/ai/messages/${pic.assistant.id}/share`).set(sara.auth).send({ conversationId: conv, n: 1 })).status).toBe(404);
    expect((await t.http.post(`/v1/ai/messages/${pic.assistant.id}/share`).set(amara.auth).send({ conversationId: conv, n: 3 })).status).toBe(404);
    expect((await t.http.post(`/v1/ai/messages/${pic.user.id}/share`).set(amara.auth).send({ conversationId: conv, n: 1 })).status).toBe(404);
    const lenaSara = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: lena.id }).expect(200)).body.id as string;
    expect((await t.http.post(`/v1/ai/messages/${pic.assistant.id}/share`).set(amara.auth).send({ conversationId: lenaSara, n: 1 })).status).toBeGreaterThanOrEqual(403);

    // Deleting the Jack conversation removes its pictures, except the one sent into the chat.
    const kept = photo.attachment!.url!;
    const gone = pic.assistant.images!.find((i) => i.n === 1)!.url;
    await t.http.delete(`/v1/ai/chats/${pic.chat.id}`).set(amara.auth).expect(204);
    expect((await fetchFile(gone)).status).toBe(404);
    await fetchFile(kept).expect(200);
  });
});
