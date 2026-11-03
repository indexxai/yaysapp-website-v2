import { ObjectId } from 'mongodb';
import { expect, test } from './test';
import { apiCall, apiUser, db, pageAs, type ApiUser } from './helpers';

/* Owner tools and the remaining edge-case screens of Yays Circle, through the UI. */
const as = (u: ApiUser) => u.tokens.accessToken;

test.describe('Yays Circle: owner tools and more edge cases', () => {
  test('owner: create an event in the form, edit settings, pin, mute and unmute, remove, keep a report', async ({ browser }) => {
    const owner = await apiUser('Bilal'), sara = await apiUser('Sara'), king = await apiUser('King');
    const c = await apiCall('/v1/circles', { name: 'Owner Tools Circle', rules: ['Be kind', 'No selling'] }, as(owner));
    for (const u of [sara, king]) await apiCall(`/v1/circles/${c.id}/join`, {}, as(u));
    const p = await apiCall(`/v1/circles/${c.id}/posts`, { text: 'Welcome everyone' }, as(owner));
    const sp = await apiCall(`/v1/circles/${c.id}/posts`, { text: 'Is anyone running Sunday?' }, as(sara));
    await apiCall(`/v1/circle-posts/${sp.id}/report`, { reason: 'other' }, as(king));
    const o = await pageAs(browser, owner);

    // A new event from the Events tab.
    await o.page.goto(`/circles?id=${c.id}&tab=events`);
    await o.page.getByRole('button', { name: 'New event' }).click();
    const form = o.page.getByRole('dialog', { name: 'New event' });
    await form.getByLabel('Event name').fill('Sunday Long Run');
    await form.getByLabel('Starts').fill('07:00');
    await form.getByLabel('Ends').fill('09:00');
    await form.getByLabel('Place').fill('Race Course Park, Lahore');
    await form.getByRole('switch', { name: /Limit seats/ }).click();
    await form.getByLabel('Seats').fill('25');
    await form.getByRole('button', { name: 'Create event' }).click();
    await expect(o.page.getByRole('heading', { name: 'Sunday Long Run' })).toBeVisible();
    await expect(o.page.getByText('24 of 25 seats left')).toBeVisible();
    await expect(o.page.getByText(/7:00\s?am–9:00\s?am/)).toBeVisible();

    // Pin a post from its menu.
    await o.page.goto(`/circles?id=${c.id}`);
    const welcome = o.page.getByTestId('post').filter({ hasText: 'Welcome everyone' });
    await welcome.getByRole('button', { name: 'Post options' }).click();
    await o.page.getByRole('menuitem', { name: 'Pin to top' }).click();
    await expect(o.page.getByTestId('post').first()).toContainText('Pinned');
    expect(p.id).toBeTruthy();

    // Settings: make it private with a question.
    await o.page.getByRole('tab', { name: 'About' }).click();
    await o.page.getByRole('button', { name: 'Edit' }).click();
    await o.page.getByRole('radio', { name: /Private/ }).click();
    await o.page.getByLabel('Question for people asking to join (optional)').fill('Do you run weekly?');
    await o.page.getByRole('button', { name: 'Save' }).click();
    await expect(o.page.getByText('People asking to join answer: “Do you run weekly?”')).toBeVisible();

    // Members: mute King for 3 days, unmute, then remove him with a reason.
    await o.page.getByRole('tab', { name: 'Members' }).click();
    const kingRow = o.page.getByTestId('member-row').filter({ hasText: 'King' });
    await kingRow.getByRole('button', { name: 'Mute' }).click();
    await o.page.getByRole('dialog', { name: 'Mute King' }).getByLabel('For').selectOption('3');
    await o.page.getByRole('dialog', { name: 'Mute King' }).getByRole('button', { name: 'Mute' }).click();
    await expect(kingRow).toContainText('Muted until');
    await kingRow.getByRole('button', { name: 'Unmute' }).click();
    await expect(kingRow).not.toContainText('Muted until');
    // Review: keep the report about Sara's harmless post.
    await o.page.getByRole('tab', { name: /^Review/ }).click();
    await o.page.locator('.creview').filter({ hasText: 'Is anyone running Sunday?' }).getByRole('button', { name: 'Keep' }).click();
    await expect(o.page.getByText('Nothing to review')).toBeVisible();
    await o.page.getByRole('tab', { name: 'Members' }).click();
    await o.page.getByTestId('member-row').filter({ hasText: 'King' }).getByRole('button', { name: 'Remove' }).click();
    const rm = o.page.getByRole('dialog', { name: 'Remove King' });
    await expect(rm.getByLabel('Reason they see')).toHaveValue('Rule 1: Be kind');
    await rm.getByRole('button', { name: 'Remove' }).click();
    await expect(o.page.getByTestId('member-row').filter({ hasText: 'King' })).toHaveCount(0);
    await o.ctx.close();
  });

  test('member: edit and delete my post, reply to a comment, and see my own removed post', async ({ browser }) => {
    const owner = await apiUser('Bilal'), sara = await apiUser('Sara');
    const c = await apiCall('/v1/circles', { name: 'Member Circle', rules: ['Be kind', 'No investment promotion or asking for money'] }, as(owner));
    await apiCall(`/v1/circles/${c.id}/join`, {}, as(sara));
    const q = await apiCall(`/v1/circles/${c.id}/posts`, { text: 'Typo in my questoin' }, as(sara));
    await apiCall(`/v1/circle-posts/${q.id}/comments`, { text: 'What do you mean?' }, as(owner));
    const s = await pageAs(browser, sara);
    await s.page.goto(`/circles?id=${c.id}`);
    const mine = s.page.getByTestId('post').filter({ hasText: 'Typo' });
    await mine.getByRole('button', { name: 'Post options' }).click();
    await s.page.getByRole('menuitem', { name: 'Edit' }).click();
    const ed = s.page.getByRole('dialog', { name: 'Edit post' });
    await ed.getByLabel('Post').fill('Guaranteed profit if you DM me to invest');
    await expect(ed.getByRole('button', { name: 'Save' })).toBeDisabled(); // money scheme wording blocks saving
    await ed.getByLabel('Post').fill('Fixed my question');
    await ed.getByRole('button', { name: 'Save' }).click();
    await expect(s.page.getByTestId('post').filter({ hasText: 'Fixed my question' })).toContainText('edited');

    // Reply to the owner's comment.
    await s.page.getByTestId('post').filter({ hasText: 'Fixed my question' }).getByRole('link', { name: /comments/ }).click();
    await s.page.getByTestId('comment').filter({ hasText: 'What do you mean?' }).getByRole('button', { name: 'Reply' }).click();
    await expect(s.page.getByText('Replying to Bilal')).toBeVisible();
    await s.page.getByLabel('Write a comment…').fill('The word question was misspelt');
    await s.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(s.page.locator('.ccomment--reply')).toContainText('The word question was misspelt');

    // A post of mine the owners removed stays visible to me, with the reason.
    const other = await apiCall(`/v1/circles/${c.id}/posts`, { text: 'Selling my old bike, cheap' }, as(sara));
    await apiCall(`/v1/circle-posts/${other.id}/remove`, { reason: 'Rule 2: No investment promotion or asking for money' }, as(owner));
    await s.page.goto(`/circles?id=${c.id}`);
    await expect(s.page.getByTestId('post').filter({ hasText: 'Selling my old bike' })).toContainText('Only you can see it.');

    // Delete my own post.
    const fixed = s.page.getByTestId('post').filter({ hasText: 'Fixed my question' });
    await fixed.getByRole('button', { name: 'Post options' }).click();
    await s.page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(s.page.getByTestId('post').filter({ hasText: 'Fixed my question' })).toHaveCount(0);
    await s.ctx.close();
  });

  test('Discover: no results with “did you mean”, the not-official warning, and a request the owners turned down', async ({ browser }) => {
    const owner = await apiUser('Bilal'), king = await apiUser('King'), sara = await apiUser('Sara');
    const tag = Date.now() % 100000;
    const real = await apiCall('/v1/circles', { name: `Zephyrcoin Circle ${tag}`, about: 'Official Zephyrcoin updates' }, as(owner));
    await db((d) => d.collection('yc_communities').updateOne({ _id: new ObjectId(real.id) }, { $set: { official: true } }));
    await apiCall('/v1/circles', { name: `Zephyrcoin Circle ${tag} Signals` }, as(king));
    const priv = await apiCall('/v1/circles', { name: `Closed Club ${tag}`, visibility: 'private' }, as(owner));
    await apiCall(`/v1/circles/${priv.id}/join`, {}, as(sara));
    await apiCall(`/v1/communities/${priv.id}/requests/${sara.id}`, undefined, as(owner), 'DELETE');

    const s = await pageAs(browser, sara);
    await s.page.goto('/circles/discover');
    await s.page.getByLabel('Search circles').fill('zephyrcion');
    await expect(s.page.getByTestId('no-results')).toContainText('No circles found');
    await s.page.getByRole('button', { name: 'zephyrcoin' }).click();
    await expect(s.page.getByLabel('Search circles')).toHaveValue('zephyrcoin');
    const fake = s.page.getByTestId('circle-tile').filter({ hasText: 'Signals' });
    await expect(fake).toContainText('Not official');
    await expect(fake).toContainText('isn’t run by the team it names');
    await expect(s.page.getByTestId('circle-tile').filter({ hasText: `Zephyrcoin Circle ${tag}` }).first()).toContainText('Official');

    await s.page.goto(`/circles?id=${priv.id}`);
    await expect(s.page.getByTestId('request-declined')).toContainText('Request not accepted');
    await s.ctx.close();
  });
});
