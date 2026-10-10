import { expect, type Page } from '@playwright/test';

/** Fresh app with the clock pinned. Each test gets a new browser context, so IndexedDB is empty. */
export async function open(page: Page, now = '2026-10-12T18:00', route = '/today') {
  await page.goto(`/?now=${now}#${route}`);
  await expect(page.locator('.top .brand')).toHaveText('Jarvis');
  await closeAutoSheet(page);
}

/** The brief / wrap-up opens automatically once per day; close it. */
export async function closeAutoSheet(page: Page) {
  const auto = page.getByRole('dialog', { name: /Morning brief|Night wrap-up/ });
  try { await auto.waitFor({ timeout: 1500 }); } catch { return; }
  await page.keyboard.press('Escape');
  await expect(auto).toHaveCount(0);
}

export async function say(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Speak or type' });
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
}

export async function apply(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
