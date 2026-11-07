// Every settings section, end to end in the browser: what each control saves on the server, and what you see after a reload.
import { readFileSync } from 'node:fs';
import { expect, test } from './test';
import { API, apiCall, apiUser, codeFor, freshEmail, pageAs, type ApiUser } from './helpers';

const get = async (u: ApiUser, p: string) => (await fetch(`${API}${p}`, { headers: { authorization: `Bearer ${u.tokens.accessToken}` } })).json();
const me = (u: ApiUser) => get(u, '/v1/me');
/** The same person signed in on another device (new tokens). */
async function signInAgain(u: ApiUser, n: number): Promise<ApiUser> {
  await apiCall('/v1/auth/email/start', { email: u.email });
  const r = await apiCall('/v1/auth/email/verify', { email: u.email, code: await codeFor(u.email), device: { deviceId: `web-other-${n}-${u.id.slice(-6)}`, platform: 'web', name: `Other browser ${n}` } });
  return { ...u, tokens: r.tokens };
}

test.describe('Settings: every section end to end', () => {
  test('profile: name, username and about save; a taken username is refused; email changes with a code; my data downloads', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const a = await pageAs(browser, ali);
    await a.page.goto('/settings/profile');
    await a.page.getByLabel('Name', { exact: true }).fill('Ali Raza');
    await a.page.getByLabel('About').fill('Coffee first');
    await a.page.getByLabel('Username').fill(sara.username);
    await a.page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(a.page.getByText(/already taken|is taken/i)).toBeVisible();
    await a.page.getByLabel('Username').fill(`ali_${ali.id.slice(-5)}`);
    await a.page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await me(ali)).displayName).toBe('Ali Raza');
    expect(await me(ali)).toMatchObject({ about: 'Coffee first', username: `ali_${ali.id.slice(-5)}` });
    await a.page.reload();
    await expect(a.page.getByLabel('Name', { exact: true })).toHaveValue('Ali Raza');
    await expect(a.page.locator('.settings__me')).toContainText('Ali Raza');

    // Change email: a code to the new address, then it shows here and signs in.
    const next = freshEmail('alinew');
    await a.page.getByRole('button', { name: 'Change email' }).click();
    await a.page.getByLabel('New email').fill('not an email');
    await a.page.getByRole('button', { name: 'Send code' }).click();
    await expect(a.page.getByText('Enter an email address')).toBeVisible();
    await a.page.getByLabel('New email').fill(sara.email);
    await a.page.getByRole('button', { name: 'Send code' }).click();
    await expect(a.page.getByText('already used by another account')).toBeVisible();
    await a.page.getByLabel('New email').fill(next);
    await a.page.getByRole('button', { name: 'Send code' }).click();
    await a.page.getByLabel('Code').fill(await codeFor(next));
    await a.page.getByRole('button', { name: 'Change email' }).last().click();
    await expect(a.page.getByText('Your email was changed.')).toBeVisible();
    await expect(a.page.getByText(next).first()).toBeVisible();
    expect((await me(ali)).email).toBe(next);

    // Download my data: a JSON file with my profile.
    const dl = a.page.waitForEvent('download');
    await a.page.getByRole('button', { name: 'Download' }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/^yaysapp-data-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync((await file.path())!, 'utf8'));
    expect(data.profile).toMatchObject({ displayName: 'Ali Raza', email: next });
    await a.ctx.close();
  });

  test('devices: another browser shows up and can be logged out, then all others; that browser goes back to sign-in', async ({ browser }) => {
    const ali = await apiUser('Ali');
    const other = await signInAgain(ali, 1);
    const third = await signInAgain(ali, 2);
    const a = await pageAs(browser, ali);
    const b = await pageAs(browser, other);
    await b.page.goto('/chats');
    await expect(b.page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await a.page.goto('/settings/devices');
    await expect(a.page.getByTestId('device-row')).toHaveCount(3);
    await expect(a.page.getByText('This browser · active now')).toBeVisible();
    await a.page.getByTestId('device-row').filter({ hasText: 'Other browser 1' }).getByRole('button', { name: 'Log out' }).click();
    await expect(a.page.getByText('Other browser 1 was logged out.')).toBeVisible();
    await expect(a.page.getByTestId('device-row')).toHaveCount(2);
    // The logged-out browser is sent to sign-in on its next request.
    await b.page.reload();
    await expect(b.page).toHaveURL(/\/sign-in/);
    await a.page.getByRole('button', { name: 'Log out all other devices' }).click();
    await expect(a.page.getByText('All other devices were logged out.')).toBeVisible();
    await expect(a.page.getByTestId('device-row')).toHaveCount(1);
    expect((await fetch(`${API}/v1/me`, { headers: { authorization: `Bearer ${third.tokens.accessToken}` } })).status).toBe(401);
    await a.ctx.close(); await b.ctx.close();
  });

  test('appearance, Enter to send and sound are saved to the account, so another browser gets them; a chat exports as text', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = (await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken)).id;
    await apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text: 'Hello from Ali' }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto('/settings/appearance');
    await a.page.getByRole('radio', { name: 'Dark' }).check({ force: true });
    await a.page.getByLabel('Text size').fill('5');
    await a.page.getByRole('switch', { name: 'Press Enter to send' }).click();
    await expect(a.page.getByText('Saved. Your other devices use this too.')).toBeVisible();
    await a.page.goto('/settings/notifications');
    await a.page.getByRole('switch', { name: 'Sound' }).click();
    await expect.poll(async () => (await me(ali)).preferences).toEqual({ theme: 'dark', textSize: 5, enterToSend: false, sound: false });
    // A browser that has never seen these settings picks them up from the account.
    const b = await pageAs(browser, await signInAgain(ali, 3));
    await b.page.goto('/chats');
    await expect(b.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await b.page.goto('/settings/appearance');
    await expect(b.page.getByLabel('Text size')).toHaveValue('5');
    await expect(b.page.getByRole('switch', { name: 'Press Enter to send' })).toHaveAttribute('aria-checked', 'false');
    // The theme button in the side bar saves too.
    await b.page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect.poll(async () => (await me(ali)).preferences.theme).toBe('light');
    // Export a chat.
    const dl = a.page.waitForEvent('download');
    await a.page.goto('/settings/appearance');
    await a.page.getByLabel('Chat', { exact: true }).selectOption({ label: 'Sara' });
    await a.page.getByRole('button', { name: 'Export' }).click();
    const file = await dl;
    expect(readFileSync((await file.path())!, 'utf8')).toContain('You: Hello from Ali');
    await a.ctx.close(); await b.ctx.close();
  });

  test('socials: add a username, choose who sees them, remove it; signing in to Indexx and out', async ({ browser }) => {
    const ali = await apiUser('Ali');
    const a = await pageAs(browser, ali);
    await a.page.goto('/settings/socials');
    await a.page.getByRole('button', { name: 'Add Instagram' }).click();
    await a.page.getByLabel('Username').fill('@ali.raza');
    await a.page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await get(ali, '/v1/me/socials')).links.map((l: { network: string; handle: string }) => `${l.network}:${l.handle}`)).toContain('instagram:@ali.raza');
    await a.page.getByRole('radio', { name: 'Nobody' }).click();
    await expect.poll(async () => (await get(ali, '/v1/me/socials')).visibility).toBe('nobody');
    await a.page.getByRole('button', { name: 'Remove Instagram' }).click();
    await expect.poll(async () => (await get(ali, '/v1/me/socials')).links.length).toBe(0);

    await a.page.goto('/settings/indexx');
    const ix = `ali.${ali.id.slice(-8)}@indexx.io`;
    await a.page.getByLabel('Indexx email').fill(ix);
    await a.page.getByLabel('Indexx password').fill('pass-1234');
    await a.page.getByRole('button', { name: 'Sign in to Indexx' }).click();
    await expect(a.page.getByText(`${ix} · since`)).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByText(`${ix} · since`)).toBeVisible();
    await a.page.getByRole('button', { name: 'Sign out of Indexx' }).click();
    await expect(a.page.getByText('Signed out of Indexx.')).toBeVisible();
    await expect(a.page.getByLabel('Indexx email')).toBeVisible();
    await a.ctx.close();
  });

  test('help: an AI answer first; “that solved it”, or a person in the Support chat', async ({ browser }) => {
    const ali = await apiUser('Ali');
    const a = await pageAs(browser, ali);
    await a.page.goto('/settings/help');
    await a.page.getByPlaceholder(/For example/).fill('How do I change my number?');
    await a.page.getByRole('button', { name: 'Get an answer' }).click();
    await expect(a.page.getByRole('button', { name: 'That solved it' })).toBeVisible({ timeout: 15000 });
    await a.page.getByRole('button', { name: 'Talk to a person' }).click();
    await expect(a.page).toHaveURL(/\/chats\?c=/);
    await expect(a.page.getByText('YaysApp Support').first()).toBeVisible();
    await a.ctx.close();
  });
});
