// Screenshots of every web screen with realistic data, to compare with the designs.
// Run with GALLERY=1; skipped otherwise. Images go to GALLERY_OUT (default test-results/gallery).
import { readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { expect, test, type Page } from './test';
import { API, apiCall, apiUser, pageAs, type ApiUser } from './helpers';

const OUT = process.env.GALLERY_OUT ?? path.join(__dirname, '../test-results/gallery');
const VP = { width: 1440, height: 900 };
const say = (u: ApiUser, c: string, text: string, extra: object = {}) => apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text, ...extra }, u.tokens.accessToken);
async function photo(u: ApiUser, c: string, caption: string) {
  const buf = readFileSync(path.join(__dirname, 'fixtures/poster.png'));
  const t = await apiCall('/v1/media/upload-url', { purpose: 'media', kind: 'image', contentType: 'image/png', size: buf.length, name: 'poster.png' }, u.tokens.accessToken);
  const r = await fetch(t.uploadUrl.startsWith('http') ? t.uploadUrl : `${API}${t.uploadUrl}`, { method: 'PUT', headers: t.headers, body: buf });
  if (!r.ok) throw new Error(`upload ${r.status}`);
  return say(u, c, caption, { attachment: { kind: 'image', key: t.key, name: 'poster.png', width: 448, height: 569 } });
}
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

test.describe('gallery', () => {
  test.skip(!process.env.GALLERY, 'set GALLERY=1');
  test.setTimeout(300_000);
  test('all screens', async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const sara = await apiUser('Sara Ahmed'), amara = await apiUser('Amara Okafor'), omar = await apiUser('Omar Siddiqui'), lena = await apiUser('Lena Fischer'), ali = await apiUser('Ali Ahmed');
    const d = async (a: ApiUser, b: ApiUser) => (await apiCall('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken)).id as string;
    const cOmar = await d(sara, omar); await say(omar, cOmar, 'See you tomorrow'); await say(sara, cOmar, 'See you!');
    const cLena = await d(sara, lena); await say(lena, cLena, 'Did you get the brand guide?');
    const fam = (await apiCall('/v1/groups', { name: 'Family', memberIds: [amara.id, omar.id, ali.id] }, sara.tokens.accessToken)).id as string;
    await say(amara, fam, 'Who is bringing dessert on Sunday?');
    await apiCall(`/v1/conversations/${fam}/polls`, { clientId: crypto.randomUUID(), question: 'Sunday lunch time?', options: ['1:00 pm', '2:30 pm', 'Dinner instead'], multi: false, anonymous: false }, ali.tokens.accessToken);
    await say(sara, fam, "I'll bring the kheer 🍮");
    await photo(amara, fam, '');
    const cAmara = await d(sara, amara);
    const q = await say(amara, cAmara, 'Are you joining the BTCY call tonight?');
    await say(sara, cAmara, "Yes! I'll bring the slides.", { replyToId: q.message.id });
    await photo(amara, cAmara, 'Poster for Friday 🎉');
    await say(sara, cAmara, 'Can you send the venue address?');
    await say(amara, cAmara, 'Café Aylanto, MM Alam Road');

    const s = await pageAs(browser, sara, VP);
    const p = s.page;
    // Sign-in (signed out)
    const anon = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport: VP });
    const ap = await anon.newPage();
    await ap.goto('/sign-in'); await ap.waitForTimeout(1200); await shot(ap, 'w01-sign-in');
    const codeLink = ap.getByRole('button', { name: /Sign in with a code|Phone/ }).first();
    if (await codeLink.isVisible()) { await codeLink.click().catch(() => undefined); await ap.waitForTimeout(400); await shot(ap, 'w01b-sign-in-code'); }
    await anon.close();

    await p.goto('/chats'); await expect(p.getByTestId('chat-row').first()).toBeVisible(); await p.waitForTimeout(600);
    await shot(p, 'w04-empty');
    await p.goto(`/chats?c=${cAmara}`); await p.waitForTimeout(1500); await shot(p, 'w02-chats');
    const bubble = p.getByTestId('message').filter({ hasText: 'Poster for Friday' }).last();
    await bubble.hover(); await p.waitForTimeout(300); await shot(p, 'w13a-hover-actions');
    await bubble.getByRole('button', { name: 'More actions' }).click().catch(() => undefined); await p.waitForTimeout(300); await shot(p, 'w13-message-actions');
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Info', exact: true }).click(); await p.waitForTimeout(800); await shot(p, 'w15-contact-info');
    await p.goto(`/chats?c=${fam}`); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'Group info' }).click(); await p.waitForTimeout(1000); await shot(p, 'w03-group');
    await p.goto(`/chats?c=${cAmara}`); await p.waitForTimeout(800);
    await p.getByRole('button', { name: 'Attach' }).click(); await p.waitForTimeout(300); await shot(p, 'w16-attach-menu');
    await p.keyboard.press('Escape');
    await p.getByLabel('Attach files').setInputFiles([{ name: 'poster.png', mimeType: 'image/png', buffer: readFileSync(path.join(__dirname, 'fixtures/poster.png')) }, { name: 'brand-guide.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 brand guide') }]);
    await p.getByLabel('Caption').fill('Final logo files + poster 👇'); await p.waitForTimeout(500); await shot(p, 'w16-attach');
    await p.getByRole('button', { name: 'Cancel' }).click();
    await p.locator('.msg img').first().click().catch(() => undefined); await p.waitForTimeout(800); await shot(p, 'w11-media-viewer'); await p.keyboard.press('Escape');
    await p.goto('/chats'); await p.getByRole('button', { name: 'New group' }).first().click(); await p.getByLabel('Group name').fill('Weekend Hikers'); await p.getByRole('checkbox', { name: 'Amara Okafor' }).check(); await p.getByRole('checkbox', { name: 'Omar Siddiqui' }).check(); await p.waitForTimeout(400); await shot(p, 'w05-new-group'); await p.keyboard.press('Escape');
    await p.goto('/chats'); await expect(p.getByTestId('chat-row').first()).toBeVisible(); await p.keyboard.press('Control+k'); await p.keyboard.type('poster'); await p.waitForTimeout(1200); await shot(p, 'w18-search');
    await p.goto('/communities'); await p.waitForTimeout(1000); await shot(p, 'w07-communities-empty');
    await p.getByRole('button', { name: 'New', exact: true }).click().catch(() => undefined); await p.waitForTimeout(500); await shot(p, 'w22-create-community');
    await p.keyboard.press('Escape');
    const com = await apiCall('/v1/communities', { name: 'Lahore Runners', about: 'Weekend runs around Lahore.', newGroups: ['General', 'Race day'], groupIds: [fam] }, sara.tokens.accessToken);
    await p.goto(`/communities?id=${com.id}`); await p.waitForTimeout(1200); await shot(p, 'w07-communities');
    await p.getByRole('button', { name: 'Manage' }).click().catch(() => undefined); await p.waitForTimeout(800); await shot(p, 'w23-community-admin');
    for (const [url, name] of [['/settings/privacy', 'w08-settings-privacy'], ['/settings/profile', 'w25-settings-profile'], ['/settings/notifications', 'w26-settings-notifications'], ['/settings/storage', 'w27-settings-storage'], ['/settings/help', 'w28-settings-help'], ['/settings/devices', 'w29-linked-devices'], ['/settings/appearance', 'w12-appearance'], ['/settings', 'w08-settings']] as const) {
      await p.goto(url); await p.waitForTimeout(1000); await shot(p, name);
    }
    // A few calls for the history: Amara rings and hangs up (missed, twice), Sara calls Omar and they talk, Lena declines Sara's video call.
    const ring = async (from: ApiUser, conv: string, media: string) => (await apiCall('/v1/calls', { conversationId: conv, media }, from.tokens.accessToken)).call.id as string;
    for (let n = 0; n < 2; n++) { const id = await ring(amara, cAmara, 'voice'); await apiCall(`/v1/calls/${id}/leave`, {}, amara.tokens.accessToken); }
    { const id = await ring(sara, cOmar, 'voice'); await apiCall(`/v1/calls/${id}/accept`, {}, omar.tokens.accessToken); await new Promise((r) => setTimeout(r, 1500)); await apiCall(`/v1/calls/${id}/leave`, {}, omar.tokens.accessToken); }
    { const id = await ring(sara, cLena, 'video'); await apiCall(`/v1/calls/${id}/decline`, {}, lena.tokens.accessToken); }
    await p.goto('/calls'); await p.waitForTimeout(1000); await shot(p, 'w09-calls-list');
    await p.getByTestId('call-row').last().locator('.call-row__open').click(); await p.waitForTimeout(1200); await shot(p, 'w09-calls');
    await p.getByRole('button', { name: 'Call link' }).click(); await p.waitForTimeout(1000); await shot(p, 'w21-call-link'); await p.keyboard.press('Escape');
    await p.emulateMedia({ colorScheme: 'dark' });
    await p.goto(`/chats?c=${cAmara}`); await p.waitForTimeout(1200); await shot(p, 'wd-chats-dark');
    await s.ctx.close();
  });
});
