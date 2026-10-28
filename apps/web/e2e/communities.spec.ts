import { expect, test, type Page } from '@playwright/test';
import { apiCall, apiUser, pageAs, type ApiUser } from './helpers';

const say = (u: ApiUser, c: string, text: string) => apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text }, u.tokens.accessToken);
async function menu(p: Page, text: string, item: string) {
  const m = p.getByTestId('message').filter({ has: p.locator('.msg__text', { hasText: text }) }).last();
  await m.hover();
  await m.getByRole('button', { name: 'More actions' }).click();
  await p.getByRole('menuitem', { name: item }).click();
}

test.describe('Communities on the web', () => {
  test('create one, invite by link, join a group, and post announcements only admins can write', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const mine = await apiCall('/v1/groups', { name: 'Runners chat', memberIds: [sara.id] }, ali.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto('/chats');
    await a.page.getByRole('link', { name: 'Communities' }).click();
    await a.page.getByRole('button', { name: 'New', exact: true }).click();
    const dlg = a.page.getByRole('dialog', { name: 'Create a community' });
    await dlg.getByLabel('Community name').fill('Lahore Runners');
    await dlg.getByLabel('Description').fill('Weekend runs around Lahore.');
    await dlg.getByRole('button', { name: 'Next: add groups' }).click();
    await expect(dlg.getByLabel('New group 1', { exact: true })).toHaveValue('General');
    await dlg.getByRole('checkbox', { name: 'Runners chat' }).check();
    await dlg.getByRole('button', { name: 'Create community' }).click();
    const view = a.page.getByRole('region', { name: 'Lahore Runners' });
    await expect(view.getByRole('heading', { name: 'Lahore Runners' })).toBeVisible();
    await expect(view.getByTestId('announcements')).toBeVisible();
    await expect(view.getByTestId('community-group')).toHaveCount(2);
    await expect(a.page.getByTestId('community-row')).toHaveText(/Lahore Runners/);
    await view.getByRole('button', { name: 'Invite' }).click();
    await expect(a.page.getByLabel('Invite link')).toHaveValue(/\/c\/[A-Za-z0-9]{10,}$/);
    const link = await a.page.getByLabel('Invite link').inputValue();
    expect(link).toMatch(/\/c\/[A-Za-z0-9]{10,}$/);
    await a.page.keyboard.press('Escape');

    // Sara joins by link and joins General from the community page.
    const s = await pageAs(browser, sara);
    await s.page.goto(new URL(link).pathname);
    await expect(s.page.getByRole('heading', { name: 'Lahore Runners' })).toBeVisible();
    await s.page.getByRole('button', { name: 'Join community' }).click();
    const sv = s.page.getByRole('region', { name: 'Lahore Runners' });
    await expect(sv.getByTestId('community-group')).toHaveText(/Runners chat/); // she was already in it
    const general = sv.getByTestId('community-other').filter({ hasText: 'General' });
    await general.getByRole('button', { name: 'Join' }).click();
    await expect(s.page.getByRole('region', { name: 'Chat with General' })).toBeVisible();
    await expect(s.page.getByTestId('system-line').last()).toHaveText('You joined from the community');

    // Announcements: Ali posts, Sara reads but can't write.
    await view.getByTestId('announcements').click();
    await expect(a.page.getByRole('region', { name: 'Chat with Announcements' })).toBeVisible();
    await a.page.getByLabel('Message', { exact: true }).fill('Race on Sunday, 6 am');
    await a.page.getByLabel('Message', { exact: true }).press('Enter');
    await s.page.goto('/communities');
    await s.page.getByTestId('community-row').click();
    await expect(s.page.getByTestId('announcements')).toContainText('Race on Sunday, 6 am');
    await s.page.getByTestId('announcements').click();
    await expect(s.page.locator('.composer--locked')).toHaveText(/Only admins can send messages/);
    // Group info shows which community it's part of.
    await s.page.getByRole('button', { name: 'Group info' }).click();
    await expect(s.page.getByRole('link', { name: 'Part of Lahore Runners' })).toBeVisible();
    await expect(s.page.getByRole('button', { name: 'Leave group' })).toHaveCount(0);
    expect(mine.id).toBeTruthy();
    await a.ctx.close(); await s.ctx.close();
  });

  test('admins approve requests, and act on a reported message', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar');
    const c = await apiCall('/v1/communities', { name: 'BTCY Traders', newGroups: ['General'], approveNew: true }, ali.tokens.accessToken);
    const { inviteCode } = await apiCall(`/v1/communities/${c.id}/invite`, {}, ali.tokens.accessToken);
    for (const u of [sara, omar]) await apiCall(`/v1/community-invites/${inviteCode}/join`, {}, u.tokens.accessToken);
    const a = await pageAs(browser, ali);
    await a.page.goto(`/communities?id=${c.id}`);
    await expect(a.page.getByText('2 people asked to join.')).toBeVisible();
    await a.page.getByRole('button', { name: 'Manage' }).click();
    const manage = a.page.getByRole('region', { name: 'Manage BTCY Traders' });
    await expect(manage.getByTestId('request-row')).toHaveCount(2);
    await manage.getByRole('button', { name: 'Approve Sara' }).click();
    await expect(manage.getByTestId('request-row')).toHaveCount(1);
    await manage.getByRole('button', { name: 'Approve Omar' }).click();
    await expect(manage.getByTestId('request-row')).toHaveCount(0);
    await manage.getByRole('tab', { name: 'Members' }).click();
    await expect(manage.getByTestId('community-member')).toHaveCount(3);

    // In General, Sara reports Omar's scam message.
    const general = c.groups.find((g: { name: string }) => g.name === 'General').id;
    for (const u of [sara, omar]) await apiCall(`/v1/communities/${c.id}/groups/${general}/join`, {}, u.tokens.accessToken);
    await say(omar, general, 'DM me to double your BTCY');
    const s = await pageAs(browser, sara);
    await s.page.goto(`/chats?c=${general}`);
    await menu(s.page, 'DM me to double', 'Report');
    const rep = s.page.getByRole('dialog', { name: 'Report this message?' });
    await rep.getByRole('radio', { name: 'Scam or fraud' }).click();
    await rep.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(s.page.getByText('The community’s admins will look at it.')).toBeVisible();

    await manage.getByRole('tab', { name: 'Reports' }).click();
    const card = manage.getByTestId('report-card');
    await expect(card).toContainText('DM me to double your BTCY');
    await expect(card).toContainText('General · reported by 1 person');
    await card.getByRole('button', { name: 'Delete for all' }).click();
    await expect(manage.getByTestId('report-card')).toHaveCount(0);
    await expect(s.page.locator('.msg--them').filter({ hasText: 'This message was deleted' })).toBeVisible();
    await a.ctx.close(); await s.ctx.close();
  });

  test('exiting a community leaves its groups', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/communities', { name: 'Design Guild', newGroups: ['Critique'] }, ali.tokens.accessToken);
    const { inviteCode } = await apiCall(`/v1/communities/${c.id}/invite`, {}, ali.tokens.accessToken);
    await apiCall(`/v1/community-invites/${inviteCode}/join`, {}, sara.tokens.accessToken);
    const crit = c.groups.find((g: { name: string }) => g.name === 'Critique').id;
    await apiCall(`/v1/communities/${c.id}/groups/${crit}/join`, {}, sara.tokens.accessToken);
    const s = await pageAs(browser, sara);
    await s.page.goto(`/communities?id=${c.id}`);
    await s.page.getByRole('button', { name: 'Exit community' }).click();
    await s.page.getByRole('button', { name: 'Exit', exact: true }).click();
    await expect(s.page.getByTestId('community-row')).toHaveCount(0);
    await s.page.goto(`/chats?c=${crit}`);
    await expect(s.page.locator('.composer--locked')).toHaveText(/no longer in this group/);
    await s.ctx.close();
  });
});
