import { expect, test } from '@playwright/test';

test('workbook loading and 404 recovery', async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/workbook/studio', async route => {
    await waiting;
    await route.continue();
  });
  await page.goto('/s/budget?cell=A1');
  await expect(page.getByRole('status')).toHaveText('Opening Northline Studio…');
  release();
  await expect(page.getByRole('grid')).toBeVisible();
  const response = await page.goto('/missing-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: "We couldn't find that page." })).toBeVisible();
  await page.getByRole('link', { name: 'Open workbook' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
});

test('navbar reset waits for saving and shows progress until fixtures return', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Phones are view only.');
  await request.post('/api/reset');
  await page.goto('/s/budget?cell=B7');
  await expect(page.getByRole('grid')).toBeVisible();
  let finishSave!: () => void;
  const saving = new Promise<void>(resolve => { finishSave = resolve; });
  await page.route('**/api/workbook/studio', async route => {
    if (route.request().method() === 'PUT') {
      await saving;
      await route.fulfill({ json: { updatedAt: Date.now() } });
    } else await route.continue();
  });
  let finishReset!: () => void;
  const resetting = new Promise<void>(resolve => { finishReset = resolve; });
  let resetRequests = 0;
  await page.route('**/api/reset', async route => {
    resetRequests++;
    await resetting;
    await route.continue();
  });
  const formula = page.getByRole('textbox', { name: 'Raw value of B7' });
  await formula.fill('12345');
  const saveStarted = page.waitForRequest(request => request.method() === 'PUT');
  await formula.press('Enter');
  await saveStarted;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset demo fixtures', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Resetting workbook');
  await expect(page.getByRole('grid')).toHaveCount(0);
  expect(resetRequests).toBe(0);
  finishSave();
  await expect.poll(() => resetRequests).toBe(1);
  await expect(page.getByRole('status')).toContainText('Resetting workbook');
  finishReset();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All changes saved' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.locator('#cell-budget-B7 .cell-content')).not.toHaveText('12,345');
  expect(await page.evaluate(() => localStorage.getItem('tally:studio:pending'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.locator('#cell-budget-B7 .cell-content')).not.toHaveText('12,345');
});

test('failed reset keeps edits and allows retry; cancel sends no request', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Phones are view only.');
  await request.post('/api/reset');
  await page.goto('/s/budget?cell=B7');
  await expect(page.getByRole('grid')).toBeVisible();
  await page.route('**/api/workbook/studio', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 503, json: { error: 'Save failed' } });
    else await route.continue();
  });
  const formula = page.getByRole('textbox', { name: 'Raw value of B7' });
  await formula.fill('12345');
  await formula.press('Enter');
  let resetRequests = 0;
  await page.route('**/api/reset', async route => {
    resetRequests++;
    await route.fulfill({ status: 500, json: { error: 'Reset failed' } });
  });
  const reset = page.getByRole('button', { name: 'Reset demo fixtures', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await reset.click();
  expect(resetRequests).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await reset.click();
  await expect(page.locator('.toast-text')).toContainText('Reset failed. Your workbook is unchanged.');
  await expect(formula).toHaveValue('12345');
  expect(await page.evaluate(() => localStorage.getItem('tally:studio:pending'))).toContain('12345');
  await expect(reset).toBeEnabled();
  await page.unroute('**/api/reset');
  page.once('dialog', dialog => dialog.accept());
  await reset.click();
  await expect(page.locator('.toast-text')).toHaveText('Demo data restored');
});
