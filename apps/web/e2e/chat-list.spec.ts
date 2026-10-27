import { expect, test, type Page } from '@playwright/test';
import { apiCall, apiUser, db, pageAs, png, type ApiUser } from './helpers';

const say = (u: ApiUser, c: string, text: string) => apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text }, u.tokens.accessToken);
const row = (p: Page, name: string) => p.locator('.chat-row').filter({ has: p.locator('.ys-row-item__title', { hasText: name }) });
async function rowMenu(p: Page, name: string, item: string) {
  const r = row(p, name);
  await r.hover();
  await r.getByRole('button', { name: `Options for ${name}` }).click();
  await p.getByRole('menuitem', { name: item }).click();
}

test.describe('Chat list on the web', () => {
  test('pin, mute, mark unread, filters and archive from a chat’s menu', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar');
    const withSara = await apiCall('/v1/conversations/direct', { userId: ali.id }, sara.tokens.accessToken);
    await say(sara, withSara.id, 'Hi Ali');
    const withOmar = await apiCall('/v1/conversations/direct', { userId: ali.id }, omar.tokens.accessToken);
    await say(omar, withOmar.id, 'Yo');
    const g = await apiCall('/v1/groups', { name: 'Family', memberIds: [sara.id] }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto('/chats');
    const titles = () => a.page.getByTestId('chat-row').locator('.ys-row-item__title').allTextContents();
    await expect.poll(titles).toEqual(['Family', 'Omar', 'Sara']);

    // Pin Sara: she goes to the top with a pin.
    await rowMenu(a.page, 'Sara', 'Pin chat');
    await expect.poll(titles).toEqual(['Sara', 'Family', 'Omar']);
    await expect(row(a.page, 'Sara').getByRole('img', { name: 'Pinned', includeHidden: true })).toHaveCount(1);
    // Mute Omar for 8 hours: bell-off, and his unread count goes grey.
    await rowMenu(a.page, 'Omar', 'Mute notifications');
    await a.page.getByRole('menuitem', { name: 'Mute for 8 hours' }).click();
    await expect(row(a.page, 'Omar').getByRole('img', { name: 'Muted', includeHidden: true })).toHaveCount(1);
    await expect(row(a.page, 'Omar').locator('.ys-badge--muted')).toHaveCount(1);

    // Filters.
    await a.page.getByRole('tab', { name: /Unread/ }).click();
    await expect.poll(titles).toEqual(['Sara', 'Omar']);
    await a.page.getByRole('tab', { name: 'Groups' }).click();
    await expect.poll(titles).toEqual(['Family']);
    // Mark the group unread: it shows a dot and joins the Unread filter.
    await rowMenu(a.page, 'Family', 'Mark as unread');
    await expect(row(a.page, 'Family').getByLabel('Marked unread')).toBeVisible();
    await a.page.getByRole('tab', { name: /Unread/ }).click();
    await expect(a.page.getByRole('tab', { name: /Unread/ })).toContainText('3');
    // Opening it clears the mark.
    await row(a.page, 'Family').getByTestId('chat-row').click();
    await expect(a.page.getByRole('region', { name: 'Chat with Family' })).toBeVisible();
    await expect(a.page.getByRole('tab', { name: /Unread/ })).toContainText('2');
    await a.page.getByRole('tab', { name: 'All' }).click();

    // Archive Omar: he leaves the list, even when he writes again.
    await rowMenu(a.page, 'Omar', 'Archive chat');
    await expect.poll(titles).toEqual(['Sara', 'Family']);
    const archived = a.page.getByRole('button', { name: /Archived/ });
    await expect(archived).toContainText('1');
    await say(omar, withOmar.id, 'still here');
    await expect(archived).toContainText('1');
    await expect.poll(titles).toEqual(['Sara', 'Family']);
    await archived.click();
    const box = a.page.getByRole('region', { name: 'Archived chats' });
    await expect(box.getByTestId('chat-row')).toHaveText(/still here/);
    await rowMenu(a.page, 'Omar', 'Unarchive chat');
    await expect(box.getByTestId('chat-row')).toHaveCount(0);
    await box.getByRole('button', { name: 'Chats' }).click();
    await expect.poll(titles).toEqual(['Sara', 'Omar', 'Family']);
    // The settings are mine only, and reach my other tabs.
    const b = await pageAs(browser, ali);
    await b.page.goto('/chats');
    await expect(row(b.page, 'Sara').getByRole('img', { name: 'Pinned', includeHidden: true })).toHaveCount(1);
    await rowMenu(b.page, 'Sara', 'Unpin chat');
    await expect(row(a.page, 'Sara').getByRole('img', { name: 'Pinned', includeHidden: true })).toHaveCount(0);
    expect(g.id).toBeTruthy();
    await a.ctx.close(); await b.ctx.close();
  });

  test('contact info: shared media, groups in common, mute and clear chat', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await apiCall('/v1/groups', { name: 'Friday dinner', memberIds: [sara.id] }, ali.tokens.accessToken);
    await say(sara, c.id, 'menu at https://yaysapp.com/menu');
    const a = await pageAs(browser, ali);
    await a.page.goto(`/chats?c=${c.id}`);
    // Send a photo through the app.
    await a.page.getByLabel('Attach files').setInputFiles({ name: 'dinner.png', mimeType: 'image/png', buffer: png(40, 30) });
    await a.page.getByRole('dialog', { name: /Send 1 file/ }).getByRole('button', { name: 'Send' }).click();
    await expect(a.page.locator('.msg--me img').first()).toBeVisible();

    await a.page.getByRole('button', { name: 'Contact info' }).click();
    const info = a.page.getByRole('complementary', { name: 'Contact info' });
    await expect(info.getByRole('heading', { name: 'Sara' })).toBeVisible();
    await expect(info.getByRole('button', { name: /Media, links and docs/ })).toContainText('2');
    await expect(info.getByRole('region', { name: 'Groups in common' })).toContainText('Friday dinner');
    await info.getByRole('button', { name: /Media, links and docs/ }).click();
    const shared = a.page.getByRole('complementary', { name: 'Media, links and docs' });
    await expect(shared.getByTestId('shared-media')).toHaveCount(1);
    await shared.getByRole('tab', { name: 'Links' }).click();
    await expect(shared.getByTestId('shared-links')).toContainText('https://yaysapp.com/menu');
    await shared.getByRole('button', { name: 'Sara' }).click();

    await info.getByLabel('Notifications').selectOption('1w');
    await expect(info.getByText(/Muted until/)).toBeVisible();
    await expect(row(a.page, 'Sara').getByRole('img', { name: 'Muted', includeHidden: true })).toHaveCount(1);

    await info.getByRole('button', { name: 'Clear chat' }).click();
    await info.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(a.page.locator('[data-testid=message]')).toHaveCount(0);
    await say(sara, c.id, 'after clearing');
    await expect(a.page.locator('[data-testid=message]')).toHaveCount(1);
    await a.ctx.close();
  });

  test('block: the composer locks, their messages don’t arrive, and unblocking brings it back; reporting', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(sara, c.id, 'hello');
    const a = await pageAs(browser, ali);
    await a.page.goto(`/chats?c=${c.id}`);
    await a.page.getByRole('button', { name: 'Contact info' }).click();
    const info = a.page.getByRole('complementary', { name: 'Contact info' });
    await info.getByRole('button', { name: 'Block' }).click();
    const dlg = a.page.getByRole('dialog', { name: 'Block Sara?' });
    await expect(dlg).toContainText('They are not told that you blocked them.');
    await dlg.getByRole('button', { name: 'Block', exact: true }).click();
    await expect(info).toContainText('Sara is blocked.');
    await expect(a.page.locator('.composer--locked')).toHaveText(/You blocked Sara\./);
    await say(sara, c.id, 'are you ignoring me?');
    await a.page.waitForTimeout(800);
    await expect(a.page.locator('.msg--them')).toHaveCount(1);

    await a.page.locator('.composer--locked').getByRole('button', { name: 'Unblock' }).click();
    await expect(a.page.getByLabel('Message', { exact: true })).toBeVisible();
    await say(sara, c.id, 'ok now?');
    await expect(a.page.locator('.msg--them .msg__text').last()).toHaveText('ok now?');

    await info.getByRole('button', { name: 'Report' }).click();
    const rep = a.page.getByRole('dialog', { name: 'Report Sara?' });
    await rep.getByRole('button', { name: 'Report and block' }).click();
    await expect(rep.getByRole('alert')).toHaveText('Pick a reason for the report.');
    await rep.getByRole('switch', { name: 'Also block Sara' }).click();
    await rep.getByRole('radio', { name: 'Harassment' }).click();
    await rep.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(info).toContainText('Thanks for reporting.');
    const r = await db((d) => d.collection('yc_reports').findOne({ reason: 'harassment' }, { sort: { at: -1 } }));
    expect(r!.evidence.map((e: { text: string }) => e.text)).toEqual(['ok now?', 'are you ignoring me?', 'hello']);
    await expect(a.page.getByLabel('Message', { exact: true })).toBeVisible(); // not blocked
    await a.ctx.close();
  });
});
