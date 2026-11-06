import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, page }) => {
  await request.post('/api/reset');
  await page.goto('/s/budget?cell=B7');
  await expect(page.getByRole('grid')).toBeVisible();
});

test('keyboard movement, editing and incremental budget formulas', async ({ page }) => {
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.address-box')).toHaveText('C7');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'Edit B7' });
  await input.fill('60000');
  await input.press('Enter');
  await page.locator('.data-cell#cell-budget-E10').click();
  await expect(page.locator('.formula-result')).toHaveText('245,100');
  await expect(page.locator('.formula-input')).toHaveValue('=SUM(E7:E9)');
  await page.locator('.data-cell#cell-budget-E30').click();
  await expect(page.locator('.formula-result')).not.toBeEmpty();
});

test('multiple pasted cells undo in one step', async ({ page }) => {
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.evaluate(() => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', '123\t456\n789\t10');
    document.querySelector('[role="grid"]')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#cell-budget-B7 .cell-content')).toHaveText('123');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#cell-budget-B7 .cell-content')).not.toHaveText('123');
});

test('invalid sheet and formula error render safely', async ({ page }) => {
  await page.getByRole('tab', { name: 'Formula diagnostics' }).click();
  await expect(page.locator('#cell-diagnostics-B5')).toContainText('#CYCLE!');
  await expect(page.locator('#cell-diagnostics-B7')).toContainText('#REF!');
  await expect(page.locator('#cell-diagnostics-C9')).toContainText('#DIV/0!');
  await page.goto('/s/does-not-exist?cell=A1');
  await expect(page.getByText("That sheet doesn't exist.")).toBeVisible();
});

test('10,000-row grid virtualizes the end of the sheet', async ({ page }) => {
  await page.getByRole('tab', { name: '10k orders' }).click();
  await page.locator('.grid-viewport').evaluate(element => { element.scrollTop = 340000; });
  await expect(page.locator('#cell-orders-L10000')).toBeVisible();
  expect(await page.locator('.grid-row').count()).toBeLessThan(80);
});

test('save failure recovers locally after reload', async ({ page }) => {
  await page.route('**/api/workbook/studio', async route => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated failure' }) });
    } else await route.continue();
  });
  await page.getByRole('grid').focus();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Edit B7' }).fill('73999');
  await page.getByRole('textbox', { name: 'Edit B7' }).press('Enter');
  await expect(page.getByText('Save failed. Retry')).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.locator('#cell-budget-B7 .cell-content')).toHaveText('73999');
});

test('layout remains usable on narrow viewports and theme toggles', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.locator('.grid-area')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle light and dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(dark|light)$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Read-only on phone.')).toBeVisible();
});
