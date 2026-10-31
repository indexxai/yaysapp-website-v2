import { expect, test } from './test';
import { NO_POPUPS, apiCall, apiUser, pageAs } from './helpers';

test.describe('Linking a browser, and loading, offline and error states', () => {
  test('a new browser signs in by showing a code that a signed-in browser types in', async ({ browser }) => {
    const ali = await apiUser('Ali');
    const a = await pageAs(browser, ali);
    const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
    await fresh.addInitScript(NO_POPUPS);
    const b = await fresh.newPage();
    await b.goto('/sign-in'); // the QR code is what a signed-out browser sees first
    await expect(b.getByRole('heading', { name: 'Scan to sign in' })).toBeVisible();
    await expect(b.getByRole('img', { name: 'QR code to link this browser' }).locator('svg')).toBeVisible();
    await expect(b.getByText(/Code refreshes in [01]:\d\d/)).toBeVisible();
    const code = (await b.getByTestId('link-code').textContent())!;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    await a.page.goto('/settings/devices');
    await a.page.getByRole('button', { name: 'Link a device' }).click();
    const dlg = a.page.getByRole('dialog', { name: 'Link a device' });
    await dlg.getByLabel('Code from the other device').fill('ABCD-EFGH');
    await dlg.getByRole('button', { name: 'Link device' }).click();
    await expect(dlg.getByRole('alert')).toContainText('This code expired or was already used.');
    await dlg.getByLabel('Code from the other device').fill(code.toLowerCase());
    await dlg.getByRole('button', { name: 'Link device' }).click();
    await expect(a.page.getByText(/is now signed in to your account\./)).toBeVisible();
    await expect(a.page.getByTestId('device-row')).toHaveCount(2);
    // The new browser goes straight to the chats, signed in as Ali.
    await expect(b).toHaveURL(/\/chats/, { timeout: 10_000 });
    await expect(b.getByTestId('chats-ready')).toContainText('Welcome, Ali');
    await a.ctx.close(); await fresh.close();
  });

  test('chats show placeholders while loading; a chat that fails to load can be tried again', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await apiCall(`/v1/conversations/${c.id}/messages`, { clientId: crypto.randomUUID(), text: 'hello there' }, sara.tokens.accessToken);
    const a = await pageAs(browser, ali);
    let slow = true;
    await a.page.route(/\/v1\/conversations(\?.*)?$/, async (r) => { if (slow) await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
    await a.page.goto('/chats');
    await expect(a.page.getByRole('status', { name: 'Loading chats' })).toBeVisible();
    await expect(a.page.getByTestId('chat-row')).toHaveCount(1);
    slow = false;
    // Empty pane: shortcuts work.
    await expect(a.page.getByRole('heading', { name: 'Pick a chat to start' })).toBeVisible();
    await a.page.keyboard.press('Alt+ArrowDown');
    await expect(a.page.getByRole('region', { name: 'Chat with Sara' })).toBeVisible();
    await a.page.goto('/chats');
    await expect(a.page.getByRole('heading', { name: 'Pick a chat to start' })).toBeVisible();
    await a.page.keyboard.press('Alt+KeyN');
    await expect(a.page.getByRole('region', { name: 'New chat' })).toBeVisible();

    // A chat this browser hasn't seen, while the server is failing.
    const g = await apiCall('/v1/groups', { name: 'Family', memberIds: [ali.id] }, sara.tokens.accessToken);
    const b = await pageAs(browser, ali);
    let fail = true;
    await b.page.route(new RegExp(`/v1/conversations/${g.id}(/messages)?(\\?.*)?$`), (r) => (fail ? r.fulfill({ status: 503, body: '{"error":{"code":"internal_error","message":"down"}}', contentType: 'application/json' }) : r.continue()));
    await b.page.goto(`/chats?c=${g.id}`);
    const card = b.page.getByRole('alert').filter({ hasText: 'Couldn’t open this chat' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    fail = false;
    await card.getByRole('button', { name: 'Try again' }).click();
    await expect(b.page.getByRole('region', { name: 'Chat with Family' })).toBeVisible();
    await a.ctx.close(); await b.ctx.close();
  });
});
