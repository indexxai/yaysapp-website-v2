import type { ChatMessage, ConversationSummary } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { cid, makeUser, type TUser } from './chat-helpers';

/** Uploads bytes the way apps do: ask for an upload link, then PUT the file to it. Returns the storage key. */
async function upload(t: TestApp, u: TUser, o: { purpose: 'media' | 'thumb'; kind?: string; type: string; data: Buffer; name?: string }) {
  const r = await t.http.post('/v1/media/upload-url').set(u.auth).send({ purpose: o.purpose, kind: o.kind, contentType: o.type, size: o.data.length, name: o.name });
  if (r.status !== 200) throw Object.assign(new Error(`upload-url ${r.status}: ${JSON.stringify(r.body)}`), { res: r });
  await t.http.put(new URL(r.body.uploadUrl).pathname).set('content-type', o.type).send(o.data).expect(204);
  return r.body.key as string;
}
const path = (url: string) => new URL(url).pathname;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2000, 7)]);
const jpg = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(800, 3)]);

describe('Photos, videos, voice notes and files', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let c: ConversationSummary;
  const send = (u: TUser, conv: string, body: object) => t.http.post(`/v1/conversations/${conv}/messages`).set(u.auth).send({ clientId: cid(), ...body });
  const history = async (u: TUser, conv: string) => (await t.http.get(`/v1/conversations/${conv}/messages`).set(u.auth).expect(200)).body.items as ChatMessage[];
  beforeAll(async () => {
    t = await startApp();
    [ali, sara, omar] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar')];
    c = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body;
  });
  afterAll(async () => { await t.close(); });

  it('a photo with a caption and a preview reaches the other person with working, cacheable links', async () => {
    const key = await upload(t, ali, { purpose: 'media', kind: 'image', type: 'image/png', data: png, name: 'poster.png' });
    const thumbKey = await upload(t, ali, { purpose: 'thumb', type: 'image/jpeg', data: jpg });
    const r = await send(ali, c.id, { text: '  Poster for Friday 🎉 ', attachment: { kind: 'image', key, thumbKey, name: 'poster.png', width: 1200, height: 800 } }).expect(200);
    const m = r.body.message as ChatMessage;
    expect(m).toMatchObject({ type: 'media', text: 'Poster for Friday 🎉', attachment: { kind: 'image', name: 'poster.png', size: png.length, mime: 'image/png', width: 1200, height: 800 } });
    const seen = (await history(sara, c.id)).find((x) => x.id === m.id)!;
    const img = await t.http.get(path(seen.attachment!.url)).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.from(img.body).equals(png)).toBe(true);
    expect((await t.http.get(path(seen.attachment!.thumbUrl!)).expect(200)).headers['content-type']).toBe('image/jpeg');
    // The same link within the hour, so browsers cache the picture.
    expect((await history(sara, c.id)).find((x) => x.id === m.id)!.attachment!.url).toBe(seen.attachment!.url);
    const s = (await t.http.get(`/v1/conversations/${c.id}`).set(sara.auth).expect(200)).body as ConversationSummary;
    expect(s.lastMessage).toMatchObject({ type: 'media', attachment: { kind: 'image' } });
    const pinned = (await t.http.post(`/v1/conversations/${c.id}/messages/${m.id}/pin`).set(sara.auth).expect(200)).body as ConversationSummary;
    expect(pinned.pins[0].text).toBe('📷 Poster for Friday 🎉');
    // Replies quote the photo; photos can't be edited.
    const reply = (await send(sara, c.id, { text: 'Love it', replyToId: m.id }).expect(200)).body.message as ChatMessage;
    expect(reply.replyTo).toMatchObject({ type: 'media', text: 'Poster for Friday 🎉', attachment: { kind: 'image', thumbUrl: expect.any(String) } });
    expect((await t.http.patch(`/v1/conversations/${c.id}/messages/${m.id}`).set(ali.auth).send({ text: 'x' })).body.error.message).toBe('Photos, videos and files can’t be edited. Delete and send again.');
  });

  it('voice notes keep their length and waveform, and audio can be fetched in ranges for seeking', async () => {
    const audio = Buffer.alloc(5000, 9);
    const key = await upload(t, sara, { purpose: 'media', kind: 'voice', type: 'audio/webm;codecs=opus', data: audio });
    const wave = [...Array(48)].map((_, i) => (i * 7) % 100);
    const m = (await send(sara, c.id, { attachment: { kind: 'voice', key, durationMs: 12_400, waveform: wave } }).expect(200)).body.message as ChatMessage;
    expect(m).toMatchObject({ type: 'media', text: '', attachment: { kind: 'voice', mime: 'audio/webm', durationMs: 12_400, waveform: wave, name: 'Voice message', thumbUrl: null } });
    const part = await t.http.get(path(m.attachment!.url)).set('range', 'bytes=100-199').expect(206);
    expect(part.headers['content-range']).toBe(`bytes 100-199/${audio.length}`);
    expect(part.headers['accept-ranges']).toBe('bytes');
    expect(Number(part.headers['content-length'])).toBe(100);
    await t.http.get(path(m.attachment!.url)).set('range', 'bytes=99999-').expect(416);
    const tail = await t.http.get(path(m.attachment!.url)).set('range', 'bytes=-50').expect(206);
    expect(tail.headers['content-range']).toBe(`bytes ${audio.length - 50}-${audio.length - 1}/${audio.length}`);
    const tooLong = await send(sara, c.id, { attachment: { kind: 'voice', key, durationMs: 16 * 60 * 1000 } });
    expect(tooLong.body.error.message).toBe('Voice messages can be up to 15 minutes.');
  });

  it('files download under their own (cleaned) name', async () => {
    const pdf = Buffer.from('%PDF-1.4 test');
    const key = await upload(t, ali, { purpose: 'media', kind: 'file', type: 'application/pdf', data: pdf, name: 'Brand guide.pdf' });
    expect(key).toMatch(/\.pdf$/);
    const m = (await send(ali, c.id, { attachment: { kind: 'file', key, name: '../../Brand\nguide "final".pdf' } }).expect(200)).body.message as ChatMessage;
    expect(m.attachment!.name).toBe('.._.._Brand_guide "final".pdf');
    const res = await t.http.get(path(m.attachment!.url)).expect(200);
    expect(res.headers['content-disposition']).toContain('attachment;');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
    // Odd file types still upload as files, with a safe key.
    const z = await upload(t, ali, { purpose: 'media', kind: 'file', type: 'application/x-weird', data: Buffer.from('x'), name: 'pack.ZIP' });
    expect(z).toMatch(/\.zip$/);
  });

  it('checks every upload and every attachment', async () => {
    const err = async (body: object) => (await t.http.post('/v1/media/upload-url').set(ali.auth).send(body).expect(400)).body.error.message as string;
    expect(await err({ purpose: 'media', kind: 'image', contentType: 'application/pdf', size: 10 })).toBe('That image format isn’t supported. Send it as a file instead.');
    expect(await err({ purpose: 'media', kind: 'image', contentType: 'image/png', size: 17 * 1024 * 1024 })).toBe('That file is 17 MB. The limit is 16 MB.');
    expect(await err({ purpose: 'media', kind: 'file', contentType: 'application/zip', size: 101 * 1024 * 1024 })).toBe('That file is 101 MB. The limit is 100 MB.');
    expect(await err({ purpose: 'media', contentType: 'image/png', size: 10 })).toBe('Say what kind of file this is.');
    expect(await err({ purpose: 'thumb', contentType: 'image/gif', size: 10 })).toBe('Previews must be JPG, PNG or WebP.');
    expect(await err({ purpose: 'media', kind: 'voice', contentType: 'video/mp4', size: 10 })).toBe('That recording format isn’t supported.');
    expect(await err({ purpose: 'media', kind: 'file', contentType: 'application/zip', size: 0 })).toBe('The file is empty.');

    const sarasFile = await upload(t, sara, { purpose: 'media', kind: 'image', type: 'image/png', data: png });
    expect((await send(ali, c.id, { attachment: { kind: 'image', key: sarasFile } })).status).toBe(403);
    expect((await send(ali, c.id, { attachment: { kind: 'image', key: `media/${ali.id}/abc-AAAAAAAAAAAA.png` } })).body.error.message).toBe('The upload did not finish. Try again.');
    const pdfKey = await upload(t, ali, { purpose: 'media', kind: 'file', type: 'application/pdf', data: Buffer.from('%PDF') });
    expect((await send(ali, c.id, { attachment: { kind: 'image', key: pdfKey } })).body.error.message).toBe('That file type doesn’t match what was sent.');
    expect((await send(ali, c.id, { attachment: { kind: 'image', key: '../../etc/passwd' } })).status).toBe(403);
    expect((await send(ali, c.id, { text: '' })).status).toBe(400); // text needs words; only media can go without
    expect((await send(ali, c.id, { text: 'x'.repeat(4097), attachment: { kind: 'file', key: pdfKey } })).status).toBe(400);
    // A tampered download link is refused.
    expect((await t.http.get('/v1/media/local/eyJvcCI6ImdldCJ9.bad')).status).toBe(403);
  });

  it('forwarding a photo shares the same file with the new chat', async () => {
    const key = await upload(t, ali, { purpose: 'media', kind: 'image', type: 'image/png', data: png });
    const m = (await send(ali, c.id, { attachment: { kind: 'image', key } }).expect(200)).body.message as ChatMessage;
    const d = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: omar.id }).expect(200)).body;
    const r = (await t.http.post(`/v1/conversations/${c.id}/messages/${m.id}/forward`).set(sara.auth).send({ targets: [{ conversationId: d.id, clientId: cid() }] }).expect(200)).body;
    expect(r[0]).toMatchObject({ ok: true, message: { type: 'media', forwarded: true, senderId: sara.id, attachment: { kind: 'image' } } });
    const got = (await history(omar, d.id))[0];
    expect(Buffer.from((await t.http.get(path(got.attachment!.url)).expect(200)).body).equals(png)).toBe(true);
  });
});
