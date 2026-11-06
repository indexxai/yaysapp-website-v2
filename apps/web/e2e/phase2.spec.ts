// Phase 2 in the browser: website, pop-ups, Explore, Earn, Wallet, BTCY, Jack's AI, chat catch-up, support, socials.
// Screenshots of each screen go to test-results/phase2 (or PHASE2_OUT).
import { mkdirSync } from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import { expect, test, type Page } from './test';
import { apiCall, apiUser, db, pageAs, type ApiUser } from './helpers';

const OUT = process.env.PHASE2_OUT ?? path.join(__dirname, '../test-results/phase2');
const VP = { width: 1440, height: 900 };
const shot = async (p: Page, name: string) => { await p.waitForTimeout(450); await p.screenshot({ path: path.join(OUT, `${name}.png`) }); };
const link = (u: ApiUser, email: string) => apiCall('/v1/indexx/link', { email }, u.tokens.accessToken);
const give = (u: ApiUser, points: number) => db((d) => d.collection('yc_points').updateOne({ _id: new ObjectId(u.id) as never }, { $set: { balance: points, pending: 0 } }, { upsert: true }));

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

test('the website: sections, Ask Jack, and leaving an email for the team', async ({ page }) => {
  await page.setViewportSize(VP);
  await page.goto('/?ref=SARA-7K2');
  await expect(page.getByRole('heading', { name: 'The chat app that rewards you for showing up.' })).toBeVisible();
  for (const h of ['Everything you need to stay close', 'Earn INEX for the things you already do', 'One account for every Indexx product', 'Bring your people together', 'You decide who reaches you', 'Questions people ask']) await expect(page.getByRole('heading', { name: h })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('yays.ref'))).toBe('SARA-7K2');
  await shot(page, 'w07-landing');
  await page.getByRole('button', { name: 'Open the chat assistant' }).click();
  const box = page.getByRole('dialog', { name: 'Jack’s AI' });
  await box.getByLabel('Ask Jack’s AI').fill('How do I earn points?');
  await box.getByRole('button', { name: 'Send' }).click();
  await expect(box.getByText('demo mode')).toBeVisible();
  await box.getByRole('button', { name: 'Talk to the team' }).click();
  await box.getByLabel('Name').fill('Daniel Brooks');
  await box.getByLabel('Work email').fill('daniel@brooks.com');
  await box.getByText('Yes, YaysApp can contact me').click();
  await shot(page, 'w07b-assistant');
  await box.getByRole('button', { name: 'Send to team' }).click();
  await expect(box.getByText('Our team will email you at daniel@brooks.com')).toBeVisible();
  expect(await db((d) => d.collection('yc_leads').countDocuments({ email: 'daniel@brooks.com' }))).toBe(1);
  await page.getByRole('link', { name: 'Open web app' }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('pop-ups as the app opens: check-in, then the Jack’s AI bonus, then BTCY', async ({ browser }) => {
  const sara = await apiUser('Sara Ahmed');
  const a = await pageAs(browser, sara, VP, { popups: true });
  await a.page.goto('/chats');
  const ci = a.page.getByRole('dialog', { name: 'Welcome back, Sara' });
  await expect(ci).toBeVisible();
  await expect(ci.getByText('Daily check-in · Day 1')).toBeVisible();
  await shot(a.page, 'w08-checkin');
  await ci.getByRole('button', { name: 'Claim +10' }).click();
  await expect(a.page.getByRole('heading', { name: '+10 INEX added' })).toBeVisible();
  await expect(a.page.getByRole('link', { name: '10 INEX' })).toBeVisible();
  await shot(a.page, 'p18-checkin-claimed');
  await a.page.getByRole('button', { name: 'Done' }).click();
  await a.ctx.close();
  // A new tab: the next pop-up.
  const b = await pageAs(browser, sara, VP, { popups: true });
  await b.page.goto('/chats');
  const jack = b.page.getByRole('dialog', { name: /Earn \+50 bonus INEX/ });
  await expect(jack).toBeVisible();
  await expect(jack.getByText('Ask Jack’s AI 3 questions')).toBeVisible();
  await expect(jack.getByRole('img', { name: 'Jack’s AI' })).toBeVisible();
  await shot(b.page, 'w13-jack-bonus');
  await jack.getByRole('button', { name: 'Remind me later' }).click();
  await expect(jack).toBeHidden();
  await b.ctx.close();
  const c = await pageAs(browser, sara, VP, { popups: true });
  await c.page.goto('/chats');
  const btcy = c.page.getByRole('dialog', { name: /Earn up to \+100 INEX/ });
  await expect(btcy.getByText('Convert nuggets to tokens with Alchemy')).toBeVisible();
  await shot(c.page, 'w14-btcy-bonus');
  await btcy.getByRole('button', { name: 'Link Indexx account' }).click();
  await expect(c.page).toHaveURL(/\/settings\/indexx$/);
  await c.ctx.close();
  // Nothing more today.
  const d = await pageAs(browser, sara, VP, { popups: true });
  await d.page.goto('/chats');
  await d.page.waitForTimeout(1200);
  await expect(d.page.getByRole('dialog')).toHaveCount(0);
  await d.ctx.close();
});

test('Explore, Earn, history and invites', async ({ browser }) => {
  const sara = await apiUser('Sara Ahmed'), hamza = await apiUser('Hamza Tariq');
  const a = await pageAs(browser, sara, VP);
  await a.page.goto('/explore');
  await expect(a.page.getByRole('heading', { name: 'Explore' })).toBeVisible();
  for (const p of ['BTCY', 'EMMM', 'ShoperPal', 'ReHuman', 'Wall Street Indexx', 'Academy']) await expect(a.page.getByText(p, { exact: true })).toBeVisible();
  await shot(a.page, 'w01-explore');
  await a.page.getByLabel('Search products and features').fill('emm');
  await expect(a.page.getByText('BTCY', { exact: true })).toBeHidden();
  await a.page.getByRole('button', { name: 'Claim' }).click();
  await a.page.getByRole('button', { name: 'Claim +10' }).click();
  await expect(a.page.getByRole('heading', { name: '+10 INEX added' })).toBeVisible();
  await a.page.getByRole('button', { name: 'Done' }).click();
  // Hamza joins with Sara's code and says hi.
  const code = (await apiCall('/v1/rewards/referrals', undefined, sara.tokens.accessToken)).code as string;
  await apiCall('/v1/rewards/referrals/use', { code }, hamza.tokens.accessToken);
  const conv = (await apiCall('/v1/conversations/direct', { userId: sara.id }, hamza.tokens.accessToken)).id;
  await apiCall(`/v1/conversations/${conv}/messages`, { clientId: crypto.randomUUID(), text: 'Hi Sara!' }, hamza.tokens.accessToken);
  await a.page.goto('/earn');
  await expect(a.page.getByTestId('points-balance')).toHaveText('110');
  await expect(a.page.getByText(code)).toBeVisible();
  await expect(a.page.getByText('Ask Jack’s AI 3 questions')).toBeVisible();
  await shot(a.page, 'w03-earn');
  await a.page.getByRole('link', { name: 'History' }).click();
  await expect(a.page.getByText('Invited Hamza')).toBeVisible();
  await expect(a.page.getByText('Daily check-in')).toBeVisible();
  await shot(a.page, 'p07-history');
  await a.page.goto('/earn/invite');
  await expect(a.page.getByText('Hamza Tariq')).toBeVisible();
  await expect(a.page.getByText('Rewarded')).toBeVisible();
  await shot(a.page, 'p08-invites');
  await a.ctx.close();
});

test('Indexx account, wallet conversion and BTCY', async ({ browser }) => {
  const sara = await apiUser('Sara Ahmed');
  await give(sara, 2450);
  const a = await pageAs(browser, sara, VP);
  await a.page.goto('/wallet');
  await expect(a.page.getByText('Link your Indexx account', { exact: true })).toBeVisible();
  await a.page.getByRole('link', { name: 'Link account' }).click();
  await a.page.getByLabel('Indexx account email').fill('sara@indexx.io');
  await a.page.getByRole('button', { name: 'Link Indexx account' }).click();
  await expect(a.page.getByText('sara@indexx.io · since')).toBeVisible();
  await shot(a.page, 'p15-indexx-account');
  await a.page.goto('/wallet');
  await expect(a.page.getByText('$42.50')).toBeVisible();
  await a.page.getByLabel('INEX to convert').fill('3000');
  await expect(a.page.getByText('You have 2,450 INEX. Enter 2,450 or less.')).toBeVisible();
  await shot(a.page, 'w04-wallet');
  await a.page.getByLabel('INEX to convert').fill('1000');
  await a.page.getByRole('button', { name: 'Convert', exact: true }).click();
  const dlg = a.page.getByRole('dialog', { name: 'Convert INEX?' });
  await expect(dlg.getByText('10.00 BTCY Nuggets')).toBeVisible();
  await dlg.getByRole('button', { name: 'Convert' }).click();
  await expect(a.page.getByText('1,000 INEX became 10.00 BTCY Nuggets.')).toBeVisible();
  await expect(a.page.getByRole('cell', { name: /Converted INEX/ })).toBeVisible();
  await a.page.goto('/btcy');
  await a.page.getByRole('button', { name: 'Keep mining' }).click();
  await expect(a.page.getByText(/Mining active · .+ left/)).toBeVisible();
  await shot(a.page, 'w06-btcy');
  await a.page.goto('/products?tab=emmm');
  await expect(a.page.getByText('Open positions')).toBeVisible();
  await shot(a.page, 'p14-products');
  await a.ctx.close();
});

test('Jack’s AI: answers, documents, and the daily limit', async ({ browser }) => {
  const sara = await apiUser('Sara Ahmed');
  await give(sara, 200);
  const a = await pageAs(browser, sara, VP);
  await a.page.goto('/ai');
  await expect(a.page.getByRole('heading', { name: /What can I help with/ })).toBeVisible();
  await a.page.getByLabel('Message Jack').fill('Give me 3 post ideas for BTCY Traders');
  await a.page.getByRole('button', { name: 'Send' }).click();
  await expect(a.page.getByText('demo mode')).toBeVisible();
  await expect(a.page).toHaveURL(/\/ai\?c=/);
  await expect(a.page.getByText('1 of 30 today')).toBeVisible();
  await shot(a.page, 'w02-ai');
  await a.page.getByRole('button', { name: 'New chat' }).click();
  await a.page.getByRole('radio', { name: /Document/ }).click();
  await a.page.getByLabel('Message Jack').fill('Write a sponsorship proposal for Lahore Runners');
  await a.page.getByRole('button', { name: 'Send' }).click();
  const doc = a.page.getByRole('complementary', { name: 'Document preview' });
  await expect(doc.getByText('Version 1')).toBeVisible();
  await expect(doc.getByRole('button', { name: 'Word' })).toBeVisible();
  await shot(a.page, 'w09-ai-document');
  const dl = a.page.waitForEvent('download');
  await doc.getByRole('button', { name: 'Word' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.doc$/);
  // Out of messages: 50 points buys 10 more.
  const key = await (async () => { const r = await fetch('http://127.0.0.1:4100/v1/ai/quota', { headers: { authorization: `Bearer ${sara.tokens.accessToken}` } }); return r.json(); })();
  expect(key.used).toBe(2);
  const { default: Redis } = await import('ioredis').catch(() => ({ default: null as never }));
  if (Redis) {
    const r = new Redis('redis://127.0.0.1:6420');
    const k = (await r.keys(`ai:q:${sara.id}:*`))[0]!;
    await r.set(k, '30'); r.disconnect();
    await a.page.reload();
    await expect(a.page.getByText('You’ve used today’s 30 messages.')).toBeVisible();
    await shot(a.page, 'w02-ai-limit');
    await a.page.getByRole('button', { name: 'Use 50 INEX' }).click();
    await expect(a.page.getByLabel('Message Jack')).toBeVisible();
    await expect(a.page.getByText('30 of 40 today')).toBeVisible();
  }
  await a.ctx.close();
});

test('no money in chats; Jack’s catch-up summary with consent', async ({ browser }) => {
  const sara = await apiUser('Sara Ahmed'), amara = await apiUser('Amara Okafor');
  await link(sara, 'sara.p@indexx.io'); await link(amara, 'amara.p@indexx.io');
  const conv = (await apiCall('/v1/conversations/direct', { userId: amara.id }, sara.tokens.accessToken)).id as string;
  await apiCall(`/v1/conversations/${conv}/messages`, { clientId: crypto.randomUUID(), text: 'That dinner was great! Splitting the bill' }, amara.tokens.accessToken);
  const m = await pageAs(browser, amara, VP);
  await m.page.goto(`/chats?c=${conv}`);
  // Pay in chat was removed: the attach menu has no money option.
  await m.page.getByRole('button', { name: 'Attach' }).click();
  await expect(m.page.getByRole('menuitem').first()).toBeVisible();
  await expect(m.page.getByRole('menuitem', { name: /money/i })).toHaveCount(0);
  await m.page.keyboard.press('Escape');
  // Catch up: asks first, then summarises.
  await m.page.getByRole('button', { name: 'Catch up' }).click();
  const ask = m.page.getByRole('dialog', { name: 'Let Jack’s AI read this chat?' });
  await expect(ask.getByText('Not sent: photos, voice notes, phone numbers')).toBeVisible();
  await shot(m.page, 'p03-ai-consent');
  await ask.getByRole('button', { name: 'Allow and summarise' }).click();
  await expect(m.page.getByText(/Summary of \d+ messages?/)).toBeVisible();
  await shot(m.page, 'p04-ai-summary');
  await m.ctx.close();
});

test('support desk and socials', async ({ browser }) => {
  const sara = await apiUser('Sara Ahmed'), amara = await apiUser('Amara Okafor');
  const a = await pageAs(browser, sara, VP);
  await a.page.goto('/settings/help');
  await a.page.getByLabel('Describe the problem').fill('My daily check-in didn’t add INEX yesterday');
  await a.page.getByRole('button', { name: 'Get an answer' }).click();
  await expect(a.page.getByRole('button', { name: 'Talk to a person' })).toBeVisible();
  await shot(a.page, 'p05-support');
  await a.page.getByRole('button', { name: 'Talk to a person' }).click();
  await expect(a.page).toHaveURL(/\/chats\?c=/);
  await expect(a.page.getByLabel('Chat with YaysApp Support').getByText(/Ticket #YS-\d{5} created/)).toBeVisible();
  await a.page.goto('/settings/socials');
  await a.page.getByRole('button', { name: 'Add' }).nth(1).click();
  await a.page.getByLabel('Username').fill('sara.creates');
  await a.page.getByRole('button', { name: 'Save' }).click();
  await expect(a.page.getByRole('link', { name: '@sara.creates' }).first()).toBeVisible();
  await shot(a.page, 'p16-socials');
  await a.ctx.close();
  const conv = (await apiCall('/v1/conversations/direct', { userId: sara.id }, amara.tokens.accessToken)).id as string;
  const m = await pageAs(browser, amara, VP);
  await m.page.goto(`/chats?c=${conv}`);
  await m.page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(m.page.getByRole('link', { name: '@sara.creates' })).toBeVisible();
  await m.ctx.close();
});

test('Facebook: link it, sign in with it, and it shows verified on the profile', async ({ browser }) => {
  const sara = await apiUser('Sara Ahmed'), amara = await apiUser('Amara Okafor');
  const fbName = `Sara FB ${Date.now() % 100000}`;
  const a = await pageAs(browser, sara, VP);
  await a.page.goto('/settings/socials');
  await a.page.getByTestId('facebook-row').getByRole('button', { name: 'Link' }).click();
  const dlg = a.page.getByRole('dialog', { name: 'Link your Facebook' });
  await expect(dlg.getByText('Posts or reads your friends list')).toBeVisible();
  await shot(a.page, 'w15-facebook-link');
  await dlg.getByRole('button', { name: 'Continue with Facebook' }).click();
  // The development stand-in for Facebook's own page.
  await expect(a.page.getByText('Development stand-in')).toBeVisible();
  await a.page.getByLabel('Your Facebook name').fill(fbName);
  await a.page.getByRole('button', { name: 'Continue' }).click();
  await expect(a.page).toHaveURL(/\/settings\/socials$/);
  await expect(a.page.getByText('Facebook linked.')).toBeVisible();
  await expect(a.page.getByTestId('facebook-row')).toContainText(`${fbName} · verified`);
  await expect(a.page.getByRole('switch', { name: /Sign in with Facebook/ })).toHaveAttribute('aria-checked', 'true');
  await shot(a.page, 'p30-facebook-linked');
  // Her own profile shows it, with a preview of what others see (p34).
  await a.page.goto('/settings/profile');
  await expect(a.page.getByLabel(`Facebook: ${fbName}, verified`)).toBeVisible();
  await a.page.getByRole('radio', { name: 'Anyone else' }).click();
  await expect(a.page.getByTestId('socials-preview')).toBeVisible();
  await a.ctx.close();
  // Amara sees it, ticked, on Sara's contact info.
  const conv = (await apiCall('/v1/conversations/direct', { userId: sara.id }, amara.tokens.accessToken)).id as string;
  const m = await pageAs(browser, amara, VP);
  await m.page.goto(`/chats?c=${conv}`);
  await m.page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(m.page.getByLabel(`Facebook: ${fbName}, verified`)).toBeVisible();
  await shot(m.page, 'w17-contact-socials');
  await m.ctx.close();
  // A fresh browser signs in with Facebook.
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport: VP });
  const p = await ctx.newPage();
  await p.goto('/sign-in');
  await p.getByRole('button', { name: 'Sign in with a code instead' }).click();
  await shot(p, 'w16-signin-facebook');
  await p.getByRole('button', { name: 'Facebook', exact: true }).click();
  await p.getByLabel('Your Facebook name').fill(fbName);
  await p.getByRole('button', { name: 'Continue' }).click();
  await expect(p).toHaveURL(/\/chats$/);
  // A Facebook nobody linked doesn't make an account.
  const q = await (await browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport: VP })).newPage();
  await q.goto('/sign-in');
  await q.getByRole('button', { name: 'Sign in with a code instead' }).click();
  await q.getByRole('button', { name: 'Facebook', exact: true }).click();
  await q.getByLabel('Your Facebook name').fill('Nobody Linked Me');
  await q.getByRole('button', { name: 'Continue' }).click();
  await expect(q.getByRole('heading', { name: 'This Facebook isn’t linked yet' })).toBeVisible();
  await expect(q.getByText('Nobody Linked Me')).toBeVisible();
  await shot(q, 'p32-facebook-not-linked');
  await ctx.close();
});
