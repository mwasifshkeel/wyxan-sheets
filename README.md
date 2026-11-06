# Tally

A responsive spreadsheet workspace built with Next.js App Router, React and TypeScript. The grid, formula engine and interface components are custom implementations.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run reset
```

The reset command restores the three deterministic demo sheets on the next reload.

## Browser testing

```bash
npx playwright install chromium firefox webkit
npm run test:e2e
```

The automated suite covers Chromium, Firefox, WebKit and a WebKit tablet viewport. Safari desktop and Opera should be checked manually as well.

## Using the sheet

Select cells with the mouse or arrows, extend a range with Shift, type to replace, press F2 to edit, or use the formula bar. Copy and paste with Ctrl+C/V or Command+C/V. One paste can be undone in a single step. The status bar shows selection statistics. Double-click a sheet tab to rename it, use the plus button to add a sheet, and use the column heading grip to resize a column.

The workbook contains `Operating budget`, `10k orders` and `Formula diagnostics`. A route path such as `/s/budget?cell=E10` identifies a sheet and selected cell.

## Implementation

The grid virtualizes 10,000 rows. A dependency graph caches formula values and invalidates affected dependents. Raw cells are kept in sparse maps. Reversible transactions support undo and redo. Next.js route handlers load and atomically save workbook JSON. The save handler has an intentional delay and approximately 20% failure rate. A browser recovery copy protects unsaved edits, including changes made during an in-flight save.

See `docs/DESIGN.md` for architecture and design decisions and `docs/QA.md` for checks and limitations.

No grid, spreadsheet, formula, UI kit or chart library is used. A writable Node.js file system is required for server-side persistence.
