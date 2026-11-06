# Quality verification

## Local commands

```bash
npm install
npm run typecheck
npm run test
npm run lint
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
```

To test only Chromium:

```bash
npm run test:e2e:chromium
```

## Automated coverage

The Node test suite covers address bounds, formula precedence, ranges, SUM, AVG, dependency invalidation, cycles, invalid references, divide-by-zero, recovery from cycles, internal formula shifts, pasted text, undo and redo, selection TSV, and deterministic 10,000-row fixtures.

The Playwright suite exercises keyboard editing, dependent formulas, block paste and undo, broken formulas, missing sheets, row virtualization, save failures and recovery, theme switching and narrow layouts. It is configured for Chromium, Firefox, WebKit and a tablet WebKit profile.

The pure TypeScript test suite was run during package creation and passed. Full Next.js build and the browser suite were not executable in the packaging environment because the npm registry was inaccessible. Run the commands above after installing dependencies and resolve any failures before submitting.

## Manual browser matrix

| Target | Widths | Checks |
| :-- | :-- | :-- |
| Chrome / Chromium | 1440, 1024 | Keyboard editing, paste, drag selection, frozen column, resize |
| Firefox | 1440, 820 | Caret focus, clipboard, grid scrolling, light and dark |
| Safari on macOS | 1440, 820 | Sticky behavior, pointer resizing, clipboard, history |
| Opera desktop | 1440, 820 | Clipboard permission and sticky columns |
| Mobile Safari / Chrome | 390, 430 | Read-only banner, horizontal scroll, no clipped navigation |

Automated WebKit checks approximate the Safari rendering engine but do not replace testing the installed Safari browser. Opera shares Chromium's engine but should still be verified for clipboard permissions and user-agent-specific behavior.

## Manual edge cases

1. Select a range by drag, extend with Shift and verify the status bar numbers.
2. Paste a 2 by 3 block from a plain text editor and undo it once.
3. Paste text containing `<script>` and confirm it remains visible as text rather than executing.
4. Paste a block with more than 50,000 cells and verify the operation is bounded.
5. Copy a formula internally and verify relative references shift and dollar-anchored references do not.
6. Change a formula while another save is running, then verify the final value survives reload.
7. Produce a server failure, confirm the red retry state, reload and use Retry.
8. Visit `/s/unknown?cell=A1` and verify the missing-sheet screen.
9. Move to row 10,000 and verify only a small window of grid rows is in the DOM.
10. Toggle dark mode, check focus rings and verify page layout with reduced motion enabled.

## Known limits

A single paste is capped at 50,000 cells and clipped to the 12-column, 10,000-row grid. File-backed saving requires a writable local Node.js host. This frontend test does not implement cross-sheet formulas or file upload/export.
