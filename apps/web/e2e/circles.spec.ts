import { ObjectId } from 'mongodb';
import { expect, test } from './test';
import { apiCall, apiUser, db, pageAs, png, type ApiUser } from './helpers';

const DAY = 86400_000, HOUR = 3600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const as = (u: ApiUser) => u.tokens.accessToken;
async function circle(owner: ApiUser, body: object, official = false) {
  const c = await apiCall('/v1/circles', body, as(owner));
  if (official) await db((d) => d.collection('yc_communities').updateOne({ _id: new ObjectId(c.id) }, { $set: { official: true } }));
  return c as { id: string; name: string };
}

test.describe('Yays Circle', () => {
  test('discover a circle, join it, post with a photo, like, comment, and an owner marks the answer', async ({ browser }) => {
    const bilal = await apiUser('Bilal'), sara = await apiUser('Sara');
    const name = `Bitcoin YAY Circle ${Date.now() % 100000}`;
    const c = await circle(bilal, { name, about: 'Updates and support from the BTCY team', category: 'crypto', rules: ['Be kind', 'No investment promotion or asking for money'] }, true);
    const s = await pageAs(browser, sara);
    await s.page.goto('/circles/discover');
    await s.page.getByLabel('Search circles').fill(name);
    const tile = s.page.getByTestId('circle-tile').filter({ hasText: name });
    await expect(tile).toContainText('Official');
    await tile.getByRole('button', { name: 'Join' }).click();
    const view = s.page.getByRole('region', { name });
    await expect(view.getByRole('heading', { name })).toBeVisible();
    await expect(s.page.getByTestId('circle-row').filter({ hasText: name })).toBeVisible();

    // A post with a photo.
    await view.getByLabel('Write a post').fill('Is mining paused when my phone is off?');
    await view.locator('input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png(40, 30) });
    await view.getByRole('button', { name: 'Post', exact: true }).click();
    const post = view.getByTestId('post').filter({ hasText: 'Is mining paused' });
    await expect(post.locator('.cphotos img')).toHaveCount(1);

    // Bilal answers in the comments and marks it; the feed shows the answer.
    const b = await pageAs(browser, bilal);
    await b.page.goto(`/circles?id=${c.id}`);
    await b.page.getByTestId('post').filter({ hasText: 'Is mining paused' }).locator('.cact').first().click();
    await expect(b.page.getByTestId('post').filter({ hasText: 'Is mining paused' }).locator('.cact--on')).toHaveText('1');
    await b.page.getByTestId('post').filter({ hasText: 'Is mining paused' }).getByRole('link', { name: /comments/ }).click();
    await b.page.getByLabel('Write a comment…').fill('No, it keeps running for 24 hours.');
    await b.page.getByRole('button', { name: 'Send', exact: true }).click();
    const comment = b.page.getByTestId('comment').filter({ hasText: 'keeps running' });
    await expect(comment).toContainText('Official');
    await comment.getByRole('button', { name: 'Mark as answer' }).click();
    await expect(comment).toContainText('Answer');
    await s.page.reload();
    await expect(s.page.getByTestId('post').filter({ hasText: 'Is mining paused' })).toContainText('Answered by Bilal: No, it keeps running for 24 hours.');
    await expect(s.page.getByTestId('post').filter({ hasText: 'Is mining paused' }).locator('.cact').first()).toHaveText('1');
    await s.ctx.close(); await b.ctx.close();
  });

  test('a money-scheme post is caught; sent anyway it waits for the owners, who see it under Review', async ({ browser }) => {
    const bilal = await apiUser('Bilal'), king = await apiUser('King');
    const c = await circle(bilal, { name: 'Crypto Beginners', rules: ['Be kind', 'No investment promotion or asking for money'] });
    await apiCall(`/v1/circles/${c.id}/join`, {}, as(king));
    const k = await pageAs(browser, king);
    await k.page.goto(`/circles?id=${c.id}`);
    await k.page.getByLabel('Write a post').fill('Guaranteed 10% daily profit on BTCY! DM me to invest.');
    await k.page.getByRole('button', { name: 'Post', exact: true }).click();
    const dlg = k.page.getByRole('dialog', { name: 'This looks like an investment offer' });
    await expect(dlg.locator('mark')).toHaveText(['Guaranteed 10% daily profit', 'DM me to invest']);
    await dlg.getByRole('button', { name: 'Send to owners' }).click();
    const held = k.page.getByTestId('post').filter({ hasText: 'Guaranteed' });
    await expect(held).toContainText('Waiting for approval');

    const b = await pageAs(browser, bilal);
    await b.page.goto(`/circles?id=${c.id}`);
    await expect(b.page.getByTestId('post').filter({ hasText: 'Guaranteed' })).toHaveCount(0);
    await b.page.getByRole('tab', { name: 'Review · 1' }).click();
    await b.page.locator('.creview').filter({ hasText: 'Guaranteed' }).getByRole('button', { name: 'Remove' }).click();
    await expect(b.page.getByText('Nothing to review')).toBeVisible();
    await k.page.reload();
    await expect(k.page.getByTestId('post').filter({ hasText: 'Guaranteed' })).toContainText('Post removed by the owners. Rule 2: No investment promotion or asking for money');
    await k.ctx.close(); await b.ctx.close();
  });

  test('reporting hides the post, with an option to block; the post you blocked shows a placeholder', async ({ browser }) => {
    const bilal = await apiUser('Bilal'), sara = await apiUser('Sara'), king = await apiUser('King');
    const c = await circle(bilal, { name: 'Lahore Runners' });
    for (const u of [sara, king]) await apiCall(`/v1/circles/${c.id}/join`, {}, as(u));
    await apiCall(`/v1/circles/${c.id}/posts`, { text: 'Check out my channel, link in bio!!!' }, as(king));
    const s = await pageAs(browser, sara);
    await s.page.goto(`/circles?id=${c.id}`);
    const post = s.page.getByTestId('post').filter({ hasText: 'link in bio' });
    await post.getByRole('button', { name: 'Post options' }).click();
    await s.page.getByRole('menuitem', { name: 'Report' }).click();
    const dlg = s.page.getByRole('dialog', { name: 'Report this post' });
    await dlg.getByRole('radio', { name: /Spam/ }).check();
    await dlg.getByLabel('Also block King').check();
    await dlg.getByRole('button', { name: 'Send report' }).click();
    const thanks = s.page.getByRole('dialog', { name: 'Thanks, we got your report' });
    await expect(thanks).toContainText('You blocked King.');
    await thanks.getByRole('button', { name: 'Done' }).click();
    await expect(s.page.getByTestId('post-placeholder')).toContainText('Post from someone you blocked');
    await s.ctx.close();
  });

  test('a private circle shows only About until the owners say yes', async ({ browser }) => {
    const lena = await apiUser('Lena'), hana = await apiUser('Hana');
    const c = await circle(lena, { name: 'ReHuman Wellness Club', visibility: 'private', joinQuestion: 'Why do you want to join?', rules: ['Be kind'] });
    const h = await pageAs(browser, hana);
    await h.page.goto(`/circles?id=${c.id}`);
    await expect(h.page.getByTestId('private-gate')).toContainText('This circle is private');
    await expect(h.page.getByRole('tab', { name: 'Feed' })).toHaveCount(0);
    const ask = h.page.getByRole('button', { name: 'Ask to join' });
    await expect(ask).toBeDisabled();
    await h.page.getByLabel('The owners ask: Why do you want to join?').fill('I want to fix my sleep.');
    await ask.click();
    await expect(h.page.getByTestId('request-sent')).toContainText('Request sent');
    await apiCall(`/v1/communities/${c.id}/requests/${hana.id}/approve`, {}, as(lena));
    await h.page.reload();
    await expect(h.page.getByRole('tab', { name: 'Feed' })).toBeVisible();
    await h.ctx.close();
  });

  test('muted, removed, and a link to a circle that is gone', async ({ browser }) => {
    const bilal = await apiUser('Bilal'), king = await apiUser('King');
    const c = await circle(bilal, { name: 'Bitcoin Talk', rules: ['Be kind to other members'] });
    await apiCall(`/v1/circles/${c.id}/join`, {}, as(king));
    await apiCall(`/v1/circles/${c.id}/mutes/${king.id}`, { days: 4, reason: 'Repeated off-topic posts' }, as(bilal), 'PUT');
    const k = await pageAs(browser, king);
    await k.page.goto(`/circles?id=${c.id}`);
    await expect(k.page.getByTestId('muted')).toContainText('You can’t post or comment until');
    await expect(k.page.getByTestId('composer')).toHaveCount(0);
    await apiCall(`/v1/circles/${c.id}/members/${king.id}/remove`, { reason: 'Rule 1: Be kind to other members' }, as(bilal));
    await k.page.reload();
    await expect(k.page.getByTestId('removed')).toContainText('You were removed from this circle');
    await expect(k.page.getByTestId('removed')).toContainText('rule 1: Be kind to other members');
    await k.page.goto('/circles?id=0123456789abcdef01234567');
    await expect(k.page.getByText('This circle isn’t available')).toBeVisible();
    await k.ctx.close();
  });

  test('events: a full event puts you on the waitlist; changes ask “still going?”; cancelled and ended events', async ({ browser }) => {
    const omar = await apiUser('Omar'), hana = await apiUser('Hana'), sara = await apiUser('Sara');
    const c = await circle(omar, { name: 'Karachi Founders' });
    for (const u of [hana, sara]) await apiCall(`/v1/circles/${c.id}/join`, {}, as(u));
    const e = await apiCall(`/v1/circles/${c.id}/events`, { title: 'Founders Breakfast', startsAt: at(5 * DAY), endsAt: at(5 * DAY + 2 * HOUR), timeZone: 'Asia/Karachi', mode: 'both', place: 'The Second Cup, Clifton', onlineUrl: 'https://meet.example.com/fb', seats: 2 }, as(omar));
    await apiCall(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' }, as(hana), 'PUT');
    const s = await pageAs(browser, sara);
    await s.page.goto(`/circles?id=${c.id}&tab=events`);
    await s.page.getByTestId('event-row').filter({ hasText: 'Founders Breakfast' }).click();
    await expect(s.page.getByRole('heading', { name: 'Founders Breakfast' })).toBeVisible();
    await expect(s.page.getByText('The link shows here once you tap Going')).toBeVisible();
    await s.page.getByRole('button', { name: 'Join waitlist' }).click();
    await expect(s.page.getByTestId('waitlist')).toContainText('You’re 1st on the waitlist');
    // Hana can't go: Sara is offered the seat and confirms it; the online link appears.
    await apiCall(`/v1/circle-events/${e.id}/rsvp`, { status: 'not_going' }, as(hana), 'PUT');
    await s.page.reload();
    await s.page.getByTestId('seat-offer').getByRole('button', { name: 'Confirm seat' }).click();
    await expect(s.page.getByTestId('online-link')).toHaveAttribute('href', 'https://meet.example.com/fb');
    // The host moves it: Sara is asked again.
    await apiCall(`/v1/circle-events/${e.id}`, { place: 'The Second Cup, DHA' }, as(omar), 'PATCH');
    await s.page.reload();
    await expect(s.page.getByTestId('event-changed')).toContainText('was The Second Cup, Clifton');
    await s.page.getByRole('button', { name: 'Yes, still going' }).click();
    await expect(s.page.getByRole('button', { name: 'Yes, still going' })).toHaveCount(0);
    // Cancelled.
    await apiCall(`/v1/circle-events/${e.id}/cancel`, { note: 'The café is closed that day.' }, as(omar));
    await s.page.reload();
    await expect(s.page.getByText('Message from Omar')).toBeVisible();
    await expect(s.page.getByText('The café is closed that day.')).toBeVisible();
    // An event that ended: recording and a rating.
    const past = await apiCall(`/v1/circles/${c.id}/events`, { title: 'Pitch night', startsAt: at(DAY), endsAt: at(DAY + HOUR), timeZone: 'Asia/Karachi', mode: 'in_person', place: 'Clifton' }, as(omar));
    await apiCall(`/v1/circle-events/${past.id}/rsvp`, { status: 'going' }, as(sara), 'PUT');
    await db((d) => d.collection('yc_circle_events').updateOne({ _id: new ObjectId(past.id) }, { $set: { startsAt: new Date(Date.now() - 3 * HOUR), endsAt: new Date(Date.now() - HOUR), recordingUrl: 'https://video.example.com/p' } }));
    await s.page.goto(`/circles/event?id=${past.id}`);
    await expect(s.page.getByRole('link', { name: /Recording/ })).toBeVisible();
    await s.page.getByRole('radio', { name: '4 stars' }).click();
    await expect(s.page.getByText('4 from 1 person')).toBeVisible();
    await s.ctx.close();
  });

  test('the only owner picks a new owner before leaving', async ({ browser }) => {
    const omar = await apiUser('Omar'), hana = await apiUser('Hana');
    const c = await circle(omar, { name: 'Karachi Startups' });
    await apiCall(`/v1/circles/${c.id}/join`, {}, as(hana));
    const o = await pageAs(browser, omar);
    await o.page.goto(`/circles?id=${c.id}&tab=about`);
    await o.page.getByRole('button', { name: 'Leave circle' }).click();
    const dlg = o.page.getByRole('dialog', { name: 'Pick a new owner first' });
    await expect(dlg.getByRole('radio')).toBeChecked();
    await dlg.getByRole('button', { name: 'Make owner and leave' }).click();
    await expect(o.page.getByTestId('no-circles')).toBeVisible();
    const v = await apiCall(`/v1/circles/${c.id}`, undefined, as(hana));
    expect(v).toMatchObject({ isOwner: true });
    await o.ctx.close();
  });

  test('a post that didn’t go because the connection dropped can be tried again', async ({ browser }) => {
    const bilal = await apiUser('Bilal');
    const c = await circle(bilal, { name: 'Offline Club' });
    const b = await pageAs(browser, bilal);
    await b.page.goto(`/circles?id=${c.id}`);
    await expect(b.page.getByText('Your circle is ready')).toBeVisible();
    await b.ctx.setOffline(true);
    await b.page.getByLabel('Write a post').fill('Posting from the train');
    await b.page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(b.page.getByTestId('failed-post')).toContainText('Didn’t post');
    await expect(b.page.getByRole('status')).toContainText('You’re offline');
    await b.ctx.setOffline(false);
    await b.page.getByTestId('failed-post').getByRole('button', { name: 'Try again' }).click();
    await expect(b.page.getByTestId('post').filter({ hasText: 'Posting from the train' })).toBeVisible();
    await expect(b.page.getByTestId('failed-post')).toHaveCount(0);
    await b.ctx.close();
  });
});
