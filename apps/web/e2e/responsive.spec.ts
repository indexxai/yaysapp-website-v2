import { expect, test } from '@playwright/test';

test('sign-in fits a phone screen with no sideways scroll', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in to YaysApp' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Send code' })).toBeInViewport();
});

test('on a phone, the chat list and a chat each take the whole screen', async ({ browser }) => {
  const { apiUser, pageAs } = await import('./helpers');
  const ali = await apiUser('Ali'), sara = await apiUser('Sara');
  const a = await pageAs(browser, ali, { width: 412, height: 915 });
  await a.page.goto('/chats');
  await a.page.getByRole('button', { name: 'New chat' }).first().click();
  await a.page.getByLabel('Find someone').fill(`@${sara.username}`);
  await a.page.getByRole('button', { name: 'Search' }).click();
  await a.page.getByTestId('lookup-result').click();
  await expect(a.page.getByRole('region', { name: 'Chat with Sara' })).toBeVisible();
  await expect(a.page.getByRole('navigation', { name: 'Chats' })).toBeHidden();
  await a.page.getByLabel('Message', { exact: true }).fill('from my phone');
  await a.page.getByLabel('Message', { exact: true }).press('Enter');
  await expect(a.page.getByRole('button', { name: 'Record' })).toBeInViewport();
  const overflow = await a.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await a.page.getByRole('button', { name: 'Chats' }).click();
  await expect(a.page.getByTestId('chat-row').filter({ hasText: 'Sara' })).toContainText('from my phone');
  await a.ctx.close();
});
