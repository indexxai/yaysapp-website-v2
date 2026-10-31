import { expect, test, type Page } from './test';
import { apiCall, apiUser, pageAs, type ApiUser } from './helpers';

const say = (u: ApiUser, c: string, text: string) => apiCall(`/v1/conversations/${c}/messages`, { clientId: crypto.randomUUID(), text }, u.tokens.accessToken);
const direct = async (a: ApiUser, b: ApiUser) => { const c = await apiCall('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken); await say(a, c.id, 'hi'); return c.id as string; };
const callScreen = (p: Page) => p.getByRole('dialog', { name: /(Voice|Video) call with/ });
const incoming = (p: Page) => p.getByRole('alertdialog');
/** Real audio (and video) arrived from the other side through LiveKit. */
async function hearsSomeone(p: Page) { await expect.poll(() => p.getByTestId('remote-audio').count(), { timeout: 15_000 }).toBeGreaterThan(0); }
async function seesVideoFrom(p: Page, who: string) {
  const v = p.locator(`[data-testid="call-tile"][data-who="${who}"] video`);
  await expect(v).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => v.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 15_000 }).toBeGreaterThan(0);
}

test.describe('Calls on the web', () => {
  test('a voice call: it rings, connects with real audio, survives moving pages, and ends with a line in the chat', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await direct(ali, sara);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto('/settings');
    await a.page.goto(`/chats?c=${c}`);
    await a.page.getByRole('button', { name: 'Voice call' }).click();
    const ac = callScreen(a.page);
    await expect(ac).toBeVisible();
    await expect(ac.getByTestId('call-status')).toHaveText(/Ringing…|Calling…|Connecting…/);
    // Sara is on another page: the call rings there.
    const ring = incoming(s.page);
    await expect(ring).toContainText('Incoming voice call');
    await expect(ring).toContainText('Ali');
    await expect(ring.getByRole('button', { name: 'Voice only' })).toHaveCount(0);
    await ring.getByRole('button', { name: 'Accept' }).click();
    const sc = callScreen(s.page);
    await expect(sc).toBeVisible();
    await expect(ac.getByTestId('call-status')).toHaveText(/^\d+:\d\d$/, { timeout: 15_000 });
    await expect(sc.getByTestId('call-status')).toHaveText(/^\d+:\d\d$/);
    await hearsSomeone(a.page); await hearsSomeone(s.page);
    // Muting shows on the other side.
    await ac.getByRole('button', { name: 'Mute' }).click();
    await expect(sc.getByText('Ali is muted')).toBeVisible({ timeout: 10_000 });
    await ac.getByRole('button', { name: 'Unmute' }).click();
    await expect(sc.getByText('Ali is muted')).toHaveCount(0, { timeout: 10_000 });
    // Mini window, then another page: still on the call.
    await ac.getByRole('button', { name: 'Mini window' }).click();
    const mini = a.page.getByRole('region', { name: 'Call with Sara' });
    await expect(mini).toBeVisible();
    await a.page.getByRole('link', { name: 'Calls' }).click();
    await expect(a.page.getByRole('heading', { name: 'Calls' })).toBeVisible();
    await expect(mini.getByTestId('call-status')).toHaveText(/^\d+:\d\d$/);
    await hearsSomeone(a.page);
    await mini.getByRole('button', { name: 'Back to call' }).click();
    await expect(callScreen(a.page)).toBeVisible();
    // Sara hangs up: both sides close, and the chat says how long it was.
    await sc.getByTestId('hang-up').click();
    await expect(callScreen(a.page)).toContainText('Call ended');
    await expect(callScreen(a.page)).toHaveCount(0, { timeout: 6000 });
    await expect(callScreen(s.page)).toHaveCount(0, { timeout: 6000 });
    await s.page.goto(`/chats?c=${c}`);
    await expect(s.page.getByTestId('call-line')).toContainText(/Voice call · \d+:\d\d/);
    await a.page.reload();
    const row = a.page.getByTestId('call-row').first();
    await expect(row).toContainText('Sara');
    await expect(row).toContainText(/Outgoing · \d+ s/);
    await a.ctx.close(); await s.ctx.close();
  });

  test('video: both sides see each other; declining and not answering are shown, and missed calls get a badge', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara');
    const c = await direct(ali, sara);
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara);
    await s.page.goto('/chats');
    await a.page.goto(`/chats?c=${c}`);
    await a.page.getByRole('button', { name: 'Video call' }).click();
    const ring = incoming(s.page);
    await expect(ring).toContainText('Incoming video call');
    await ring.getByRole('button', { name: 'Accept' }).click();
    await seesVideoFrom(a.page, sara.id);
    await seesVideoFrom(s.page, ali.id);
    await seesVideoFrom(a.page, 'me');
    // Camera off: the other side sees the avatar instead.
    await callScreen(s.page).getByRole('button', { name: 'Camera off' }).click();
    await expect(a.page.locator(`[data-testid="call-tile"][data-who="${sara.id}"] video`)).toHaveCount(0, { timeout: 10_000 });
    await callScreen(a.page).getByTestId('hang-up').click();
    await expect(callScreen(s.page)).toHaveCount(0, { timeout: 6000 });

    // Declined.
    await a.page.getByRole('button', { name: 'Video call' }).click();
    await incoming(s.page).getByRole('button', { name: 'Decline' }).click();
    await expect(callScreen(a.page).getByTestId('call-status')).toHaveText('Declined');
    await expect(callScreen(a.page)).toHaveCount(0, { timeout: 6000 });
    // Not answered (the ring times out): a missed call for Sara.
    await a.page.getByRole('button', { name: 'Voice call' }).click();
    await expect(incoming(s.page)).toBeVisible();
    await expect(callScreen(a.page).getByTestId('call-status')).toHaveText('No answer', { timeout: 15_000 });
    await expect(incoming(s.page)).toHaveCount(0);
    const badge = s.page.getByLabel('1 missed call');
    await expect(badge).toBeVisible();
    await expect(s.page.getByTestId('chat-row').filter({ hasText: 'Ali' })).toContainText('Missed voice call');
    await s.page.getByRole('link', { name: 'Calls' }).click();
    await expect(s.page.getByLabel(/missed call/)).toHaveCount(0);
    const rows = s.page.getByTestId('call-row');
    await expect(rows.first()).toContainText('Missed');
    await expect(rows.nth(1)).toContainText('Declined');
    await expect(rows.nth(2)).toContainText(/Incoming · \d+ s/);
    await s.page.getByRole('tab', { name: 'Missed' }).click();
    await expect(rows).toHaveCount(1);
    // Details, and calling back from there.
    await rows.first().getByRole('button', { name: /^Ali,/ }).click();
    const detail = s.page.getByRole('region', { name: 'Calls with Ali' });
    await expect(detail.getByTestId('call-detail-row')).toHaveCount(3);
    await detail.getByRole('button', { name: 'Voice', exact: true }).click();
    await expect(incoming(a.page)).toContainText('Sara');
    await incoming(a.page).getByRole('button', { name: 'Decline' }).click();
    await a.ctx.close(); await s.ctx.close();
  });

  test('a group call: members are rung, someone joins later from the chat, and people can be added', async ({ browser }) => {
    const ali = await apiUser('Ali'), sara = await apiUser('Sara'), omar = await apiUser('Omar');
    const g = (await apiCall('/v1/groups', { name: 'Family', memberIds: [sara.id, omar.id] }, ali.tokens.accessToken)).id as string;
    const a = await pageAs(browser, ali), s = await pageAs(browser, sara), o = await pageAs(browser, omar);
    await s.page.goto('/chats'); await o.page.goto(`/chats?c=${g}`);
    await a.page.goto(`/chats?c=${g}`);
    await a.page.getByRole('button', { name: 'Voice call' }).click();
    await expect(incoming(s.page)).toContainText('Incoming group voice call');
    await expect(incoming(s.page)).toContainText('Ali is calling');
    await incoming(o.page).getByRole('button', { name: 'Decline' }).click();
    await incoming(s.page).getByRole('button', { name: 'Accept' }).click();
    const ac = callScreen(a.page);
    await expect(ac.getByTestId('call-status')).toHaveText(/^\d+:\d\d · 2 on the call$/, { timeout: 15_000 });
    await hearsSomeone(s.page);
    // Omar changes his mind: the chat shows "Join".
    const join = o.page.getByRole('button', { name: 'Join voice call' });
    await expect(join).toContainText('2');
    await join.click();
    await expect(callScreen(o.page)).toBeVisible();
    await expect(ac.getByTestId('call-tile')).toHaveCount(3, { timeout: 15_000 });
    await expect(ac.getByTestId('call-status')).toHaveText(/3 on the call/);
    await callScreen(o.page).getByTestId('hang-up').click();
    await expect(ac.getByTestId('call-tile')).toHaveCount(2, { timeout: 15_000 });
    // Ring him again from the call.
    await ac.getByRole('button', { name: 'Add people' }).click();
    await a.page.getByRole('dialog', { name: 'Add people' }).getByRole('button', { name: 'Ring Omar' }).click();
    await expect(incoming(o.page)).toBeVisible();
    await expect(a.page.getByRole('dialog', { name: 'Add people' })).toContainText('Ringing…');
    await a.page.getByRole('dialog', { name: 'Add people' }).getByRole('button', { name: 'Close' }).click();
    await incoming(o.page).getByRole('button', { name: 'Decline' }).click();
    for (const p of [a.page, s.page]) await callScreen(p).getByTestId('hang-up').click();
    await expect(o.page.getByRole('button', { name: 'Join voice call' })).toHaveCount(0);
    await expect(o.page.getByTestId('call-line')).toContainText(/Group voice call · \d+:\d\d/);
    await a.ctx.close(); await s.ctx.close(); await o.ctx.close();
  });

  test('call links: make one, join it, and let a stranger in', async ({ browser }) => {
    const ali = await apiUser('Ali'), hana = await apiUser('Hana');
    const a = await pageAs(browser, ali), h = await pageAs(browser, hana);
    await a.page.goto('/calls');
    await a.page.getByRole('button', { name: 'Call link' }).click();
    const dlg = a.page.getByRole('dialog', { name: 'Call link ready' });
    await expect(dlg.getByLabel('Call link')).toHaveValue(/\/call\/[A-Za-z0-9]{10}$/);
    const url = await dlg.getByLabel('Call link').inputValue();
    await dlg.getByRole('radio', { name: 'Voice call' }).click();
    await expect(dlg.getByRole('radio', { name: 'Voice call' })).toHaveAttribute('aria-checked', 'true');
    await dlg.getByLabel('Link name').fill('Design review');
    await dlg.getByLabel('Link name').blur();
    await dlg.getByRole('button', { name: 'Copy' }).click();
    await expect(dlg.getByRole('button', { name: 'Copied' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Join now' }).click();
    const ac = callScreen(a.page);
    await expect(ac.getByTestId('call-status')).toHaveText('Waiting for others to join', { timeout: 15_000 });

    await h.page.goto(new URL(url).pathname);
    await expect(h.page.getByRole('heading', { name: 'Design review' })).toBeVisible();
    await expect(h.page.getByText('Voice call · from Ali · 1 on the call now')).toBeVisible();
    await h.page.getByRole('button', { name: 'Join call' }).click();
    await expect(h.page.getByText('Waiting for Ali to let you in…')).toBeVisible();
    const req = ac.getByTestId('join-request');
    await expect(req).toContainText('Hana wants to join');
    await req.getByRole('button', { name: 'Let Hana in' }).click();
    await expect(callScreen(h.page)).toBeVisible({ timeout: 15_000 });
    await expect(ac.getByTestId('call-tile')).toHaveCount(2, { timeout: 15_000 });
    await hearsSomeone(a.page); await hearsSomeone(h.page);
    await callScreen(h.page).getByTestId('hang-up').click();
    await callScreen(a.page).getByTestId('hang-up').click();
    await expect(callScreen(a.page)).toHaveCount(0, { timeout: 6000 });
    await a.ctx.close(); await h.ctx.close();
  });
});
