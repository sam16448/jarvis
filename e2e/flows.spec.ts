import { expect, test } from '@playwright/test';
import { apply, open, say } from './helpers';

test('add a task by text, confirm it, then undo', async ({ page }) => {
  await open(page);
  await say(page, 'I need to do my History essay, due Thursday.');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('History essay');
  await expect(dlg).toContainText('due Thu 15 Oct');
  await page.screenshot({ path: 'shots/e2e-add-confirm.png' });
  await apply(page);
  await expect(page.locator('.tl-item', { hasText: 'History essay' })).toHaveCount(1);
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect(page.locator('.tl-item', { hasText: 'History essay' })).toHaveCount(0);
});

test('add a recurring event with an end date', async ({ page }) => {
  await open(page);
  await say(page, 'Add coding practice every day 10:15 to 11 pm till Oct 23.');
  await expect(page.getByRole('dialog')).toContainText('12 sessions');
  await apply(page);
  await expect(page.locator('.tl-item', { hasText: 'Coding practice' })).toHaveCount(1);
  await page.goto('/#/calendar?v=week&d=2026-10-19');
  await expect(page.locator('.blk', { hasText: 'Coding practice' })).toHaveCount(5); // Mon-Fri until Oct 23
});

test('block time, resolve the conflict by voice-style reply', async ({ page }) => {
  await open(page);
  await say(page, 'Viva prep due today 11:59 pm, takes 1 hour, critical');
  await apply(page);
  await say(page, 'Clear my time from 6:30 to 10:30 pm today, I have hackathon work');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('At risk');
  await expect(page.getByRole('button', { name: 'Pick an option' })).toBeDisabled();
  await page.screenshot({ path: 'shots/e2e-conflict.png', fullPage: false });
  await dlg.getByRole('textbox', { name: 'Reply' }).fill('okay add it today after I come home and push my sleep');
  await dlg.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.opt[aria-pressed="true"] .key')).toHaveText('a');
  await expect(dlg).toContainText('Bedtime');
  await page.screenshot({ path: 'shots/e2e-conflict-a.png' });
  await apply(page);
  await expect(page.locator('.tl-item', { hasText: 'Viva prep' })).toHaveCount(1);
  await expect(page.locator('.tl-item', { hasText: 'Hackathon work' })).toHaveCount(1);
});

test('mark done with one tap and undo', async ({ page }) => {
  await open(page, '2026-10-12T21:10');
  await say(page, 'Physics revision today 9 to 10 pm');
  await apply(page);
  await page.getByRole('button', { name: 'Mark Physics revision done' }).click();
  await expect(page.getByRole('button', { name: 'Mark Physics revision not done' })).toBeVisible();
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Mark Physics revision done' })).toBeVisible();
});

test('morning brief opens on first open of the day', async ({ page }) => {
  await page.goto('/?now=2026-10-12T07:00#/today');
  const brief = page.getByRole('dialog', { name: 'Morning brief' });
  await expect(brief).toBeVisible();
  await expect(brief).toContainText('Top priorities');
  await expect(brief).toContainText('Last night');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'shots/brief.png' });
  await page.screenshot({ path: 'shots/brief-full.png', fullPage: true });
  await brief.getByRole('button', { name: 'Start the day' }).click();
  await expect(brief).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(800);
  await expect(page.getByRole('dialog', { name: 'Morning brief' })).toHaveCount(0);
});

test('night wrap-up: tick done, reschedule the rest', async ({ page }) => {
  await open(page, '2026-10-12T18:40');
  await say(page, 'Maths numericals today 6:40 to 7:40 pm');
  await page.getByRole('button', { name: 'Apply' }).click();
  await say(page, 'History essay due Thursday, 1 hour');
  await page.getByRole('button', { name: 'Apply' }).click();
  // jump to the evening
  await page.goto('/?now=2026-10-12T22:30#/today');
  const wrap = page.getByRole('dialog', { name: 'Night wrap-up' });
  await expect(wrap).toBeVisible();
  await wrap.locator('label', { hasText: 'Maths numericals' }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'shots/wrapup.png' });
  await wrap.getByRole('button', { name: 'Finish and reschedule' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Wrap up today: 1 done');
  await expect(dlg).toContainText('History essay');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: 'Mark Maths numericals not done' })).toBeVisible();
});

test('clear my evening, then "add it from 11 pm and push my sleep"', async ({ page }) => {
  await open(page, '2026-10-12T15:00');
  await say(page, 'Lab record due tomorrow 9 am, takes 90 min');
  await apply(page);
  await say(page, 'Clear my evening from 4 to 10 today because of club work');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Club work');
  await expect(dlg).toContainText('At risk');
  await dlg.getByRole('textbox', { name: 'Reply' }).fill('okay add it from 11 pm today and push my sleep today');
  await dlg.getByRole('textbox', { name: 'Reply' }).press('Enter');
  await expect(page.locator('.opt[aria-pressed="true"]')).toContainText('Do it at 11:00 pm and push bedtime');
  await expect(dlg).toContainText('5.8 h sleep');
  await page.screenshot({ path: 'shots/e2e-evening-11pm.png' });
  await dlg.getByRole('textbox', { name: 'Reply' }).fill('yes');
  await dlg.getByRole('textbox', { name: 'Reply' }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.tl-item', { hasText: 'Lab record' })).toContainText('11:00 pm');
  await expect(page.locator('.stat', { hasText: 'sleep' })).toContainText('5.8 h');
});
