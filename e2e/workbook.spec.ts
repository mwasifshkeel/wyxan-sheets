import { expect, test } from '@playwright/test';

const phoneTests = new Set([
  'invalid sheet and formula error render safely',
  '10,000-row grid virtualizes the end of the sheet',
  'layout remains usable on narrow viewports and theme toggles',
  'phone view blocks edits and workbook controls',
  'native phone touch drag and swipe scrolling',
  'frozen column stays fixed before scroll events render',
  'phone landscape stays view only and tablet editing returns',
]);

test.beforeEach(async ({ request, page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone' && !phoneTests.has(testInfo.title), 'Editing is available on desktop and tablet; phone has dedicated view-only checks.');
  await request.post('/api/reset');
  await page.goto('/s/budget?cell=B7');
  await expect(page.getByRole('grid')).toBeVisible();
});

test('keyboard movement, editing and incremental budget formulas', async ({ page }) => {
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.address-box')).toHaveValue('C7');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'Edit B7' });
  await input.fill('60000');
  await input.press('Enter');
  await page.locator('.data-cell#cell-budget-E10').click();
  await expect(page.locator('.formula-result')).toHaveText('245,100');
  await expect(page.locator('.formula-input')).toHaveValue('=SUM(E7:E9)');
  await page.getByRole('textbox', { name: 'Go to cell' }).fill('E30');
  await page.getByRole('textbox', { name: 'Go to cell' }).press('Enter');
  await expect(page.locator('.formula-result')).not.toBeEmpty();
});

test('multiple pasted cells undo in one step', async ({ page }) => {
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.evaluate(() => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', '123\t456\n789\t10');
    document.querySelector('[role="grid"]')?.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { bubbles: true, cancelable: true }), 'clipboardData', { value: clipboard }));
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
  await page.getByRole('textbox', { name: 'Go to cell' }).fill('L10000');
  await page.getByRole('textbox', { name: 'Go to cell' }).press('Enter');
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
  await expect(page.getByRole('button', { name: 'Save failed. Retry', exact: true })).toBeVisible({ timeout: 15000 });
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
  await expect(page.getByRole('textbox', { name: 'Raw value of B7' })).not.toBeEditable();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
});

async function goTo(page: import('@playwright/test').Page, address: string) {
  await page.getByRole('textbox', { name: 'Go to cell' }).fill(address);
  await page.getByRole('textbox', { name: 'Go to cell' }).press('Enter');
}

async function pasteText(page: import('@playwright/test').Page, text: string, html = '') {
  await page.evaluate(({ text, html }) => {
    // firefox strips clipboardData from a constructed ClipboardEvent.
    const data = new DataTransfer();
    if (text) data.setData('text/plain', text);
    if (html) data.setData('text/html', html);
    document.querySelector('[role="grid"]')!.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { bubbles: true, cancelable: true }), 'clipboardData', { value: data }));
  }, { text, html });
}

test('sheet add, rename, delete and history work on every viewport', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a sheet' }).click();
  await page.getByRole('textbox', { name: 'New sheet name' }).fill('Notes');
  await page.getByRole('textbox', { name: 'New sheet name' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  const formula = page.getByRole('textbox', { name: 'Raw value of A1' });
  await formula.fill('keep me');
  await formula.press('Enter');
  await page.getByRole('button', { name: 'Delete this sheet' }).click();
  await expect(page.getByRole('tab', { name: 'Notes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByRole('textbox', { name: 'Raw value of A1' })).toHaveValue('keep me');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Notes' })).toHaveCount(0);
});

test('wide paste, HTML safety, multiline cells and autofit', async ({ page }) => {
  await goTo(page, 'L1');
  await pasteText(page, 'wide content for autofitting this column\t=<img src=x>\n"two\nlines"\t5');
  await expect(page.getByRole('grid')).toHaveAttribute('aria-colcount', '27');
  await goTo(page, 'L1');
  const grip = page.getByRole('separator', { name: 'Resize column L', exact: true });
  const before = Number(await grip.getAttribute('aria-valuenow'));
  await grip.dblclick({ force: true });
  await expect.poll(async () => Number(await grip.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  await goTo(page, 'L2');
  await expect(page.getByRole('textbox', { name: 'Raw value of L2' })).toHaveValue('two\nlines'.replace('\n', ''));
  // input elements normalize newlines, but the clipboard still keeps the raw cell intact.
  await goTo(page, 'A1');
  await pasteText(page, '', '<table><tr><td>safe<script>window.badPaste=true</script></td><td>42</td></tr></table>');
  await expect(page.locator('#cell-budget-A1 .cell-content')).toHaveText('safe');
  expect(await page.evaluate(() => (window as Window & { badPaste?: boolean }).badPaste)).toBeUndefined();
  await page.getByRole('button', { name: 'Add column', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Go to cell' })).toHaveValue('AA1');
});

test('default scrolling, optional freeze and column keyboard autofit', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Freeze column A', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await goTo(page, 'A1');
  await page.getByRole('button', { name: 'Freeze column A', exact: true }).click();
  await page.locator('.grid-viewport').evaluate(element => { element.scrollLeft = 500; });
  await expect(page.locator('#cell-budget-A1')).toBeVisible();
  const grip = page.getByRole('separator', { name: 'Resize column A', exact: true });
  await grip.focus(); await grip.press('Enter');
  await expect(grip).toHaveAttribute('aria-valuenow', /\d+/);
  await page.getByRole('button', { name: 'Unfreeze column A', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Freeze column A', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('phone view blocks edits and workbook controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'PUT' || request.method() === 'POST') writes.push(request.url()); });
  const grid = page.getByRole('grid');
  await expect(grid).toHaveAttribute('aria-readonly', 'true');
  await expect(page.getByText('View only · Edit on desktop')).toBeVisible();
  const original = await page.locator('#cell-budget-B7 .cell-content').textContent();
  await page.locator('#cell-budget-B7').dblclick();
  await expect(page.locator('.cell-input')).toHaveCount(0);
  await grid.focus();
  for (const key of ['F2', '9', 'Delete', 'Backspace', 'ControlOrMeta+z', 'ControlOrMeta+y', 'Shift+F3']) await page.keyboard.press(key);
  await pasteText(page, '999999');
  await page.evaluate(() => document.querySelector('[role="grid"]')!.dispatchEvent(Object.defineProperty(new ClipboardEvent('cut', { bubbles: true, cancelable: true }), 'clipboardData', { value: new DataTransfer() })));
  await expect(page.locator('#cell-budget-B7 .cell-content')).toHaveText(original!);
  await expect(page.locator('.cell-input')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.formula-input')).not.toBeEditable();
  for (const name of ['Undo', 'Redo', 'Paste selection', 'Add column', 'Rename this sheet', 'Delete this sheet', 'Add a sheet', 'Functions', 'Insert function']) {
    await expect(page.getByRole('button', { name, exact: true, includeHidden: true })).toBeDisabled();
  }
  await expect(page.getByRole('separator')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Operating budget' }).dblclick();
  await expect(page.locator('.rename-field')).toHaveCount(0);
  await page.getByRole('button', { name: 'Freeze column A', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unfreeze column A', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset demo fixtures' })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to sheet' }).click();
  await page.waitForTimeout(1200); // Freezing on a phone must not start the debounced save.
  expect(writes).toEqual([]);
  await goTo(page, 'L10000');
  await expect(page.locator('#cell-budget-L10000')).toBeVisible();
  await page.getByRole('tab', { name: 'Formula diagnostics' }).click();
  await expect(grid).toHaveAttribute('aria-label', 'Formula diagnostics spreadsheet');
});

test('large paste is bounded, undoable and horizontally virtualized', async ({ page }) => {
  await goTo(page, 'A1');
  await pasteText(page, Array.from({ length: 100 }, () => Array(500).fill('2').join('\t')).join('\n'));
  await expect(page.getByRole('grid')).toHaveAttribute('aria-colcount', '501');
  expect(await page.locator('.column-heading').count()).toBeLessThan(25);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await goTo(page, 'A1');
  await expect(page.locator('#cell-budget-A1 .cell-content')).toHaveText('Northline Studio');
});

test('guide traps focus and Escape returns to its button', async ({ page }) => {
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Back to sheet' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts', exact: true })).toBeFocused();
});

test('internal formulas shift, external text stays literal, range fill undoes once', async ({ page }) => {
  await goTo(page, 'A1');
  await pasteText(page, '=B1+$C$1');
  await page.evaluate(() => {
    const data = new DataTransfer();
    document.querySelector('[role="grid"]')!.dispatchEvent(Object.defineProperty(new ClipboardEvent('copy', { bubbles: true, cancelable: true }), 'clipboardData', { value: data }));
    (window as Window & { tallyTestClipboard?: DataTransfer }).tallyTestClipboard = data;
  });
  await goTo(page, 'A2');
  await page.evaluate(() => {
    const data = (window as Window & { tallyTestClipboard?: DataTransfer }).tallyTestClipboard;
    document.querySelector('[role="grid"]')!.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { bubbles: true, cancelable: true }), 'clipboardData', { value: data }));
  });
  await expect(page.locator('.formula-input')).toHaveValue('=B2+$C$1');
  await goTo(page, 'A3'); await pasteText(page, '=B1+$C$1');
  await expect(page.locator('.formula-input')).toHaveValue('=B1+$C$1');
  await page.getByRole('grid').focus();
  await page.keyboard.press('Shift+ArrowDown');
  await pasteText(page, 'same');
  await expect(page.locator('#cell-budget-A3 .cell-content')).toHaveText('same');
  await expect(page.locator('#cell-budget-A4 .cell-content')).toHaveText('same');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#cell-budget-A4 .cell-content')).toHaveText('Revenue & operating plan');
});

test('native phone touch drag and swipe scrolling', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'phone', 'native touch through the Chromium device protocol');
  await goTo(page, 'A1');
  await page.getByRole('button', { name: 'Freeze column A', exact: true }).click();
  const source = await page.getByRole('button', { name: 'Extend selection' }).boundingBox();
  const destination = await page.locator('#cell-budget-B3').boundingBox();
  const client = await page.context().newCDPSession(page);
  const x = source!.x + source!.width / 2, y = source!.y + source!.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: destination!.x + 20, y: destination!.y + 16 }] });
  await expect(page.locator('.status-range')).toHaveText('A1:B3');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await goTo(page, 'A1');
  const grid = await page.getByRole('grid').boundingBox();
  const frozenX = (await page.locator('#cell-budget-A1').boundingBox())!.x;
  for (const direction of [-1, 1]) {
    const startX = direction === -1 ? 370 : 280;
    const swipeY = grid!.y + 180;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: swipeY }] });
    for (let step = 1; step <= 6; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + direction * step * 20, y: swipeY }] });
      expect((await page.locator('#cell-budget-A1').boundingBox())!.x).toBeCloseTo(frozenX, 0);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (direction === -1) await expect.poll(() => page.getByRole('grid').evaluate(element => element.scrollLeft)).toBeGreaterThan(20);
  }
  const startY = grid!.y + 300;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: startY }] });
  for (let step = 1; step <= 5; step++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: startY - step * 30 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.getByRole('grid').evaluate(element => element.scrollTop)).toBeGreaterThan(20);
});

test('native keyboard clipboard preserves internal formula references', async ({ page }) => {
  await goTo(page, 'A1');
  const formula = page.getByRole('textbox', { name: 'Raw value of A1' });
  await formula.fill('=B1+$C$1'); await formula.press('Enter');
  await page.getByRole('grid').focus();
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.formula-input')).toHaveValue('=B2+$C$1');
  await page.getByRole('grid').focus();
  await page.keyboard.press('ControlOrMeta+x');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.formula-input')).toHaveValue('=B2+$C$1');
  await expect(page.locator('#cell-budget-A2 .cell-content')).toHaveText('');
});

test('edits made during a save survive the older response and reload', async ({ page }) => {
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let writes = 0;
  let saved: unknown;
  await page.route('**/api/workbook/studio', async route => {
    if (route.request().method() === 'PUT') {
      const snapshot = route.request().postDataJSON();
      writes++;
      if (writes === 1) await firstGate;
      saved = snapshot;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: snapshot.updatedAt }) });
    } else if (saved) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) });
    else await route.continue();
  });
  const firstRequest = page.waitForRequest(request => request.method() === 'PUT');
  await page.locator('.formula-input').fill('77777');
  await page.locator('.formula-input').press('Enter');
  await firstRequest;
  await page.locator('.formula-input').fill('88888');
  await page.locator('.formula-input').press('Enter');
  releaseFirst();
  await expect.poll(() => writes).toBe(2);
  await expect(page.getByRole('button', { name: 'All changes saved', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#cell-budget-B7 .cell-content')).toHaveText('88888');
});

test('the last sheet stays available and deleting another sheet can be undone', async ({ page }) => {
  await page.getByRole('button', { name: 'Delete this sheet' }).click();
  await page.getByRole('button', { name: 'Delete this sheet' }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Delete this sheet' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Delete this sheet' })).toBeEnabled();
});

test('A–Z is available by default and sheet tabs have no decorative boxes', async ({ page }) => {
  await expect(page.getByRole('grid')).toHaveAttribute('aria-colcount', '27');
  await goTo(page, 'Z1');
  await expect(page.getByRole('button', { name: 'Select column Z', exact: true })).toBeVisible();
  await expect(page.locator('.tab-square')).toHaveCount(0);
  expect(await page.locator('.column-heading').count()).toBeLessThan(20);
});

test('pasted HTML cannot execute code or request remote resources', async ({ page }) => {
  const requests: string[] = [];
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.route('https://clipboard-test.invalid/**', async route => {
    requests.push(route.request().url()); await route.abort();
  });
  await goTo(page, 'A1');
  await pasteText(page, '', `<table><tr><td onclick="alert('clicked')">safe<br>line<script>alert('script')</script><img src="https://clipboard-test.invalid/image" onerror="alert('image')"><iframe src="https://clipboard-test.invalid/frame"></iframe><svg onload="alert('svg')"><image href="https://clipboard-test.invalid/svg"/></svg><style>@import url('https://clipboard-test.invalid/style');</style></td><td><a href="javascript:alert('link')">link text</a></td></tr></table>`);
  await expect(page.locator('#cell-budget-A1 .cell-content')).toHaveText('safe line');
  await expect(page.locator('#cell-budget-B1 .cell-content')).toHaveText('link text');
  await page.locator('#cell-budget-A1').click();
  await expect(page.locator('.grid-canvas script, .grid-canvas img, .grid-canvas iframe, .grid-canvas svg, .grid-canvas a')).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(requests).toEqual([]);
  await pasteText(page, '<img src=x onerror=alert(1)>');
  await expect(page.locator('#cell-budget-A1 .cell-content')).toHaveText('<img src=x onerror=alert(1)>');
});

test('unsupported and oversized pasted formulas show errors without breaking the grid', async ({ page }) => {
  await goTo(page, 'A1');
  await pasteText(page, '=WEBSERVICE("https://clipboard-test.invalid")\t=SUM(A1:XFD10000)\t=javascript:alert(1)');
  for (const address of ['A1', 'B1', 'C1']) await expect(page.locator(`#cell-budget-${address} .cell-content`)).toHaveText(/#(ERROR|REF)!/);
  await goTo(page, 'D1');
  await page.locator('.formula-input').fill('still editable');
  await page.locator('.formula-input').press('Enter');
  await expect(page.locator('#cell-budget-D1 .cell-content')).toHaveText('still editable');
});

test('foreign websites cannot save or reset the workbook', async ({ request }) => {
  const headers = { origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' };
  expect((await request.put('/api/workbook/studio', { headers, data: {} })).status()).toBe(403);
  expect((await request.post('/api/reset', { headers })).status()).toBe(403);
});

test('function picker searches, previews arguments and inserts one undoable formula', async ({ page }) => {
  await goTo(page, 'B1');
  await page.getByRole('button', { name: 'Functions', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert function', exact: true });
  await expect(dialog).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search for a function' }).fill('average');
  await dialog.getByRole('button', { name: /^AVERAGE / }).click();
  await page.getByRole('textbox', { name: 'Number 1', exact: true }).fill('10');
  await page.getByRole('button', { name: 'Add argument', exact: true }).click();
  await page.getByRole('textbox', { name: 'Number 2', exact: true }).fill('20');
  await expect(dialog.locator('.function-preview')).toContainText('15');
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator('.formula-input')).toHaveValue('=AVERAGE(10,20)');
  await expect(page.locator('#cell-budget-B1 .cell-content')).toHaveText('15');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.formula-input')).toHaveValue('');
});

test('clicking fx edits existing arguments and cancel does not change the cell', async ({ page }) => {
  await goTo(page, 'E7');
  await page.getByRole('button', { name: 'Insert function', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert function', exact: true });
  await expect(page.getByRole('textbox', { name: 'Number 1', exact: true })).toHaveValue('B7:D7');
  await page.getByRole('textbox', { name: 'Number 1', exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.formula-input')).toHaveValue('=SUM(B7:D7)');
  await page.getByRole('grid').focus();
  await page.keyboard.press('Shift+F3');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('formula bar suggests SUM and shows active function parameters', async ({ page }) => {
  await goTo(page, 'B1');
  const input = page.locator('.formula-input');
  await input.fill('=SU');
  await expect(page.getByRole('option', { name: /^SUM / })).toBeVisible();
  await input.press('Tab');
  await expect(input).toHaveValue('=SUM()');
  await expect(page.locator('.function-parameters')).toContainText('Argument 1');
  await input.pressSequentially('10,');
  await expect(page.locator('.function-parameters')).toContainText('Argument 2');
  await input.pressSequentially('20');
  await input.press('Enter');
  await expect(page.locator('#cell-budget-B1 .cell-content')).toHaveText('30');
});

test('cell editor completes nested functions and supports pointer selection', async ({ page }) => {
  await goTo(page, 'B1');
  await page.getByRole('grid').focus();
  await page.keyboard.press('=');
  const input = page.locator('.cell-input');
  await input.pressSequentially('SU');
  await page.getByRole('option', { name: /^SUM / }).click();
  await expect(input).toHaveValue('=SUM()');
  await input.pressSequentially('AV');
  await input.press('ArrowDown');
  await input.press('Tab');
  await expect(input).toHaveValue('=SUM(AVG())');
  await input.pressSequentially('10,20');
  await input.press('Enter');
  await expect(page.locator('#cell-budget-B1 .cell-content')).toHaveText('15');
});

test('cancelling a circular preview preserves cells and unfinished formula text', async ({ page }) => {
  await goTo(page, 'A1');
  await page.locator('.formula-input').fill('10'); await page.locator('.formula-input').press('Enter');
  await goTo(page, 'B1');
  await page.locator('.formula-input').fill('=A1+1'); await page.locator('.formula-input').press('Enter');
  await expect(page.locator('#cell-budget-B1 .cell-content')).toHaveText('11');
  await goTo(page, 'A1');
  await page.getByRole('button', { name: 'Insert function', exact: true }).click();
  await page.getByRole('textbox', { name: 'Number 1', exact: true }).fill('B1');
  await expect(page.locator('.function-preview')).toContainText('#CYCLE!');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#cell-budget-B1 .cell-content')).toHaveText('11');
  await goTo(page, 'C1');
  await page.locator('.formula-input').fill('=SU');
  await page.getByRole('button', { name: 'Insert function', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.formula-input')).toHaveValue('=SU');
  await expect(page.locator('.formula-input')).toBeFocused();
  await page.locator('.formula-input').press('Escape');
  await page.locator('.formula-input').press('Escape');
  await expect(page.locator('#cell-budget-C1 .cell-content')).toHaveText('');
});


test('frozen column stays fixed before scroll events render', async ({ page }) => {
  await goTo(page, 'A1');
  await page.getByRole('button', { name: 'Freeze column A', exact: true }).click();
  await goTo(page, 'B1'); // The active scrolling cell must also pass behind frozen A.
  const samples = await page.getByRole('grid').evaluate(element => {
    const cell = document.querySelector('#cell-budget-A1')!;
    const header = document.querySelector('.column-heading.frozen-column')!;
    const rowNumber = document.querySelector('.row-number')!;
    const x = cell.getBoundingClientRect().x;
    return [0, 80, 300, 900, element.scrollWidth - element.clientWidth, 400, 20, 0].map(left => {
      // Read synchronously: React cannot compensate for scrollLeft before this measurement.
      element.scrollLeft = left;
      const rect = cell.getBoundingClientRect();
      const covering = document.elementFromPoint(rect.right - 20, rect.top + 10)?.closest('[role=gridcell]')?.id;
      return { covering, cell: cell.getBoundingClientRect().x - x, header: header.getBoundingClientRect().x - x, row: rowNumber.getBoundingClientRect().x - element.getBoundingClientRect().x };
    });
  });
  for (const sample of samples) {
    expect(sample.covering).toBe('cell-budget-A1');
    expect(sample.cell).toBeCloseTo(0, 1);
    expect(sample.header).toBeCloseTo(0, 1);
    expect(sample.row).toBeCloseTo(0, 1);
  }
  await page.getByRole('button', { name: 'Unfreeze column A', exact: true }).click();
  const delta = await page.getByRole('grid').evaluate(element => {
    const cell = document.querySelector('#cell-budget-A1')!;
    element.scrollLeft = 0;
    const before = cell.getBoundingClientRect().x;
    element.scrollLeft = 100;
    return cell.getBoundingClientRect().x - before;
  });
  expect(delta).toBeCloseTo(-100, 1);
});

test('phone landscape stays view only and tablet editing returns', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'phone', 'Requires a phone touch context.');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
  await expect(page.locator('.formula-input')).not.toBeEditable();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('grid')).toHaveAttribute('aria-readonly', 'false');
  await page.getByRole('grid').focus();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Edit B7' }).fill('tablet draft');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.cell-input')).toHaveCount(0);
  await expect(page.locator('#cell-budget-B7 .cell-content')).toHaveText('43000');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('.formula-input').fill('60000');
  await page.locator('.formula-input').press('Enter');
  await expect(page.locator('#cell-budget-B7 .cell-content')).toHaveText('60000');
});
