import { expect, test, type Page } from './test';
import { apiCall, apiUser, pageAs, type ApiUser } from './helpers';

const say = (u: ApiUser, c: string, text: string) => apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text }, u.tokens.accessToken);
const msg = (p: Page, text: string) => p.getByTestId('message').filter({ has: p.locator('.msg__text', { hasText: text }) });

test.describe('Search on the web', () => {
  test('Ctrl K searches chats, people and messages; a message opens in its chat, scrolled to it', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), zara = await apiUser('Zara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(sara, c.id, 'The invoice for the venue is attached');
    for (let i = 0; i < 70; i++) await say(sara, c.id, `filler ${i}`); // the match is far up the chat
    const g = await apiCall('/v1/groups', { name: 'Venue crew', memberIds: [sara.id] }, ali.tokens.accessToken);
    await say(sara, g.id, 'Which venue did we pick?');

    const a = await pageAs(browser, ali);
    await a.page.goto('/chats');
    await expect(a.page.getByTestId('chat-row')).toHaveCount(2);
    await a.page.keyboard.press('Control+k');
    const box = a.page.getByRole('searchbox', { name: 'Search chats, people and messages' });
    await expect(box).toBeFocused();
    await box.fill('venue');
    const results = a.page.getByRole('region', { name: 'Search' });
    await expect(results.getByTestId('search-chat')).toHaveText(/Venue crew/);
    await expect(results.getByTestId('search-message')).toHaveCount(2);
    await expect(results.getByTestId('search-message').first()).toContainText('Sara: Which venue did we pick?');
    await expect(results.locator('mark.hit').first()).toHaveText(/venue/i);
    await expect(results.getByRole('tab', { name: /Messages/ })).toContainText('2');

    // The old message: opens Sara's chat and scrolls up to it.
    await results.getByTestId('search-message').filter({ hasText: 'invoice' }).click();
    await expect(a.page.getByRole('region', { name: 'Chat with Sara' })).toBeVisible();
    await expect(msg(a.page, 'The invoice for the venue')).toBeInViewport();
    await expect(results).toBeVisible(); // results stay, to try the next one

    // People: someone found only by their exact username.
    await box.fill(`@${zara.username}`);
    await results.getByRole('tab', { name: 'People' }).click();
    const z = results.getByTestId('search-person');
    await expect(z).toContainText('not in your chats');
    await z.click();
    await expect(a.page.getByRole('region', { name: 'Chat with Zara' })).toBeVisible();

    // Nothing found, then Esc clears and closes.
    await box.fill('qwertyzz');
    await results.getByRole('tab', { name: 'All' }).click();
    await expect(results.getByRole('status')).toHaveText('Nothing found for “qwertyzz”.');
    await box.press('Escape');
    await expect(box).toHaveValue('');
    await box.press('Escape');
    await expect(results).toHaveCount(0);
    await expect(a.page.getByRole('button', { name: 'Search chats, people and messages' })).toBeVisible();
    await a.ctx.close();
  });

  test('search inside a chat: result n of m, older and newer', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(sara, c.id, 'first mango of the season');
    for (let i = 0; i < 60; i++) await say(ali, c.id, `chat ${i}`);
    await say(sara, c.id, 'second Mango shake');
    await say(ali, c.id, 'third: mangoes again');
    const a = await pageAs(browser, ali);
    await a.page.goto(`/chats?c=${c.id}`);
    await expect(msg(a.page, 'third: mangoes again')).toBeVisible();
    await a.page.getByRole('button', { name: 'Search', exact: true }).click();
    const box = a.page.getByRole('searchbox', { name: 'Search in this chat' });
    await box.fill('mango');
    const pos = a.page.getByTestId('in-chat-result');
    await expect(pos).toHaveText('Result 1 of 3');
    await box.press('Enter');
    await expect(pos).toHaveText('Result 2 of 3');
    await expect(msg(a.page, 'second Mango shake')).toBeInViewport();
    await a.page.getByRole('button', { name: 'Older result' }).click();
    await expect(pos).toHaveText('Result 3 of 3');
    await expect(msg(a.page, 'first mango of the season')).toBeInViewport(); // loaded older pages to get there
    await expect(a.page.getByRole('button', { name: 'Older result' })).toBeDisabled();
    await a.page.getByRole('button', { name: 'Newer result' }).click();
    await expect(pos).toHaveText('Result 2 of 3');
    await box.fill('papaya');
    await expect(pos).toHaveText('No results');
    await box.press('Escape');
    await expect(box).toHaveCount(0);
    await a.ctx.close();
  });
});
