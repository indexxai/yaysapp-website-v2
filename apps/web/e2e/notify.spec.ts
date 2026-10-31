import { expect, test, type BrowserContext, type Page } from './test';
import { API, apiCall, apiUser, pageAs, type ApiUser } from './helpers';

const say = (u: ApiUser, c: string, text: string) => apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text }, u.tokens.accessToken);

/** A browser that already allowed notifications, with a stand-in push subscription (the real one needs Google's push service). */
async function allowAndFakeSubscription(ctx: BrowserContext, endpoint: string) {
  await ctx.grantPermissions(['notifications']);
  await ctx.addInitScript((ep) => {
    const sub = { endpoint: ep, toJSON: () => ({ endpoint: ep, keys: { p256dh: 'BOr2Ae_W_example_p256dh_key_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', auth: 'aaaaaaaaaaaaaaaaaaaaaa' } }), unsubscribe: async () => true };
    let subscribed = false;
    PushManager.prototype.getSubscription = async function () { return subscribed ? (sub as unknown as PushSubscription) : null; };
    PushManager.prototype.subscribe = async function () { subscribed = true; return sub as unknown as PushSubscription; };
  }, endpoint);
}

test.describe('Notifications on the web', () => {
  test('the "Turn on notifications" banner: not now, and blocked', async ({ browser }) => {
    const ali = await apiUser('Ali');
    const a = await pageAs(browser, ali, undefined, { askForPermissions: true });
    await a.page.goto('/chats');
    const banner = a.page.getByRole('region', { name: 'Notifications' });
    await expect(banner).toContainText('Turn on notifications');
    await banner.getByRole('button', { name: 'Not now' }).click();
    await expect(banner).toHaveCount(0);
    await a.page.reload();
    await a.page.getByRole('heading', { name: 'Chats' }).waitFor();
    await expect(a.page.getByRole('region', { name: 'Notifications' })).toHaveCount(0);
    await a.ctx.close();
    // A browser that refuses: the banner explains how to allow it.
    const b = await pageAs(browser, ali, undefined, { askForPermissions: true });
    await b.page.goto('/chats');
    await b.page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Allow' }).click();
    await expect(b.page.getByRole('region', { name: 'Notifications' })).toContainText('Allow notifications for this site in your browser settings');
    await b.ctx.close();
  });

  test('a browser that allowed notifications gets a push when its tab is closed', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: ali.id }, sara.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await allowAndFakeSubscription(a.ctx, `https://push.example/web-${ali.id}`);
    await a.page.goto('/chats');
    await expect(a.page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await expect(a.page.getByRole('region', { name: 'Notifications' })).toHaveCount(0); // already on
    // The browser registered its subscription with the server.
    await expect.poll(() => a.page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r))).toBe(true);
    await a.page.waitForTimeout(500);
    await a.page.close();
    await new Promise((r) => setTimeout(r, 500));
    await say(sara, c.id, 'Dinner at 8?');
    await expect.poll(async () => (await (await fetch(`${API}/v1/_test/pushes?userId=${ali.id}`)).json()).map((p: { endpoint: string; payload: { title: string; body: string } }) => [p.endpoint, p.payload.title, p.payload.body]))
      .toContainEqual([`https://push.example/web-${ali.id}`, 'Sara', 'Dinner at 8?']);
    await a.ctx.close();
  });

  test('the service worker shows the notification, and clears it when the chat is read elsewhere', async ({ browser }) => {
    const ali = await apiUser('Ali');
    const a = await pageAs(browser, ali);
    await a.ctx.grantPermissions(['notifications']);
    await a.page.goto('/chats');
    await a.page.evaluate(() => navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready));
    const cdp = await a.ctx.newCDPSession(a.page);
    const regs: Array<{ registrationId: string; scopeURL: string }> = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: Array<{ registrationId: string; scopeURL: string }> }) => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => regs.length).toBeGreaterThan(0);
    const origin = new URL(a.page.url()).origin;
    // With no YaysApp tab in front, the worker shows the notification.
    await a.page.goto('about:blank');
    const push = (data: object) => cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: regs[0].registrationId, data: JSON.stringify(data) });
    await push({ type: 'message', conversationId: 'c1', messageId: 'm1', title: 'Sara', body: 'Dinner at 8?', tag: 'c:c1', url: '/chats?c=c1' });
    const other = await a.ctx.newPage();
    await other.goto('/sign-in');
    const shown = () => other.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => [n.title, n.body, n.tag]));
    await expect.poll(shown).toEqual([['Sara', 'Dinner at 8?', 'c:c1']]);
    await push({ type: 'read', conversationId: 'c1', tag: 'c:c1' });
    await expect.poll(shown).toEqual([]);
    await a.ctx.close();
  });

  test('while the app is open: a banner for other chats, the unread count in the tab title, and clicking opens the chat', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar');
    const withOmar = await apiCall('/v1/conversations/direct', { userId: omar.id }, ali.tokens.accessToken);
    await say(omar, withOmar.id, 'hi');
    const withSara = await apiCall('/v1/conversations/direct', { userId: ali.id }, sara.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto(`/chats?c=${withOmar.id}`);
    await expect(a.page.locator('.msg--them')).toHaveCount(1);
    await expect(a.page.locator('.conn-notice')).toHaveCount(0); // live connection is up
    await expect(a.page).toHaveTitle('YaysApp');
    await say(sara, withSara.id, 'Are you free?');
    const toast = a.page.getByTestId('toast');
    await expect(toast).toContainText('Sara');
    await expect(toast).toContainText('Are you free?');
    await expect(a.page).toHaveTitle('(1) YaysApp');
    // A message in the chat I'm reading makes no banner.
    await say(omar, withOmar.id, 'in this chat');
    await expect(a.page.locator('.msg--them .msg__text').last()).toHaveText('in this chat');
    await expect(a.page.getByTestId('toast')).toHaveCount(1);
    await toast.click();
    await expect(a.page.getByRole('region', { name: 'Chat with Sara' })).toBeVisible();
    await expect(a.page).toHaveTitle('YaysApp');
    await a.ctx.close();
  });
});

export type { Page };
