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

The phone profile uses Chromium with touch enabled. It checks a real touch range drag and horizontal/vertical swipes through the device protocol. Editing tests run on desktop and tablet; dedicated phone tests check view-only behavior, blocked mutations, local freeze without save requests, synchronous frozen-column alignment, and phone landscape. Synthetic pointer tests also run on the other profiles. Firefox removes clipboard data from constructed ClipboardEvents, so the synthetic clipboard fixture supplies that property explicitly. The native keyboard clipboard test exercises the browser's actual copy/paste path separately.

I also checked desktop, dark mobile, 320px mobile and short landscape layouts for page overflow and browser errors. Browser emulation does not replace checking a real iPhone or Android device.

## Results on this machine

Type checking, lint, all 22 Node tests and the production build passed. Across the full and targeted regression runs, all 76 applicable browser cases passed: 25 each in desktop Chromium and Firefox, and 26 in the touch-enabled phone profile. After fixing an intermittent completion-caret issue, formula-bar and cell-editor completion also passed 18 repeated checks across the three profiles. The native touch test runs only on the phone profile and is skipped on the two desktop profiles.

WebKit and the WebKit tablet profile could not run on this Fedora host. The downloaded Ubuntu browser build needs libicu74 and libjpeg-turbo8, which are not installed. Safari and Opera still need a manual pass. The WebKit profiles remain in the configuration for a compatible machine.

## Manual pass

- On a physical phone, swipe both axes with column A frozen, reverse direction and check that the header and cells stay aligned. Drag the active-cell dot and switch sheets. Confirm the formula bar is read-only and double-tap, paste, cut and hardware keyboard shortcuts cannot edit. Rotate to landscape; tablet and desktop should remain editable.
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

## Mobile view-only regression

The frozen-column check changes horizontal scroll offsets and reads header/cell coordinates synchronously, before React can process a scroll event. It covers both directions, the far edge, and unfreezing. The phone touch check samples the frozen column during native horizontal swipes, then verifies vertical scrolling. The mutation check watches for PUT/POST requests while attempting edits and toggling the local freeze preference. Browser emulation still needs a physical-device follow-up.

For this mobile change, lint, type checking, the Node suite and the production build passed. Across the full Chromium desktop/phone run and corrected targeted regressions, all 33 applicable cases passed. Desktop editing cases are intentionally skipped in the phone profile. Native touch swipes, phone landscape, tablet editing after resize and frozen-cell layering were exercised in Chromium emulation. No new Safari/physical-device result is claimed.

## Loading, error recovery and navbar reset

The app now shares its loading skeleton between route navigation, workbook fetching and fixture reset. The root error fallback covers layout failures, and route errors offer retry and workbook navigation. App Router uses `not-found.tsx` for the existing 404 page.

New browser cases check delayed workbook loading, 404 recovery, reset progress while a save is pending, restored fixtures after reload, cleared undo/recovery state, cancellation, and a failed reset followed by retry. Reset cancels queued autosaves and waits for an active save before restoring fixtures. Phones retain their view-only reset restriction.

Lint, type checking, the Node suite and the production build passed. The four applicable new browser cases and five existing layout, phone read-only and keyboard-guide regressions passed in installed Google Chrome using desktop and phone profiles; three inapplicable phone cases were skipped. These checks used a temporary Playwright configuration against a production server on localhost because the installed Playwright version's bundled Chromium was unavailable. Desktop, reset progress and 320px phone screenshots were inspected, with no navbar overflow.
