import { expect, test, type Page } from './test';
import { apiCall, apiUser, pageAs, png } from './helpers';

const bubbles = (p: Page) => p.getByTestId('message');
const attach = (p: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) => p.getByLabel('Attach files').setInputFiles(files);

/** A short real WebM video, recorded from a canvas inside the browser. */
async function webm(p: Page): Promise<Buffer> {
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const ctx = c.getContext('2d')!;
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.start();
    for (let i = 0; i < 20; i++) { ctx.fillStyle = `hsl(${i * 18},80%,50%)`; ctx.fillRect(0, 0, 320, 180); await new Promise((r) => setTimeout(r, 60)); }
    await new Promise<void>((r) => { rec.onstop = () => r(); rec.stop(); });
    const buf = await new Blob(parts, { type: 'video/webm' }).arrayBuffer();
    let s = ''; new Uint8Array(buf).forEach((x) => { s += String.fromCharCode(x); });
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

test.describe('Photos, videos, voice notes and files on the web', () => {
  test('a photo with a caption: sheet, upload, the other side, and the viewer', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto(`/chats?c=${c.id}`);
    await a.page.goto(`/chats?c=${c.id}`);
    await attach(a.page, [{ name: 'poster.png', mimeType: 'image/png', buffer: png(800, 600) }, { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(17 * 1024 * 1024, 1) }]);
    const sheet = a.page.getByRole('dialog', { name: 'Send 2 files to Sara' });
    await expect(sheet.getByTestId('attach-item').filter({ hasText: 'huge.png' })).toContainText('over the 16 MB limit');
    await expect(sheet.getByText(/1 file · .* · 1 can’t be sent/)).toBeVisible();
    // As a file, the big one fits (100 MB limit).
    await sheet.getByLabel('Send photos as files (full quality)').check();
    await expect(sheet.getByTestId('attach-item').filter({ hasText: 'huge.png' })).not.toContainText('over');
    await sheet.getByLabel('Send photos as files (full quality)').uncheck();
    await sheet.getByRole('button', { name: 'Remove huge.png' }).click();
    const one = a.page.getByRole('dialog', { name: 'Send 1 file to Sara' });
    await one.getByLabel('Caption').fill('Poster for Friday 🎉');
    await one.getByRole('button', { name: 'Send' }).click();
    await expect(one).toHaveCount(0);

    const mine = bubbles(a.page).last();
    await expect(mine.getByRole('button', { name: 'Photo: Poster for Friday 🎉' })).toBeVisible();
    await expect(mine).toHaveAttribute('data-tick', /sent|delivered|read/, { timeout: 15000 });
    const hers = bubbles(s.page).last();
    await expect(hers.getByRole('button', { name: 'Photo: Poster for Friday 🎉' })).toBeVisible();
    // The preview picture really loads.
    await expect.poll(() => hers.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    await expect(s.page.getByTestId('chat-row').filter({ hasText: 'Ali' })).toContainText('📷 Poster for Friday 🎉');

    await hers.getByRole('button', { name: /^Photo/ }).click();
    const viewer = s.page.getByRole('dialog', { name: 'Media viewer' });
    await expect(viewer).toContainText('Ali');
    await expect(viewer).toContainText('1 of 1');
    await expect(viewer.getByRole('img', { name: 'Poster for Friday 🎉' })).toBeVisible();
    await expect.poll(() => viewer.getByRole('img', { name: 'Poster for Friday 🎉' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(800);
    await s.page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await a.ctx.close(); await s.ctx.close();
  });

  test('a video, and a PDF that downloads under its name', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await a.page.goto(`/chats?c=${c.id}`); await s.page.goto(`/chats?c=${c.id}`);
    const video = await webm(a.page);
    await attach(a.page, [{ name: 'clip.webm', mimeType: 'video/webm', buffer: video }, { name: 'Brand guide.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test file\n') }]);
    await a.page.getByRole('dialog', { name: 'Send 2 files to Sara' }).getByRole('button', { name: 'Send' }).click();
    const vid = bubbles(s.page).filter({ has: s.page.getByRole('button', { name: /^Video/ }) });
    await expect(vid).toHaveCount(1, { timeout: 15000 });
    await expect(vid.locator('img')).toBeVisible(); // a frame from the video as its preview
    const file = bubbles(s.page).filter({ hasText: 'Brand guide.pdf' });
    await expect(file).toContainText('PDF');
    const [dl] = await Promise.all([s.page.waitForEvent('download'), file.getByRole('link', { name: 'Download Brand guide.pdf' }).click()]);
    expect(dl.suggestedFilename()).toBe('Brand guide.pdf');
    await vid.getByRole('button', { name: /^Video/ }).click();
    const player = s.page.getByRole('dialog', { name: 'Media viewer' }).locator('video');
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    await s.page.keyboard.press('Escape');
    await a.ctx.close(); await s.ctx.close();
  });

  test('a voice note: record, send, and play on the other side', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await a.page.goto(`/chats?c=${c.id}`); await s.page.goto(`/chats?c=${c.id}`);
    await a.page.getByRole('button', { name: 'Record' }).click();
    await expect(a.page.getByRole('group', { name: 'Recording voice message' })).toBeVisible();
    await expect(a.page.getByTestId('rec-time')).toHaveText('0:02', { timeout: 6000 });
    await a.page.getByRole('group', { name: 'Recording voice message' }).getByRole('button', { name: 'Send' }).click();
    const voice = s.page.getByTestId('voice');
    await expect(voice).toBeVisible({ timeout: 15000 });
    await expect(voice).toContainText(/0:0[2-3]/);
    await expect(s.page.getByTestId('chat-row').filter({ hasText: 'Ali' })).toContainText('🎤 Voice message');
    await voice.getByRole('button', { name: 'Play voice message' }).click();
    await expect(voice.getByRole('button', { name: 'Pause' })).toBeVisible();
    await voice.getByRole('button', { name: 'Speed 1×' }).click();
    await expect(voice.getByRole('button', { name: 'Speed 1.5×' })).toBeVisible();
    // Cancelling a recording sends nothing.
    await a.page.getByRole('button', { name: 'Record' }).click();
    await a.page.getByRole('group', { name: 'Recording voice message' }).getByRole('button', { name: 'Cancel' }).click();
    await a.page.waitForTimeout(800);
    await expect(s.page.getByTestId('voice')).toHaveCount(1);
    await a.ctx.close(); await s.ctx.close();
  });

  test('uploads show progress, can be cancelled, and can be retried after a failure', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto(`/chats?c=${c.id}`);
    // Hold every upload until released.
    let release: () => void = () => undefined;
    let held = new Promise<void>((r) => { release = r; });
    let fail = false;
    await a.page.route(/\/v1\/media\/local\//, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await held;
      if (fail) return route.abort();
      return route.continue();
    });
    await attach(a.page, [{ name: 'keep.png', mimeType: 'image/png', buffer: png(200, 200) }]);
    await a.page.getByRole('dialog', { name: /Send 1 file/ }).getByRole('button', { name: 'Send' }).click();
    await expect(a.page.getByRole('status', { name: /Uploading \d+%/ })).toBeVisible();
    await a.page.getByRole('button', { name: 'Cancel upload' }).click();
    await expect(bubbles(a.page)).toHaveCount(0);

    fail = true;
    await attach(a.page, [{ name: 'retry.png', mimeType: 'image/png', buffer: png(200, 200) }]);
    await a.page.getByRole('dialog', { name: /Send 1 file/ }).getByRole('button', { name: 'Send' }).click();
    release();
    await expect(a.page.getByRole('status', { name: 'Upload failed' })).toBeVisible();
    fail = false;
    await a.page.getByRole('button', { name: 'Retry upload' }).click();
    await expect(bubbles(a.page).last()).toHaveAttribute('data-tick', /sent|delivered/, { timeout: 15000 });
    const got = await apiCall(`/v1/conversations/${c.id}/messages`, undefined, sara.tokens.accessToken);
    expect(got.items.map((m: { attachment?: { name: string } }) => m.attachment?.name)).toEqual(['retry.png']);
    held = Promise.resolve();
    await a.ctx.close();
  });

  test('drop files on the chat to send them', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto(`/chats?c=${c.id}`);
    const data = png(64, 64).toString('base64');
    const dt = await a.page.evaluateHandle((b64) => {
      const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const d = new DataTransfer(); d.items.add(new File([bytes], 'dropped.png', { type: 'image/png' })); return d;
    }, data);
    const zone = a.page.getByRole('region', { name: 'Chat with Sara' });
    await zone.dispatchEvent('dragover', { dataTransfer: dt });
    await expect(a.page.getByText('Drop files to send them to Sara')).toBeVisible();
    await zone.dispatchEvent('drop', { dataTransfer: dt });
    await expect(a.page.getByRole('dialog', { name: 'Send 1 file to Sara' })).toContainText('dropped.png');
    await a.ctx.close();
  });
});

test('a batch arrives in the order it was picked, even when a later file finishes first', async ({ browser }) => {
  const ali = await apiUser('Ali'), sara = await apiUser('Sara');
  const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
  const a = await pageAs(browser, ali);
  await a.page.goto(`/chats?c=${c.id}`);
  // Slow down only the first file's upload.
  let first = true;
  await a.page.route(/\/v1\/media\/local\//, async (route) => {
    if (route.request().method() === 'PUT' && first) { first = false; await new Promise((r) => setTimeout(r, 1500)); } // big.png starts uploading first
    return route.continue();
  });
  await attach(a.page, [{ name: 'big.png', mimeType: 'image/png', buffer: Buffer.concat([png(10, 10), Buffer.alloc(300_000)]) }, { name: 'small.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }]);
  await a.page.getByRole('dialog', { name: /Send 2 files/ }).getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => (await apiCall(`/v1/conversations/${c.id}/messages`, undefined, sara.tokens.accessToken)).items.length, { timeout: 15000 }).toBe(2);
  const got = await apiCall(`/v1/conversations/${c.id}/messages`, undefined, sara.tokens.accessToken);
  expect(got.items.map((m: { attachment: { name: string } }) => m.attachment.name)).toEqual(['big.png', 'small.txt']);
  await a.ctx.close();
});
