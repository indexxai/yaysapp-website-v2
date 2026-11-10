import { readFileSync } from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';

const OLD = '/mnt/user-data/uploads/yayAppData/yaysapp-website';
const oldText = (file: string) => {
  const html = readFileSync(path.join(OLD, file), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)![1]!;
  return main.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
};
/** Letters and digits only, lower case: the wording must match exactly; styling and spacing may not. */
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

test('home: the same page as the web app, with Open web app going to the web app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The chat app that rewards you for showing up.');
  await expect(page.getByRole('link', { name: 'Open web app' }).first()).toHaveAttribute('href', /\/sign-in$/);
  await expect(page.getByLabel('App Store, coming soon').first()).toBeVisible();
  await expect(page.getByLabel('Google Play, coming soon').first()).toBeVisible();
  for (const id of ['features', 'earn', 'communities', 'download', 'faq']) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the chat assistant' })).toBeVisible();
  for (const img of await page.locator('img:visible').all()) expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
});

test('light and dark: the button switches, and the choice is kept', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/privacy');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

for (const [route, file, title] of [['/privacy', 'privacy.html', 'Privacy Policy'], ['/terms', 'terms.html', 'Terms of Use'], ['/support', 'support.html', 'Support'], ['/delete-account', 'delete-account.html', 'Delete Your Account']] as const) {
  test(`${route}: same words as the old site, and the old .html address still works`, async ({ page, request }) => {
    await page.goto(route);
    await expect(page).toHaveTitle(`${title} — YaysApp`);
    const now = words((await page.locator('main').textContent()) ?? '');
    expect(now).toBe(words(oldText(file)));
    expect((await request.get(`/${file}`)).status()).toBe(200);
  });
}

test('footer links reach every page', async ({ page }) => {
  for (const [name, url] of [['Privacy policy', '/privacy'], ['Delete account', '/delete-account'], ['Terms', '/terms'], ['Support', '/support']]) {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${url}$`));
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('link', { name: 'YaysApp home' })).toBeVisible();
  }
});

test('support form sends the same request as before and reports success or failure', async ({ page }) => {
  let body: Record<string, string> | null = null;
  let fail = false;
  await page.route('https://api.v1.indexx.ai/api/v1/inex/basic/emailToAdmin', async (r) => {
    body = r.request().postDataJSON();
    await r.fulfill(fail ? { status: 500, json: { message: 'down' } } : { status: 200, json: { status: 200 } });
  });
  await page.goto('/support');
  await page.locator('#support-name').fill('Sara');
  await page.locator('#support-email').fill('Sara@Example.com');
  await page.locator('#support-message').fill('My points did not arrive.');
  await page.locator('#support-submit').click();
  await expect(page.locator('#support-status')).toHaveText('Your support request was sent. We will reply by email.');
  expect(body).toMatchObject({ name: 'Sara', email: 'sara@example.com', message: 'My points did not arrive.', website: 'YAYSAPP-WEBSITE' });
  expect(body!.subject).toMatch(/^YaysApp support — /);
  fail = true;
  await page.locator('#support-name').fill('Sara');
  await page.locator('#support-email').fill('sara@example.com');
  await page.locator('#support-message').fill('Again');
  await page.locator('#support-submit').click();
  await expect(page.locator('#support-status')).toHaveText('We could not send the form. Please email support@bitcoinyay.com instead.');
});

test('delete account: checks the form, confirms, signs in, then deletes', async ({ page }) => {
  const calls: string[] = [];
  await page.route('https://api.v1.indexx.ai/api/v1/inex/user/login', async (r) => { calls.push('login ' + JSON.stringify(r.request().postDataJSON())); await r.fulfill({ status: 200, json: { data: { access_token: 'tok' } } }); });
  await page.route('https://api.v1.indexx.ai/api/v1/inex/user/deleteaccount', async (r) => { calls.push('delete ' + r.request().headers().authorization); await r.fulfill({ status: 200, json: { status: 200 } }); });
  await page.goto('/delete-account');
  await page.locator('#delete-submit').click();
  await expect(page.locator('#delete-status')).toHaveText('Enter your account details, type DELETE exactly, and confirm the acknowledgement.');
  await page.locator('#delete-email').fill('Bye@Example.com');
  await page.locator('#delete-password').fill('pw-123');
  await page.locator('#delete-confirmation').fill('delete');
  await page.locator('#delete-ack').check();
  await page.locator('#delete-submit').click();
  await expect(page.locator('#delete-status')).toContainText('type DELETE exactly');
  await page.locator('#delete-confirmation').fill('DELETE');
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#delete-submit').click();
  expect(calls).toEqual([]); // cancelled at the confirmation
  page.once('dialog', (d) => d.accept());
  await page.locator('#delete-submit').click();
  await expect(page.locator('#delete-status')).toHaveText('Your YaysApp account has been deleted. You may now close this page.');
  expect(calls).toEqual(['login {"email":"bye@example.com","password":"pw-123"}', 'delete Bearer tok']);
  await expect(page.locator('#delete-submit')).toBeDisabled();
});

test('delete account: a wrong password shows the server message and allows another try', async ({ page }) => {
  await page.route('https://api.v1.indexx.ai/api/v1/inex/user/login', (r) => r.fulfill({ status: 401, json: { data: { message: 'Invalid email or password' } } }));
  await page.goto('/delete-account');
  await page.locator('#delete-email').fill('x@example.com');
  await page.locator('#delete-password').fill('nope');
  await page.locator('#delete-confirmation').fill('DELETE');
  await page.locator('#delete-ack').check();
  page.once('dialog', (d) => d.accept());
  await page.locator('#delete-submit').click();
  await expect(page.locator('#delete-status')).toHaveText('Invalid email or password');
  await expect(page.locator('#delete-submit')).toBeEnabled();
});
