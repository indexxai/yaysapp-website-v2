import { test as base, expect } from '@playwright/test';
import { NO_POPUPS } from './helpers';

/** Playwright's test, with the opening pop-ups turned off (phase2.spec.ts turns them on where it tests them). */
export const test = base.extend({
  context: async ({ context }, use) => { await context.addInitScript(NO_POPUPS); await use(context); },
});
export { expect };
export type { Browser, BrowserContext, Page } from '@playwright/test';
