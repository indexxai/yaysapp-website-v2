import { expect, test } from '@playwright/test';
import { apiCall, apiUser, pageAs } from './helpers';

test.describe('Mentions and polls on the web', () => {
  test('typing @ suggests members; the mention stands out, and the chat list shows @ to them', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara Khan'), omar = await apiUser('Omar');
    const g = await apiCall('/v1/groups', { name: 'Family', memberIds: [sara.id, omar.id] }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto('/chats');
    await a.page.goto(`/chats?c=${g.id}`);
    const box = a.page.getByLabel('Message', { exact: true });
    await box.pressSequentially('Thanks @');
    const list = a.page.getByRole('listbox', { name: 'Mention a member' });
    await expect(list.getByRole('option')).toHaveCount(2);
    await expect(list.getByRole('option', { name: 'Sara Khan' })).toBeVisible();
    await box.pressSequentially('kh');
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(list.getByRole('option', { name: 'Sara Khan' })).toBeVisible();
    await box.press('Enter'); // picks, doesn't send
    await expect(box).toHaveValue('Thanks @Sara Khan ');
    await box.pressSequentially('for the kheer');
    await box.press('Enter');
    const mine = a.page.locator('.msg--me .msg__text').last();
    await expect(mine).toHaveText('Thanks @Sara Khan for the kheer');
    await expect(mine.locator('.mention')).toHaveText('@Sara Khan');
    // Sara: an @ on the chat in the list, and her name highlighted in the chat.
    const row = s.page.getByTestId('chat-row').filter({ hasText: 'Family' });
    await expect(row.getByLabel('You were mentioned')).toBeVisible();
    await row.click();
    await expect(s.page.locator('.msg--them .mention--me')).toHaveText('@Sara Khan');
    await s.page.getByRole('button', { name: 'Chats' }).first().click().catch(() => undefined);
    await expect(s.page.getByTestId('chat-row').filter({ hasText: 'Family' }).getByLabel('You were mentioned')).toHaveCount(0);
    // Escape closes the list; a typed @ with no pick isn't a mention.
    await box.pressSequentially('@Om');
    await box.press('Escape');
    await expect(list).toHaveCount(0);
    await a.ctx.close(); await s.ctx.close();
  });

  test('create a poll, vote, change the vote, and see who voted, live on both sides', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const g = await apiCall('/v1/groups', { name: 'Family', memberIds: [sara.id] }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await a.page.goto(`/chats?c=${g.id}`); await s.page.goto(`/chats?c=${g.id}`);
    await a.page.getByRole('button', { name: 'Attach' }).click();
    await a.page.getByRole('menuitem', { name: 'Poll' }).click();
    const dlg = a.page.getByRole('dialog', { name: 'New poll' });
    await dlg.getByLabel('Question').fill('Sunday lunch time?');
    await dlg.getByLabel('Option 1', { exact: true }).fill('1:00 pm');
    await dlg.getByLabel('Option 2', { exact: true }).fill('2:30 pm');
    await dlg.getByLabel('Option 3', { exact: true }).fill('1:00 PM');
    await expect(dlg.getByText('This option is already in the poll.')).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Send poll' })).toBeDisabled();
    await dlg.getByLabel('Option 3', { exact: true }).fill('Dinner instead');
    await dlg.getByRole('button', { name: 'Send poll' }).click();
    await expect(dlg).toHaveCount(0);

    const sp = s.page.getByRole('group', { name: 'Poll: Sunday lunch time?' });
    await expect(sp.getByRole('radio')).toHaveCount(3);
    await sp.getByRole('radio', { name: /^2:30 pm/ }).click();
    await expect(sp.getByRole('radio', { name: /^2:30 pm/ })).toHaveAttribute('aria-checked', 'true');
    const ap = a.page.getByRole('group', { name: 'Poll: Sunday lunch time?' });
    await expect(ap.getByTestId('poll-count')).toHaveText('1 person voted');
    await expect(ap.getByRole('radio', { name: '2:30 pm, 1 vote' })).toBeVisible();
    // Change the vote.
    await sp.getByRole('radio', { name: /^1:00 pm/ }).click();
    await expect(ap.getByRole('radio', { name: '1:00 pm, 1 vote' })).toBeVisible();
    await expect(ap.getByRole('radio', { name: '2:30 pm, 0 votes' })).toBeVisible();
    await ap.getByRole('button', { name: 'View votes' }).click();
    await expect(a.page.getByRole('dialog', { name: 'Votes' }).getByRole('region', { name: '1:00 pm' })).toContainText('Sara');
    await a.page.keyboard.press('Escape');
    // The chat list says what it is.
    await expect(s.page.getByTestId('chat-row').filter({ hasText: 'Family' })).toContainText('📊 Sunday lunch time?');
    await a.ctx.close(); await s.ctx.close();
  });
});
