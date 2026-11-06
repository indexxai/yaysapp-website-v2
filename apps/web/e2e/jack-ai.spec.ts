// The light Jack's AI on the web: a picture made and changed in the conversation, sent into a chat;
// a document sent into a chat; specialised work points to the full Jack's AI.
import { expect, test } from './test';
import { API, apiCall, apiUser, pageAs } from './helpers';

test.describe('Jack’s AI: pictures, documents, the full Jack’s AI', () => {
  test('make a picture, change it, send it to a chat; five a day', async ({ browser }) => {
    const sara = await apiUser('Sara'), ali = await apiUser('Ali');
    const c = (await apiCall('/v1/conversations/direct', { userId: ali.id }, sara.tokens.accessToken)).id as string;
    await apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text: 'Hi Ali' }, sara.tokens.accessToken);
    const s = await pageAs(browser, sara);
    await s.page.goto('/ai');
    await s.page.getByRole('radio', { name: 'Image' }).click();
    await expect(s.page.getByTestId('pics-left')).toHaveText('5 of 5 pictures left today');
    await s.page.getByLabel('Message Jack').fill('Our bunny mascot running a race at sunset');
    await s.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(s.page.getByRole('img', { name: 'Picture 1 made by Jack’s AI' })).toBeVisible();
    await expect(s.page.getByText('Here it is.')).toBeVisible();
    await expect(s.page.getByTestId('pics-left')).toHaveText('4 of 5 pictures left today');

    // Change it.
    await s.page.getByRole('button', { name: 'Change picture 1' }).click();
    await expect(s.page.getByText('Changing picture 1. Say what to change.')).toBeVisible();
    await s.page.getByLabel('Message Jack').fill('Make it more orange');
    await s.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(s.page.getByText('Here’s number 1 with your change.')).toBeVisible();
    await expect(s.page.getByText('Change to picture 1')).toBeVisible();
    await expect(s.page.getByRole('img', { name: 'Picture 1 made by Jack’s AI' })).toHaveCount(2);
    await expect(s.page.getByTestId('pics-left')).toHaveText('3 of 5 pictures left today');

    // Send the new one into the chat with Ali.
    await s.page.getByRole('button', { name: 'Send picture 1 to a chat' }).last().click();
    await s.page.getByRole('radio', { name: 'Ali' }).check({ force: true });
    await s.page.getByPlaceholder('Add a message (optional)').fill('Poster idea');
    await s.page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(s.page).toHaveURL(new RegExp(`/chats\\?c=${c}`));
    await expect(s.page.getByText('Poster idea', { exact: true })).toBeVisible();
    const msgs = await (await fetch(`${API}/v1/conversations/${c}/messages`, { headers: { authorization: `Bearer ${ali.tokens.accessToken}` } })).json();
    expect(msgs.items.find((m: { text: string }) => m.text === 'Poster idea').attachment).toMatchObject({ kind: 'image', name: 'jacks-ai-1.png' });

    // Three more, then none left.
    await s.page.goto('/ai');
    await s.page.getByRole('radio', { name: 'Image' }).click();
    for (const p of ['a kite', 'a boat', 'a tree']) {
      await s.page.getByLabel('Message Jack').fill(p);
      await s.page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(s.page.getByText('Here it is.').last()).toBeVisible();
    }
    await expect(s.page.getByText('You’ve made today’s 5 pictures.')).toBeVisible();
    await s.page.getByRole('button', { name: 'Back to chat' }).click();
    await expect(s.page.getByLabel('Message Jack')).toBeVisible();
    await s.ctx.close();
  });

  test('a document goes into a chat as a Word file; bookings point to the full Jack’s AI', async ({ browser }) => {
    const sara = await apiUser('Sara'), ali = await apiUser('Ali');
    const c = (await apiCall('/v1/conversations/direct', { userId: ali.id }, sara.tokens.accessToken)).id as string;
    await apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text: 'Hi Ali' }, sara.tokens.accessToken);
    const s = await pageAs(browser, sara);
    await s.page.goto('/ai');
    await s.page.getByRole('radio', { name: 'Document' }).click();
    await s.page.getByLabel('Message Jack').fill('Write a menu for Sunday lunch');
    await s.page.getByRole('button', { name: 'Send', exact: true }).click();
    const panel = s.page.getByRole('complementary', { name: 'Document preview' });
    await expect(panel.getByRole('heading', { name: 'Menu for Sunday lunch' }).first()).toBeVisible();
    await panel.getByRole('button', { name: 'Send to chat' }).click();
    await s.page.getByRole('radio', { name: 'Ali' }).check({ force: true });
    await s.page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(s.page).toHaveURL(new RegExp(`/chats\\?c=${c}`));
    await expect(s.page.getByText('Menu for Sunday lunch.doc')).toBeVisible();

    await s.page.goto('/ai');
    await s.page.getByLabel('Message Jack').fill('Book me the cheapest flight to Dubai');
    await s.page.getByRole('button', { name: 'Send', exact: true }).click();
    const card = s.page.getByRole('link', { name: /Open the full Jack’s AI/ });
    await expect(card).toHaveAttribute('href', 'https://jackai.si');
    await expect(card).toHaveAttribute('target', '_blank');
    await s.ctx.close();
  });
});
