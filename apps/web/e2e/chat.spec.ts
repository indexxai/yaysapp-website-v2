import { expect, test, type Page } from './test';
import { apiCall, apiUser, pageAs, type ApiUser } from './helpers';

const row = (p: Page, name: string) => p.getByTestId('chat-row').filter({ hasText: name });
const messages = (p: Page) => p.getByTestId('message');
/** Our alerts, not Next's hidden route announcer. */
const alert = (p: Page) => p.locator('[role=alert]:not(#__next-route-announcer__)');
const lastMine = (p: Page) => p.locator('.msg--me').last();

async function startChat(p: Page, other: ApiUser) {
  await p.goto('/chats');
  await p.getByRole('button', { name: 'New chat' }).first().click();
  await p.getByLabel('Find someone').fill(`@${other.username}`);
  await p.getByRole('button', { name: 'Search' }).click();
  await p.getByTestId('lookup-result').click();
  await expect(p.getByRole('region', { name: `Chat with ${other.name}` })).toBeVisible();
}
async function send(p: Page, text: string) {
  const box = p.getByLabel('Message', { exact: true });
  await box.fill(text);
  await box.press('Enter');
}

test.describe('Week 3 · chatting on the web', () => {
  test('two people chat live: unread badge, ticks, typing and online status', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto('/chats');
    await expect(s.page.getByText('No chats yet')).toBeVisible();

    await startChat(a.page, sara);
    await expect(a.page.getByText('Say hello 👋')).toBeVisible();
    await send(a.page, 'Salam Sara! 👋');
    await expect(messages(a.page)).toHaveCount(1);
    // Sara's open list gets the chat with an unread badge, and her device confirms delivery.
    await expect(row(s.page, 'Ali')).toContainText('Salam Sara! 👋');
    await expect(row(s.page, 'Ali').getByLabel('1 unread')).toBeVisible();
    await expect(lastMine(a.page)).toHaveAttribute('data-tick', 'delivered');
    await expect(a.page.getByTestId('peer-status')).toHaveText('online');

    await row(s.page, 'Ali').click();
    await expect(s.page.getByRole('region', { name: 'Chat with Ali' })).toBeVisible();
    await expect(lastMine(a.page)).toHaveAttribute('data-tick', 'read');
    await expect(row(s.page, 'Ali').getByLabel('1 unread')).toHaveCount(0);

    // Typing shows in Ali's header and in his list, then clears when the message lands.
    await s.page.getByLabel('Message', { exact: true }).pressSequentially('Wa');
    await expect(a.page.getByTestId('peer-status')).toHaveText('typing…');
    await s.page.getByLabel('Message', { exact: true }).pressSequentially('laikum salam');
    await s.page.getByLabel('Message', { exact: true }).press('Enter');
    await expect(a.page.locator('.msg--them').last()).toContainText('Walaikum salam');
    await expect(a.page.getByTestId('peer-status')).toHaveText('online');

    // Sara leaves: Ali sees "last seen".
    await s.ctx.close();
    await expect(a.page.getByTestId('peer-status')).toHaveText(/^last seen today at \d\d:\d\d$/);
    await a.ctx.close();
  });

  test('Enter sends, Shift+Enter makes a new line, and empty or over-long messages are blocked', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const a = await pageAs(browser, ali);
    await startChat(a.page, sara);
    const box = a.page.getByLabel('Message', { exact: true });
    // With nothing typed, the button records a voice message instead of sending.
    await expect(a.page.getByRole('button', { name: 'Send' })).toHaveCount(0);
    await expect(a.page.getByRole('button', { name: 'Record' })).toBeVisible();
    await box.fill('   ');
    await expect(a.page.getByRole('button', { name: 'Send' })).toHaveCount(0);
    await box.press('Enter');
    await expect(messages(a.page)).toHaveCount(0);
    await box.fill('line one');
    await box.press('Shift+Enter');
    await box.pressSequentially('line two');
    await box.press('Enter');
    await expect(messages(a.page).first().locator('.msg__text')).toHaveText('line one\nline two');
    await box.fill('x'.repeat(4097));
    await expect(alert(a.page)).toContainText('up to 4096 characters (4097 now)');
    await expect(a.page.getByRole('button', { name: 'Send' })).toBeDisabled();
    await a.ctx.close();
  });

  test('finding people: no match, yourself, and a phone number', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const a = await pageAs(browser, ali);
    await a.page.goto('/chats');
    await a.page.getByRole('button', { name: 'New chat' }).first().click();
    const find = a.page.getByLabel('Find someone');
    await find.fill('@nobody_by_this_name');
    await a.page.getByRole('button', { name: 'Search' }).click();
    await expect(alert(a.page)).toHaveText('No one on YaysApp matches that.');
    await find.fill(`@${ali.username}`);
    await a.page.getByRole('button', { name: 'Search' }).click();
    await expect(alert(a.page)).toHaveText("That's you.");
    await find.fill('0' + sara.phone.slice(3));
    await a.page.getByRole('button', { name: 'Search' }).click();
    await expect(a.page.getByTestId('lookup-result')).toContainText('Sara');
    await a.page.getByRole('button', { name: 'Back' }).click();
    await expect(a.page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await a.ctx.close();
  });

  test('offline: messages wait with a clock, then send once, in order, when the connection returns', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await startChat(a.page, sara);
    await send(a.page, 'before the tunnel');
    await expect(lastMine(a.page)).toHaveAttribute('data-tick', /sent|delivered/);
    await s.page.goto('/chats');
    await row(s.page, 'Ali').click();

    await a.ctx.setOffline(true);
    await expect(a.page.getByRole('status').filter({ hasText: /No internet connection|Can’t reach YaysApp|Connecting/ })).toBeVisible({ timeout: 45_000 });
    for (const t of ['in the tunnel 1', 'in the tunnel 2', 'in the tunnel 3']) await send(a.page, t);
    await expect(a.page.locator('.msg--me[data-tick="pending"]')).toHaveCount(3);
    await expect(a.page.getByRole('status')).toContainText("3 messages will send when you're back online");
    await expect(a.page.getByTestId('waiting-to-send')).toHaveText('Waiting to send · 3 messages');
    await expect(a.page.getByTestId('peer-status')).toHaveText('Waiting for network…');

    await a.ctx.setOffline(false);
    await expect(a.page.locator('.msg--me[data-tick="pending"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(s.page.locator('.msg--them .msg__text')).toHaveText(['before the tunnel', 'in the tunnel 1', 'in the tunnel 2', 'in the tunnel 3']);
    await expect(lastMine(a.page)).toHaveAttribute('data-tick', 'read');
    await a.ctx.close(); await s.ctx.close();
  });

  test('a message typed offline survives closing the tab and goes out when it is opened again', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const a = await pageAs(browser, ali);
    await startChat(a.page, sara);
    const url = a.page.url();
    await a.ctx.setOffline(true);
    await expect(a.page.getByRole('status').filter({ hasText: /No internet connection|Can’t reach YaysApp|Connecting/ })).toBeVisible({ timeout: 45_000 });
    await send(a.page, 'typed with no signal');
    await expect(a.page.locator('.msg--me[data-tick="pending"]')).toHaveCount(1);
    await a.page.close();
    await a.ctx.setOffline(false);
    const again = await a.ctx.newPage();
    await again.goto(url);
    // The queued message shows straight away (still waiting), then goes out.
    const msg = again.locator('.msg--me').filter({ hasText: 'typed with no signal' });
    await expect(msg).toHaveCount(1);
    await expect(msg).not.toHaveAttribute('data-tick', 'pending', { timeout: 20_000 });
    await expect(again.locator('.msg--me .msg__text')).toHaveText(['typed with no signal']);
    const conv = new URL(url).searchParams.get('c')!;
    await expect.poll(async () => (await apiCall(`/v1/conversations/${conv}/messages`, undefined, sara.tokens.accessToken)).items.map((m: { text: string }) => m.text)).toEqual(['typed with no signal']);
    await a.ctx.close();
  });

  test('a link to a chat you are not in shows a clear message', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    const o = await pageAs(browser, omar);
    await o.page.goto(`/chats?c=${c.id}`);
    await expect(alert(o.page)).toContainText('This chat does not exist or you are not in it.');
    await o.ctx.close();
  });

  test('older messages load when scrolling up, without jumping', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    for (let i = 1; i <= 80; i++) await apiCall(`/v1/conversations/${c.id}/messages`, { clientId: crypto.randomUUID(), text: `history ${i}` }, sara.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto(`/chats?c=${c.id}`);
    await expect(messages(a.page)).toHaveCount(50);
    await expect(messages(a.page).last()).toContainText('history 80');
    await expect(messages(a.page).last()).toBeInViewport();
    await a.page.locator('.convo__scroll').evaluate((el) => { el.scrollTop = 0; });
    await expect(messages(a.page)).toHaveCount(80);
    await expect(messages(a.page).first()).toContainText('history 1');
    await expect(messages(a.page).last()).not.toBeInViewport();
    await a.ctx.close();
  });
});
