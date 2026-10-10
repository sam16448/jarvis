import { expect, test } from '@playwright/test';
import { apply, open, say } from './helpers';

test('deadlines list shows risk for a task', async ({ page }) => {
  await open(page, '2026-10-12T18:00');
  await say(page, 'Lab record due tomorrow 9 am, 1 hour');
  await apply(page);
  await page.goto('/#/deadlines');
  const row = page.locator('.li', { hasText: 'Lab record' });
  await expect(row).toContainText('Due Tue 13 Oct');
  await expect(row.locator('.pill')).toHaveText(/tight|on track/);
  await page.screenshot({ path: 'shots/deadlines-with-task.png' });
});

test('exams: plan study hours toward targets', async ({ page }) => {
  await open(page, '2026-10-12T07:00', '/exams');
  await say(page, 'Maths exam on Oct 28 10 to 12');
  await expect(page.getByRole('dialog')).toContainText('Add exam');
  await apply(page);
  const card = page.getByRole('region', { name: 'Maths exam' });
  await card.getByRole('button', { name: 'Target 0 h' }).click();
  await card.getByRole('spinbutton', { name: 'Target hours' }).fill('20');
  await card.getByRole('button', { name: 'Save' }).click();
  await card.getByRole('button', { name: 'Plan Maths' }).click();
  await expect(page.getByRole('dialog')).toContainText('Maths: +20h planned');
  await apply(page);
  await expect(card).toContainText('20h planned');
  await page.screenshot({ path: 'shots/exams-planned.png' });
});

test('inbox: timeless text is captured, then scheduled', async ({ page }) => {
  await open(page);
  await say(page, 'buy a new calculator');
  await expect(page.getByRole('dialog')).toContainText('Save to Inbox');
  await apply(page);
  await page.goto('/#/inbox');
  await expect(page.locator('.li', { hasText: 'buy a new calculator' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByRole('textbox', { name: 'Speak or type' })).toHaveValue('buy a new calculator ');
});

test('habits tick on Today and show a streak screen', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Water' }).click();
  await expect(page.getByRole('button', { name: 'Water' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/habits');
  await expect(page.getByRole('region', { name: 'Water' })).toContainText('1 day streak');
});

test('day template applies to a date', async ({ page }) => {
  await open(page, '2026-10-12T18:00', '/templates');
  await page.getByRole('button', { name: /Apply to/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Exam-week day');
  await apply(page);
  await page.goto('/#/calendar?v=day&d=2026-10-13');
  await expect(page.locator('.blk', { hasText: 'Past paper' })).toHaveCount(1);
});
