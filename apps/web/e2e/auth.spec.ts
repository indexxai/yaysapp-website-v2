import { expect, test } from '@playwright/test';
import { codeFor, openCodeSignIn, freshEmail, freshPhone, local, seedLegacy, signInWithEmail, signUpWithPhone, typeCode, db } from './helpers';

test.describe('Week 2 · sign-in on the web', () => {
  test('signed-out visitors land on sign-in', async ({ page }) => {
    await page.goto('/chats');
    await expect(page).toHaveURL(/\/sign-in$/);
    // A big screen starts with the QR code; the code form is one click away.
    await expect(page.getByRole('heading', { name: 'Scan to sign in' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in with a code instead' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to YaysApp' })).toBeVisible();
  });

  test('new person: phone, email, profile with photo and username, then chats', async ({ page }) => {
    const phone = freshPhone(), email = freshEmail('new');
    await signUpWithPhone(page, phone, email);
    await expect(page).toHaveURL(/\/setup\/profile$/);
    await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();

    // Empty name is caught before anything is sent.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Your name is needed.')).toBeVisible();

    await page.getByLabel('Your name').fill('Hira Malik');
    const uname = `hira.${Date.now() % 100000}`;
    await page.getByLabel('Username (optional)').fill('ad');
    await expect(page.getByText('Use 3–30 letters, numbers, dots or underscores.')).toBeVisible();
    await page.getByLabel('Username (optional)').fill('admin');
    await expect(page.getByText('That username is reserved.')).toBeVisible();
    await page.getByLabel('Username (optional)').fill(uname);
    await expect(page.getByText(`@${uname} is available.`)).toBeVisible();

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex');
    await page.getByTestId('photo-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByTestId('chats-ready')).toContainText('Welcome, Hira Malik');
    await expect(page.getByTestId('chats-ready')).toContainText('Your account is ready.');

    // The session survives a reload.
    await page.reload();
    await expect(page.getByTestId('chats-ready')).toBeVisible();
  });

  test('old account: phone plus the old email brings it over, no profile step', async ({ page }) => {
    const email = freshEmail('legacy');
    await seedLegacy(email.replace(/^l/, 'L')); // stored with different capitals by the old app
    await signUpWithPhone(page, freshPhone(), email);
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByTestId('chats-ready')).toContainText('Welcome, Bilal Khan');
    await expect(page.getByTestId('chats-ready')).toContainText('Your account from the old YaysApp is connected.');
  });

  test('wrong code shows tries left; invalid number is caught; change number goes back', async ({ page }) => {
    await openCodeSignIn(page);
    await page.getByLabel('Phone number').fill('12345');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText(/Enter a mobile number/)).toBeVisible();

    const phone = freshPhone();
    await page.getByLabel('Phone number').fill(local(phone));
    await page.getByRole('button', { name: 'Send code' }).click();
    const code = await codeFor(phone);
    await typeCode(page, code === '000000' ? '111111' : '000000');
    await expect(page.getByRole('main').getByRole('alert')).toContainText("That code isn't right. 4 tries left.");
    await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Resend code' })).toBeEnabled({ timeout: 8000 });
    await page.getByRole('button', { name: 'Change number' }).click();
    await expect(page.getByLabel('Phone number')).toBeVisible();
  });

  test('an email already tied to another number is explained', async ({ page, browser }) => {
    const email = freshEmail('owner');
    const first = await browser.newPage();
    await signUpWithPhone(first, freshPhone(), email);
    await expect(first).toHaveURL(/\/setup\/profile$/);
    await first.close();
    await signUpWithPhone(page, freshPhone(), email);
    await expect(page.getByRole('main').getByRole('alert')).toContainText("This email's account already uses");
  });

  test('email sign-in and Google dev sign-in both work', async ({ page }) => {
    await signInWithEmail(page, freshEmail('mail'));
    await expect(page).toHaveURL(/\/setup\/profile$/);
    await page.evaluate(() => localStorage.clear());
    await openCodeSignIn(page);
    const g = freshEmail('google');
    page.once('dialog', (d) => d.accept(g));
    await page.getByRole('button', { name: 'Google (dev)' }).click();
    await expect(page).toHaveURL(/\/(chats|setup\/profile)$/);
  });

  test('an expired access token refreshes silently', async ({ page }) => {
    await signInWithEmail(page, freshEmail('refresh'));
    await expect(page).toHaveURL(/\/setup\/profile$/);
    await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('yays.tokens')!); t.accessToken = 'expired.or.broken'; localStorage.setItem('yays.tokens', JSON.stringify(t)); });
    await page.goto('/chats');
    await expect(page.getByTestId('chats-ready')).toBeVisible();
    const t = await page.evaluate(() => JSON.parse(localStorage.getItem('yays.tokens')!).accessToken as string);
    expect(t).not.toBe('expired.or.broken');
  });
});

test.describe('Week 2 · devices and sign-out', () => {
  test('log out another browser from Linked devices', async ({ browser }) => {
    const email = freshEmail('devices');
    const a = await browser.newContext(), b = await browser.newContext();
    const pa = await a.newPage(), pb = await b.newPage();
    await signInWithEmail(pa, email);
    await expect(pa).toHaveURL(/\/setup\/profile$/);
    await pb.waitForTimeout(5200); // the same email can only get a new code after the resend wait
    await signInWithEmail(pb, email);
    await expect(pb).toHaveURL(/\/setup\/profile$/);

    await pa.goto('/settings/devices');
    await expect(pa.getByTestId('device-row')).toHaveCount(2);
    await expect(pa.getByText('This browser · active now')).toBeVisible();
    await pa.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(pa.getByRole('status')).toContainText('was logged out');
    await expect(pa.getByTestId('device-row')).toHaveCount(1);

    await pb.goto('/chats');
    await expect(pb).toHaveURL(/\/sign-in$/);

    await pa.getByRole('button', { name: 'Log out of this browser' }).click();
    await expect(pa).toHaveURL(/\/sign-in$/);
    await pa.goto('/chats');
    await expect(pa).toHaveURL(/\/sign-in$/);
    await a.close(); await b.close();
  });

  test('a turned-off account is sent back to sign-in', async ({ page }) => {
    const email = freshEmail('off');
    await signInWithEmail(page, email);
    await expect(page).toHaveURL(/\/setup\/profile$/);
    await db((d) => d.collection('users').updateOne({ email }, { $set: { 'yc.disabledAt': new Date() } }));
    await page.goto('/chats');
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
