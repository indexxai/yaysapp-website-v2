import { expect, test, type Page } from '@playwright/test';
import { apiCall, apiUser, pageAs, type ApiUser } from './helpers';

const alert = (p: Page) => p.locator('[role=alert]:not(#__next-route-announcer__)');
const row = (p: Page, name: string) => p.getByTestId('chat-row').filter({ hasText: name });
const sys = (p: Page) => p.getByTestId('system-line');
const send = async (p: Page, text: string) => { const box = p.getByLabel('Message', { exact: true }); await box.fill(text); await box.press('Enter'); };
const info = (p: Page) => p.getByRole('complementary', { name: 'Group info' });

/** Direct chats so these people show up in the group picker. */
async function knowEachOther(a: ApiUser, ...others: ApiUser[]) {
  for (const o of others) {
    const c = await apiCall('/v1/conversations/direct', { userId: o.id }, a.tokens.accessToken);
    await apiCall(`/v1/conversations/${c.id}/messages`, { clientId: crypto.randomUUID(), text: `hi ${o.name}` }, a.tokens.accessToken);
  }
}

test.describe('Groups on the web', () => {
  test('create a group from your chats and by username, then talk in it', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar');
    await knowEachOther(ali, sara);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto('/chats');
    await a.page.goto('/chats');
    await a.page.getByRole('button', { name: 'New group' }).first().click();
    await expect(a.page.getByRole('dialog', { name: 'New group' })).toBeVisible();
    await a.page.getByRole('checkbox', { name: 'Sara' }).check();
    await a.page.getByLabel('Add people').fill(`@${omar.username}`);
    await a.page.getByLabel('Add people').press('Enter');
    await expect(a.page.getByRole('button', { name: 'Remove Omar' })).toBeVisible();
    await expect(a.page.getByText('3 of 1,024')).toBeVisible();
    await a.page.getByRole('button', { name: 'Create group' }).click();
    await expect(alert(a.page)).toHaveText('Give the group a name.');
    await a.page.getByLabel('Group name').fill('Weekend');
    await expect(a.page.getByText('7/100')).toBeVisible();
    await a.page.getByRole('button', { name: 'Create group' }).click();

    await expect(a.page.getByRole('region', { name: 'Chat with Weekend' })).toBeVisible();
    await expect(sys(a.page)).toHaveText(['You created the group “Weekend”']);
    await expect(a.page.getByTestId('peer-status')).toHaveText(/Sara, Omar, You|Omar, Sara, You/);

    // Sara's list gets it live, unread, with the line as preview.
    await expect(row(s.page, 'Weekend')).toContainText('Ali created the group “Weekend”');
    await expect(row(s.page, 'Weekend').getByLabel('1 unread')).toBeVisible();
    await row(s.page, 'Weekend').click();
    await send(s.page, 'Count me in');
    await expect(a.page.locator('.msg--them').last()).toContainText('Sara');
    await expect(a.page.locator('.msg--them .msg__sender').last()).toHaveText('Sara');
    await expect(row(a.page, 'Weekend')).toContainText('Sara: Count me in');
    // Typing names the person in a group.
    await a.page.getByLabel('Message', { exact: true }).pressSequentially('Gr');
    await expect(s.page.getByTestId('peer-status')).toHaveText('Ali is typing…');
    await a.ctx.close(); await s.ctx.close();
  });

  test('group info: rename, make admin, remove; the removed person keeps a read-only chat they can delete', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar');
    const g = await apiCall('/v1/groups', { name: 'Family', memberIds: [sara.id, omar.id] }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara), o = await pageAs(browser, omar);
    await s.page.goto(`/chats?c=${g.id}`);
    await o.page.goto(`/chats?c=${g.id}`);
    await a.page.goto(`/chats?c=${g.id}`);
    await a.page.getByRole('button', { name: 'Group info' }).click();
    await expect(info(a.page).getByTestId('member-row')).toHaveCount(3);
    await expect(info(a.page).getByTestId('member-row').first()).toContainText('You');
    await expect(info(a.page).getByTestId('member-row').first()).toContainText('Creator');

    await info(a.page).getByRole('button', { name: 'Edit' }).click();
    await info(a.page).getByLabel('Group name').fill('Ahmed family');
    await info(a.page).getByLabel('Description').fill('Sunday lunches');
    await info(a.page).getByRole('button', { name: 'Save' }).click();
    await expect(info(a.page).getByRole('heading', { name: 'Ahmed family' })).toBeVisible();
    await expect(s.page.getByRole('region', { name: 'Chat with Ahmed family' })).toBeVisible();
    await expect(sys(s.page)).toContainText(['Ali changed the group name to “Ahmed family”', 'Ali changed the group description']);

    // Members can't edit by default: no Edit button for Sara.
    await s.page.getByRole('button', { name: 'Group info' }).click();
    await expect(info(s.page).getByRole('heading', { name: 'Ahmed family' })).toBeVisible();
    await expect(info(s.page).getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(info(s.page).getByRole('button', { name: /Options for/ })).toHaveCount(0);

    await info(a.page).getByRole('button', { name: 'Options for Sara' }).click();
    await a.page.getByRole('menuitem', { name: 'Make group admin' }).click();
    await expect(info(a.page).getByTestId('member-row').filter({ hasText: 'Sara' })).toContainText('Admin');
    await expect(sys(s.page).last()).toHaveText('Ali made you an admin');
    await expect(info(s.page).getByRole('button', { name: 'Edit' })).toBeVisible(); // Sara can now edit

    await info(a.page).getByRole('button', { name: 'Options for Omar' }).click();
    await a.page.getByRole('menuitem', { name: 'Remove from group' }).click();
    await expect(info(a.page).getByTestId('member-row')).toHaveCount(2);
    await expect(sys(o.page).last()).toHaveText('Ali removed you');
    await expect(o.page.getByRole('status').filter({ hasText: 'You’re no longer in this group.' })).toBeVisible();
    await expect(o.page.getByLabel('Message', { exact: true })).toHaveCount(0);
    await send(a.page, 'Omar can’t see this');
    await expect(s.page.locator('.msg--them .msg__text').last()).toHaveText('Omar can’t see this');
    await o.page.reload();
    await expect(o.page.getByText('Omar can’t see this')).toHaveCount(0);
    await o.page.getByRole('button', { name: 'Delete group' }).click();
    await expect(row(o.page, 'Ahmed family')).toHaveCount(0);
    await a.ctx.close(); await s.ctx.close(); await o.ctx.close();
  });

  test('admins-only messaging locks the composer for members, live', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const g = await apiCall('/v1/groups', { name: 'News', memberIds: [sara.id] }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto(`/chats?c=${g.id}`);
    await expect(s.page.getByLabel('Message', { exact: true })).toBeVisible();
    await a.page.goto(`/chats?c=${g.id}`);
    await a.page.getByRole('button', { name: 'Group info' }).click();
    const sendSwitch = info(a.page).getByRole('switch', { name: /Send messages/ });
    await expect(sendSwitch).toHaveAttribute('aria-checked', 'true');
    await sendSwitch.click();
    await expect(sendSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(s.page.getByRole('status').filter({ hasText: 'Only admins can send messages.' })).toBeVisible();
    await expect(sys(s.page).last()).toHaveText('Ali changed the group settings: only admins can send messages');
    await send(a.page, 'Admins only from now');
    await expect(s.page.locator('.msg--them .msg__text').last()).toHaveText('Admins only from now');
    await a.ctx.close(); await s.ctx.close();
  });

  test('invite links: join straight in, or ask and get approved', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), zara = await apiUser('Zara'), nida = await apiUser('Nida');
    const g = await apiCall('/v1/groups', { name: 'Book club', memberIds: [sara.id], about: 'One book a month' }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto(`/chats?c=${g.id}`);
    await a.page.getByRole('button', { name: 'Group info' }).click();
    await info(a.page).getByRole('button', { name: 'Create invite link' }).click();
    const link = (await info(a.page).getByTestId('invite-link').textContent())!;
    expect(link).toMatch(/\/join\/[A-Za-z0-9]{16}$/);
    const path = new URL(link).pathname;

    const z = await pageAs(browser, zara);
    await z.page.goto(path);
    await expect(z.page.getByRole('heading', { name: 'Book club' })).toBeVisible();
    await expect(z.page.getByText('One book a month')).toBeVisible();
    await expect(z.page.getByText('Group · 2 members')).toBeVisible();
    await z.page.getByRole('button', { name: 'Join group' }).click();
    await expect(z.page.getByRole('region', { name: 'Chat with Book club' })).toBeVisible();
    await expect(sys(z.page)).toHaveText(['You joined using an invite link']);
    await expect(sys(a.page).last()).toHaveText('Zara joined using an invite link');

    // Approval on, and the old link reset.
    await info(a.page).getByRole('switch', { name: /Approve new members/ }).click();
    await expect(info(a.page).getByRole('switch', { name: /Approve new members/ })).toHaveAttribute('aria-checked', 'true');
    await info(a.page).getByRole('button', { name: 'Reset link' }).click();
    await expect(info(a.page).getByTestId('invite-link')).not.toHaveText(link);
    const n = await pageAs(browser, nida);
    await n.page.goto(path);
    await expect(alert(n.page)).toHaveText('This invite link was reset or doesn’t exist. Ask for a new one.');
    const fresh = new URL((await info(a.page).getByTestId('invite-link').textContent())!).pathname;
    await n.page.goto(fresh);
    await expect(n.page.getByText('An admin approves new members.')).toBeVisible();
    await n.page.getByRole('button', { name: 'Request to join' }).click();
    await expect(n.page.getByText('Your request was sent. An admin will let you in.')).toBeVisible();

    await expect(info(a.page).getByRole('region', { name: 'Requests to join' })).toContainText('Requests to join (1)');
    await info(a.page).getByTestId('request-row').filter({ hasText: 'Nida' }).getByRole('button', { name: 'Approve' }).click();
    await expect(info(a.page).getByTestId('member-row')).toHaveCount(4);
    await n.page.reload();
    await n.page.getByRole('button', { name: 'Open chat' }).click();
    await expect(sys(n.page)).toHaveText(['You joined']);
    for (const p of [a, z, n]) await p.ctx.close();
  });

  test('leaving a group: the last admin leaves and someone else takes over', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const g = await apiCall('/v1/groups', { name: 'Trip', memberIds: [sara.id] }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto(`/chats?c=${g.id}`);
    await a.page.goto(`/chats?c=${g.id}`);
    await a.page.getByRole('button', { name: 'Group info' }).click();
    await info(a.page).getByRole('button', { name: 'Exit group' }).click();
    await info(a.page).getByRole('button', { name: 'Exit', exact: true }).click();
    await expect(a.page.locator('.composer--locked')).toContainText('You’re no longer in this group.');
    await expect(sys(s.page)).toContainText(['Ali left', 'You are now an admin']);
    await s.page.getByRole('button', { name: 'Group info' }).click();
    await expect(info(s.page).getByRole('button', { name: 'Edit' })).toBeVisible();
    await a.ctx.close(); await s.ctx.close();
  });
});
