# Tally

A small spreadsheet built with Next.js, React and TypeScript. I wrote the grid and formula engine without spreadsheet libraries or a component kit.

## Run it

Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. To restore the budget, 10,000-row orders sheet and formula diagnostics:

```bash
npm run reset
```

Reload after resetting.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
```

## Controls

- Click a cell, drag a range, or extend with Shift and the arrow keys. Row and column headings select whole rows and columns.
- Use Functions in the navbar or click ƒx beside the formula bar to search functions, fill argument fields and preview the result. Shift+F3 opens the same picker.
- Type `=SU` and press Tab or Enter to complete `SUM()`. Arrow keys browse suggestions; parameter hints show the current argument, including inside nested functions. This works in cells and the formula bar.
- Available functions: `SUM`, `AVERAGE`, and `AVG` as an alias for `AVERAGE`. Arithmetic, parentheses, ranges and dollar-anchored cell references also work.
- Type to replace a value, double-click or press F2 to edit it. Enter saves; Escape cancels. Editing is available on desktop and tablet. Phones are view-only, including in landscape; the formula bar shows the selected cell's raw value.
- On touchscreens, swipe to scroll and drag the dot on the active cell to extend a selection. On phones, navigation, selection, copy and sheet switching remain available; paste, resizing and workbook changes are disabled. Freeze column A is a local viewing preference on phones and does not trigger a save.
- Enter an address in the box beside the formula bar to jump there. The URL tracks the sheet and active cell.
- Copy, cut and paste with the usual keyboard shortcuts. Copy and Paste buttons are also available; browser clipboard permissions apply.
- Paste tab-separated text or an HTML table. Quoted tabs and line breaks stay in their cells. Pasting one value into a selected range fills it. Each paste is one undo step.
- Sheets start with 26 columns (A–Z) and 10,000 rows. Paste or navigate beyond column Z to reveal more columns, or use Add column. The last supported column is XFD.
- Drag a column edge to resize. Double-click it to fit its contents, or focus the edge and press Enter. Column A starts unfrozen; the toolbar can freeze it. Native sticky positioning keeps the frozen header and cells fixed during horizontal touch scrolling.
- Add sheets with the plus beside the tabs. Rename from the toolbar or by double-clicking a tab. Delete sheet is undoable, and the last sheet cannot be deleted.

## Notes

Saving intentionally takes 350–1,500 ms and fails around one time in five, as required by the test. A browser recovery copy keeps pending edits; Retry sends them again. The server stores JSON in `.data`, so it needs a writable Node.js host.

I kept the test's exclusions: no file import/export, per-cell formatting, image paste, charts, collaboration, authentication or external database. Paste handles values and formulas, not Excel styling. More implementation notes are in [docs/DESIGN.md](docs/DESIGN.md), with checks and limits in [docs/QA.md](docs/QA.md).

## Clipboard and security

Pasted HTML is parsed inside an inert template and reduced to text. Scripts, event handlers, remote images and embedded content are never mounted in the grid. Copy escapes HTML, and formulas run through a restricted parser with limits on dependency size and depth. Unsupported functions cannot run JavaScript or fetch URLs.

Clipboard input is limited to 5 MB and 50,000 cells. Saves and resets reject requests from other website origins. This is still a local demo without authentication: anyone who can directly reach the server can read it, and a script can call its API. Keep it local; the clipboard protections do not make it an internet-ready private workbook.
