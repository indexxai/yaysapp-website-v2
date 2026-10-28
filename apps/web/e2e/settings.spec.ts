import { expect, test } from '@playwright/test';
import { API, apiCall, apiUser, codeFor, db, pageAs, signInWithEmail, typeCode, type ApiUser } from './helpers';

const say = (u: ApiUser, c: string, text: string) => apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text }, u.tokens.accessToken);
const me = async (u: ApiUser) => (await fetch(`${API}/v1/me`, { headers: { authorization: `Bearer ${u.tokens.accessToken}` } })).json();

test.describe('Settings on the web', () => {
  test('two-step verification: turn it on, then the PIN is asked at sign-in; forgot PIN resets it', async ({ browser }) => {
    const ali = await apiUser('Ali');
    const a = await pageAs(browser, ali);
    await a.page.goto('/settings/profile');
    await a.page.getByRole('button', { name: 'Turn on' }).click();
    const dlg = a.page.getByRole('dialog', { name: 'Two-step verification' });
    await dlg.getByLabel('PIN', { exact: true }).fill('123456');
    await dlg.getByLabel('Type it again').fill('123456');
    await dlg.getByRole('button', { name: 'Turn on' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Pick a PIN that is harder to guess.');
    await dlg.getByLabel('PIN', { exact: true }).fill('482916');
    await dlg.getByLabel('Type it again').fill('482917');
    await dlg.getByRole('button', { name: 'Turn on' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('The PINs don’t match. Try again.');
    await dlg.getByLabel('Type it again').fill('482916');
    await dlg.getByRole('button', { name: 'Turn on' }).click();
    await expect(a.page.getByRole('status')).toHaveText('Two-step verification is on.');
    await a.ctx.close();

    // A new browser: code, then PIN.
    const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
    const page = await ctx.newPage();
    await signInWithEmail(page, ali.email);
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
    await page.getByLabel('6-digit PIN').fill('111222');
    await expect(page.getByText('Wrong PIN. 4 tries left.')).toBeVisible();
    await page.getByLabel('6-digit PIN').fill('482916');
    await expect(page).toHaveURL(/\/chats$/);
    await ctx.close();

    // Forgot it: signing in by email sends the reset code to the phone.
    const ctx2 = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
    const p2 = await ctx2.newPage();
    await p2.waitForTimeout(5200); // a new email code needs the resend wait
    await signInWithEmail(p2, ali.email);
    await p2.getByRole('button', { name: 'Forgot PIN?' }).click();
    await expect(p2.getByRole('heading', { name: 'Reset your PIN' })).toBeVisible();
    await typeCode(p2, await codeFor(ali.phone));
    await expect(p2).toHaveURL(/\/chats$/);
    expect((await me(ali)).twoStep).toBe(false);
    await ctx2.close();
  });

  test('privacy and notifications save, and blocked people can be unblocked', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    await apiCall('/v1/blocks', { userId: sara.id }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto('/settings/privacy');
    await a.page.getByRole('radio', { name: 'People I chat with' }).check();
    await expect(a.page.getByRole('status')).toContainText('Saved');
    await a.page.getByLabel('Profile photo').selectOption('nobody');
    await a.page.getByRole('switch', { name: /Read receipts/ }).click();
    await expect.poll(async () => (await me(ali)).privacy).toEqual({ lastSeen: 'contacts', photo: 'nobody', about: 'everyone', groups: 'everyone', readReceipts: false });
    await expect(a.page.getByTestId('blocked-row')).toHaveText(/Sara/);
    await a.page.getByRole('button', { name: 'Unblock Sara' }).click();
    await expect(a.page.getByTestId('blocked-row')).toHaveCount(0);

    await a.page.getByRole('link', { name: /Notifications/ }).click();
    await expect(a.page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await a.page.getByRole('switch', { name: /Show message preview/ }).click();
    await a.page.getByRole('switch', { name: /Mute everything at night/ }).click();
    await a.page.getByLabel('Quiet hours start').fill('22:30');
    await expect.poll(async () => (await me(ali)).notifications).toMatchObject({ preview: false, quietHours: { on: true, from: '22:30', to: '07:00' } });
    // Reload: what was saved is shown.
    await a.page.reload();
    await expect(a.page.getByRole('switch', { name: /Show message preview/ })).toHaveAttribute('aria-checked', 'false');
    await a.ctx.close();
  });

  test('appearance: dark theme and text size stay after a reload; Enter can make new lines instead', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto('/settings/appearance');
    await a.page.getByRole('radio', { name: 'Dark' }).check({ force: true });
    await expect(a.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await a.page.getByLabel('Text size').fill('5');
    await a.page.getByRole('switch', { name: /Press Enter to send/ }).click();
    await a.page.reload();
    await expect(a.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(a.page.locator('html')).toHaveAttribute('style', /--chat-scale: 1.22/);
    await a.page.goto(`/chats?c=${c.id}`);
    const box = a.page.getByLabel('Message', { exact: true });
    await box.fill('line one');
    await box.press('Enter');
    await box.pressSequentially('line two');
    await expect(box).toHaveValue('line one\nline two');
    await box.press('Control+Enter');
    await expect(a.page.locator('.msg--me .msg__text')).toHaveText('line one\nline two');
    await a.ctx.close();
  });

  test('starred messages, storage, help: contact us and report a problem', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    const m = (await say(sara, c.id, 'Wi-Fi password: sunflower')).message;
    for (let i = 0; i < 60; i++) await say(sara, c.id, `later ${i}`);
    await apiCall(`/v1/conversations/${c.id}/messages/${m.id}/star`, {}, ali.tokens.accessToken, 'PUT');
    const a = await pageAs(browser, ali);
    await a.page.goto('/settings/starred');
    await expect(a.page.getByTestId('starred-item')).toHaveCount(1);
    await expect(a.page.getByTestId('starred-item')).toContainText('Wi-Fi password: sunflower');
    await a.page.getByTestId('starred-item').click();
    await expect(a.page.getByTestId('message').filter({ hasText: 'Wi-Fi password' })).toBeInViewport();

    await a.page.goto('/settings/storage');
    await expect(a.page.getByTestId('storage-total')).toHaveText('0 B');
    await a.page.getByRole('button', { name: 'Clear' }).click();
    await expect(a.page.getByRole('status')).toContainText('Cleared');
    await expect(a.page.getByTestId('cache-size')).toHaveText('0 B');

    await a.page.goto('/settings/help');
    await a.page.getByLabel('Search help').fill('PIN');
    await expect(a.page.locator('.faq summary')).toHaveText(['I forgot my two-step PIN']);
    await a.page.getByRole('button', { name: 'Report a problem' }).click();
    const dlg = a.page.getByRole('dialog', { name: 'Report a problem' });
    await dlg.getByLabel('What happened?').fill('The chat list did not refresh after sleep');
    await dlg.getByRole('button', { name: 'Send report' }).click();
    await expect(a.page.getByRole('status')).toContainText('We got your report');
    expect(await db((d) => d.collection('yc_problem_reports').countDocuments({ text: 'The chat list did not refresh after sleep' }))).toBe(1);
    await a.page.getByRole('button', { name: 'Start chat' }).click();
    await expect(a.page.getByRole('region', { name: 'Chat with YaysApp Support' })).toBeVisible();
    await expect(a.page.locator('.msg--them .msg__text')).toContainText('This is YaysApp Support');
    await a.ctx.close();
  });

  test('delete a chat from its menu; delete the account', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(sara, c.id, 'hello');
    const a = await pageAs(browser, ali);
    await a.page.goto('/chats');
    const row = a.page.locator('.chat-row').filter({ hasText: 'Sara' });
    await row.hover();
    await row.getByRole('button', { name: 'Options for Sara' }).click();
    await a.page.getByRole('menuitem', { name: 'Delete chat' }).click();
    await a.page.getByRole('menuitem', { name: 'Delete chat' }).click();
    await expect(a.page.getByTestId('chat-row')).toHaveCount(0);
    await say(sara, c.id, 'are you there?');
    await expect(a.page.getByTestId('chat-row')).toHaveText(/are you there\?/);

    await a.page.goto('/settings/profile');
    await a.page.getByRole('button', { name: 'Delete account' }).click();
    const dlg = a.page.getByRole('dialog', { name: 'Delete my account' });
    await dlg.getByRole('button', { name: 'Send code to my phone' }).click();
    await expect(dlg.getByLabel(/Code sent to/)).toBeVisible(); // the new code has been sent
    await dlg.getByLabel(/Code sent to/).fill(await codeFor(ali.phone));
    await dlg.getByLabel('Why are you leaving? (optional)').selectOption('Something else');
    await dlg.getByRole('button', { name: 'Delete account' }).click();
    await expect(a.page).toHaveURL(/\/sign-in\?deleted=1$/, { timeout: 15_000 });
    await expect(a.page.getByRole('status')).toContainText('Your account was deleted.');
    await a.page.goto('/chats');
    await expect(a.page).toHaveURL(/\/sign-in/);
    await a.ctx.close();
  });

  test('on a phone: the list of sections, then a section with a back button', async ({ browser }) => {
    const ali = await apiUser('Ali');
    const a = await pageAs(browser, ali, { width: 390, height: 844 });
    await a.page.goto('/settings');
    await a.page.getByRole('link', { name: /Privacy/ }).click();
    await expect(a.page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
    await expect(a.page.getByRole('complementary', { name: 'Settings sections' })).toBeHidden();
    await a.page.getByRole('link', { name: 'Settings' }).first().click();
    await expect(a.page.getByRole('complementary', { name: 'Settings sections' })).toBeVisible();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await a.ctx.close();
  });
});
