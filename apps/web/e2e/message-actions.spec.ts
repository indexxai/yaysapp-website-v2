import { expect, test, type Page } from './test';
import { apiCall, apiUser, pageAs, type ApiUser } from './helpers';

/** A message by its own text (not a reply that merely quotes it). */
const bubble = (p: Page, text: string) => p.getByTestId('message').filter({ has: p.locator('.msg__text', { hasText: text }) }).last();
const say = (u: ApiUser, c: string, text: string) => apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text }, u.tokens.accessToken);
async function menu(p: Page, text: string, item: string) {
  const m = bubble(p, text);
  await m.hover();
  await m.getByRole('button', { name: 'More actions' }).click();
  await p.getByRole('menuitem', { name: item }).click();
}

test.describe('Message actions on the web', () => {
  test('react, reply with a quote, and edit; the other person sees each change live', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(ali, c.id, 'Venue is booked for 8 pm');
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await a.page.goto(`/chats?c=${c.id}`); await s.page.goto(`/chats?c=${c.id}`);

    // React
    const target = bubble(s.page, 'Venue is booked');
    await target.hover();
    await target.getByRole('button', { name: 'React' }).click();
    await s.page.getByRole('menuitem', { name: 'React 👍' }).click();
    await expect(bubble(a.page, 'Venue is booked').getByRole('button', { name: /^👍 1: Sara$/ })).toBeVisible();
    await bubble(a.page, 'Venue is booked').getByRole('button', { name: /^👍 1/ }).click();
    await expect(bubble(s.page, 'Venue is booked').getByRole('button', { name: '👍 2: You, Ali' })).toBeVisible();
    await bubble(a.page, 'Venue is booked').getByRole('button', { name: /^👍 2/ }).click(); // take mine back
    await expect(bubble(s.page, 'Venue is booked').getByRole('button', { name: /^👍 1: You$/ })).toBeVisible();

    // Reply
    await target.hover();
    await target.getByRole('button', { name: 'Reply' }).click();
    await expect(s.page.getByText('Replying to Ali')).toBeVisible();
    await s.page.getByLabel('Message', { exact: true }).fill('Perfect, see you there');
    await s.page.getByLabel('Message', { exact: true }).press('Enter');
    await expect(s.page.getByText('Replying to Ali')).toHaveCount(0);
    const reply = bubble(a.page, 'Perfect, see you there');
    await expect(reply.getByRole('button', { name: 'Replying to Sara' })).toHaveCount(0);
    await expect(reply.getByRole('button', { name: 'Replying to You' })).toContainText('Venue is booked for 8 pm');
    await reply.getByRole('button', { name: 'Replying to You' }).click();
    await expect(bubble(a.page, 'Venue is booked')).toHaveClass(/msg--flash/);

    // Edit (Esc cancels; Enter saves)
    await menu(a.page, 'Venue is booked', 'Edit');
    await expect(a.page.getByText('Editing message')).toBeVisible();
    await expect(a.page.getByLabel('Message', { exact: true })).toHaveValue('Venue is booked for 8 pm');
    await a.page.getByLabel('Message', { exact: true }).press('Escape');
    await expect(a.page.getByText('Editing message')).toHaveCount(0);
    await expect(a.page.getByLabel('Message', { exact: true })).toHaveValue('');
    await menu(a.page, 'Venue is booked', 'Edit');
    await a.page.getByLabel('Message', { exact: true }).fill('Venue is booked for 8:30 pm');
    await a.page.getByLabel('Message', { exact: true }).press('Enter');
    await expect(bubble(s.page, 'Venue is booked for 8:30 pm')).toContainText('Edited');
    // The quote in Sara's reply follows the edit.
    await expect(bubble(s.page, 'Perfect, see you there').getByRole('button', { name: 'Replying to Ali' })).toContainText('8:30 pm');
    // Sara can't edit Ali's message.
    await bubble(s.page, '8:30 pm').hover();
    await bubble(s.page, '8:30 pm').getByRole('button', { name: 'More actions' }).click();
    await expect(s.page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
    await a.ctx.close(); await s.ctx.close();
  });

  test('delete for everyone and for me', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(ali, c.id, 'oops wrong chat');
    await say(ali, c.id, 'keep this one');
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await a.page.goto(`/chats?c=${c.id}`); await s.page.goto(`/chats?c=${c.id}`);
    await menu(a.page, 'oops wrong chat', 'Delete');
    await a.page.getByRole('dialog', { name: 'Delete message?' }).getByRole('button', { name: 'Delete for everyone' }).click();
    await expect(a.page.getByText('You deleted this message')).toBeVisible();
    await expect(s.page.getByText('This message was deleted')).toBeVisible();
    await expect(s.page.getByText('oops wrong chat')).toHaveCount(0);
    // Sara deletes Ali's other message for herself only: no "for everyone" option.
    await menu(s.page, 'keep this one', 'Delete');
    const dlg = s.page.getByRole('dialog', { name: 'Delete message?' });
    await expect(dlg.getByRole('button', { name: 'Delete for everyone' })).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Delete for me' }).click();
    await expect(s.page.getByTestId('message').filter({ hasText: 'keep this one' })).toHaveCount(0);
    await expect(bubble(a.page, 'keep this one')).toBeVisible();
    await s.page.reload();
    await expect(s.page.getByTestId('message').filter({ hasText: 'This message was deleted' })).toBeVisible();
    await expect(s.page.getByTestId('message').filter({ hasText: 'keep this one' })).toHaveCount(0);
    await a.ctx.close(); await s.ctx.close();
  });

  test('pin, star and message info', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar');
    const g = await apiCall('/v1/groups', { name: 'Trip', memberIds: [sara.id, omar.id] }, ali.tokens.accessToken);
    await say(ali, g.id, 'Bus leaves at 7 sharp');
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto(`/chats?c=${g.id}`);
    await a.page.goto(`/chats?c=${g.id}`);
    await menu(a.page, 'Bus leaves', 'Pin');
    await expect(s.page.getByRole('button', { name: 'Pinned message from Ali' })).toContainText('Bus leaves at 7 sharp');
    await expect(s.page.getByTestId('system-line').last()).toHaveText('Ali pinned a message');
    await menu(a.page, 'Bus leaves', 'Star');
    await expect(bubble(a.page, 'Bus leaves').getByRole('img', { name: 'Starred' })).toBeVisible();
    await expect(bubble(s.page, 'Bus leaves').getByRole('img', { name: 'Starred' })).toHaveCount(0);
    await menu(a.page, 'Bus leaves', 'Message info');
    const info = a.page.getByRole('complementary', { name: 'Message info' });
    await expect(info.getByRole('region', { name: 'Read by 1' })).toContainText('Sara');
    await expect(info.getByRole('region', { name: /Not delivered yet 1/ })).toContainText('Omar');
    // Omar opens the chat: the info updates by itself.
    const o = await pageAs(browser, omar);
    await o.page.goto(`/chats?c=${g.id}`);
    await expect(info.getByRole('region', { name: 'Read by 2' })).toContainText('Omar');
    await info.getByRole('button', { name: 'Close' }).click();
    await menu(a.page, 'Bus leaves', 'Unpin');
    await expect(s.page.getByRole('button', { name: /Pinned message/ })).toHaveCount(0);
    for (const p of [a, s, o]) await p.ctx.close();
  });

  test('forward to several chats with a note; admins-only chats can’t be picked', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar'), zara = await apiUser('Zara');
    const c = await apiCall('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(sara, c.id, 'Poster for Friday 🎉');
    const d = await apiCall('/v1/conversations/direct', { userId: omar.id }, ali.tokens.accessToken);
    await say(omar, d.id, 'hey');
    const g = await apiCall('/v1/groups', { name: 'Design crew', memberIds: [omar.id] }, ali.tokens.accessToken);
    await apiCall('/v1/groups', { name: 'Zara news', memberIds: [ali.id], settings: { send: 'admins' } }, zara.tokens.accessToken);
    const a = await pageAs(browser, ali), o = await pageAs(browser, omar);
    await o.page.goto(`/chats?c=${d.id}`);
    await a.page.goto(`/chats?c=${c.id}`);
    await bubble(a.page, 'Poster for Friday').hover();
    await bubble(a.page, 'Poster for Friday').getByRole('button', { name: 'Forward' }).click();
    const dlg = a.page.getByRole('dialog', { name: 'Forward to…' });
    await expect(dlg.getByRole('checkbox', { name: 'Zara news' })).toBeDisabled();
    await dlg.getByRole('checkbox', { name: 'Omar' }).check();
    await dlg.getByRole('checkbox', { name: 'Design crew' }).check();
    await expect(dlg.getByText('Sending to Omar, Design crew')).toBeVisible();
    await dlg.getByLabel('Add a message').fill('For the weekend');
    await dlg.getByRole('button', { name: 'Forward' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(bubble(o.page, 'Poster for Friday')).toContainText('Forwarded');
    await expect(bubble(o.page, 'For the weekend')).toBeVisible();
    await o.page.goto(`/chats?c=${g.id}`);
    await expect(bubble(o.page, 'Poster for Friday')).toContainText('Forwarded');
    await a.ctx.close(); await o.ctx.close();
  });
});
