# Checks

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
```

For individual browser profiles:

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
npx playwright test --project=tablet
npx playwright test --project=phone
```

## Coverage

The Node suite checks formulas, dependency invalidation, errors, absolute references, quoted clipboard text, paste limits, column growth, sheet deletion, column history and the deterministic fixtures.

Browser checks cover keyboard editing, the budget formula chain, paste/undo, HTML sanitization, multiline values, relative formula shifts, range fill, native keyboard copy/paste, sheet add/rename/delete, save failure recovery, unfrozen defaults, autofit, 10,000-row scrolling, wide-sheet virtualization and keyboard access to the guide.

The phone profile uses Chromium with touch enabled. It checks a real touch range drag and a swipe through the device protocol, as well as the shared editing tests. Synthetic pointer tests also run on the other profiles. Firefox removes clipboard data from constructed ClipboardEvents, so the synthetic clipboard fixture supplies that property explicitly. The native keyboard clipboard test exercises the browser's actual copy/paste path separately.

I also checked desktop, dark mobile, 320px mobile and short landscape layouts for page overflow and browser errors. Browser emulation does not replace checking a real iPhone or Android device.

## Results on this machine

Type checking, lint, all 22 Node tests and the production build passed. Across the full and targeted regression runs, all 76 applicable browser cases passed: 25 each in desktop Chromium and Firefox, and 26 in the touch-enabled phone profile. After fixing an intermittent completion-caret issue, formula-bar and cell-editor completion also passed 18 repeated checks across the three profiles. The native touch test runs only on the phone profile and is skipped on the two desktop profiles.

WebKit and the WebKit tablet profile could not run on this Fedora host. The downloaded Ubuntu browser build needs libicu74 and libjpeg-turbo8, which are not installed. Safari and Opera still need a manual pass. The WebKit profiles remain in the configuration for a compatible machine.

## Manual pass

- On a physical phone, swipe both axes, drag the active-cell dot, edit in the formula bar and try the native paste menu.
- Copy from Excel, Sheets and a website table. Check a quoted multiline value and text containing markup. Pasted fonts, colors and images are intentionally excluded.
- Start a save, edit again while it is running, then reload after the newer revision finishes.
- Try a failed save and Retry. If local browser storage fills, save before closing the tab.
- Delete a sheet, undo, and check that its values, width settings and original tab position return.
- Focus a column edge: arrows resize, Enter fits. Check mouse double-click too.
- Check light/dark contrast and keyboard focus in Safari and Opera.

## Limits

There are 10,000 rows, up to 16,384 columns and 15 sheets. A paste accepts up to 50,000 cells and 5 MB of text; each value is limited to 4,000 characters. A formula range is limited to 120,000 cells. A persisted workbook is capped at 15 MB, while browser recovery storage depends on the browser's quota. Copying more than 50,000 selected cells asks for a smaller selection.

There is no file import/export, per-cell styling, image paste, cross-sheet formula support or external database. The slow save and random failures are intentional and remain enabled.

## Security and A–Z follow-up

Added checks for inert HTML paste with scripts, event attributes, SVG, remote images, iframes and stylesheet URLs; these assert that no injected code runs and no remote request is made. Other regressions cover unsupported formulas, excessive dependency work, deep reference chains, canonical saved addresses, rejected prototype keys and cross-origin save/reset requests. Sheets now start with 26 columns, and tab labels have no decorative squares. The emoji scan found none in source, docs or tests.

The production dependency audit reported zero known vulnerabilities. This is a dependency advisory check and a targeted code review, not a claim of complete application security. Authentication remains excluded by the brief.

The production scroll sample at 1440×900 jumped through the 10,000-row sheet in 20 steps. At most 34 rows and 11 columns were mounted, with no browser errors. Desktop and 390px mobile layouts had no horizontal page overflow. These checks confirm bounded rendering; they do not guarantee a frame rate on every device.

## Function entry

Added checks for the shared function catalog, Excel's AVERAGE name and the AVG alias, completion before existing parentheses, nested parameter positions, input length limits and isolated preview caches. Browser cases cover searching the picker, adding arguments, result previews, one-step undo, clickable ƒx, Shift+F3, keyboard and pointer completion, nested functions, and cancellation with an unfinished draft.
