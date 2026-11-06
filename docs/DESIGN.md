# Product and architecture

## Product direction

Tally is an editing surface for a small operations team. The grid is the product, not a decorative dashboard. The identity uses a graphite-green palette, narrow borders, restrained contrast and a compact data density. There are no charts, gradient decorations, card collections or distracting animations.

The standout element is the spreadsheet itself: a complete workspace that stays composed while its content changes. Navigation and editing should feel familiar to someone coming from a desktop spreadsheet.

## Design tokens

| Role | Light | Dark |
| :-- | :-- | :-- |
| Page | `#f4f6f5` | `#171f1c` |
| Surface | `#ffffff` | `#202a25` |
| Grid line | `#dce4e0` | `#35433c` |
| Primary text | `#202c28` | `#e8f1ea` |
| Selection | `#e5f2e9` | `#2a4734` |
| Focus/accent | `#267454` | `#70c89b` |
| Formula | `#3c6d9c` | `#94beec` |
| Error | `#af423e` | `#ff9b91` |

Typography uses Avenir Next where available, Segoe UI on Windows and Helvetica Neue or Arial as fallbacks. The type ramp is 11, 12, 13, 16, 23 and 27 px. Spacing uses a 4 px rhythm. Interactive focus remains visible and motion respects reduced-motion preferences.

## Layout

The desktop and tablet hierarchy is:

```text
Brand / workbook name                              Save / theme / guide
Workbook / sheet title
Undo / redo / copy / freeze                          Rename
Address    ƒx    Editable raw value                  Computed result
Row headers  |  Column headers
             |  Virtualized spreadsheet cells
Sheet tabs / add sheet
Ready    Selection range                      Sum / Average / Count
```

On phones the interface remains readable, supports navigation and keeps the grid scrollable. It is intentionally read-only there. There is no attempt to squeeze a full desktop editing interface into a 390 px viewport.

## State and data

- `Workbook` holds ordered sheets and their raw cell maps.
- Each `Sheet` owns raw values, column widths and the frozen-column setting.
- `FormulaEngine` owns parsed formula trees, dependency links, reverse dependency links and an evaluation cache.
- Selection and editing are transient view state, not persisted workbook data.
- The `History` class records reversible transactions. A pasted block is a single transaction.
- Visible cell values are derived, never persisted. Formulas are kept as typed input.

The grid uses fixed-height rows and an overscanned window. The scrollbar represents all 10,000 rows, but the DOM mounts only rows around the current viewport. Columns use stable widths and column A can remain sticky. A single changed input invalidates only its transitive dependents. The cache is repopulated on demand.

## Formula scope

Arithmetic with precedence, parentheses, unary signs, references, absolute references, ranges, SUM and AVG are supported. Invalid references, cycles, division by zero and unsupported formulas produce visible error strings. No eval or dynamic code execution is used.

Formula references are restricted to the 12-column, 10,000-row sheet. Cross-sheet references, named ranges and additional functions were excluded because the brief permits a focused scope.

## Persistence

- GET `/api/workbook/studio` loads the saved workbook or the deterministic fixtures.
- PUT `/api/workbook/studio` persists the full workbook as an atomic local JSON file.
- The handler adds 350 to 1,500 ms of delay and randomly returns a 503 response 20% of the time.
- Edits are recorded in local browser storage before each save begins.
- Only one save can be in flight. If the user edits during that request, a newer revision is queued.
- A failed save stays visible, preserves the local copy and offers a retry.
- On reload the newer of the local recovery copy and the stored server snapshot is used.

This is a local development implementation. File-backed route handler storage requires a writable Node.js host and is not intended for ephemeral serverless deployments.

## Deliberate exclusions

Authentication, shared real-time editing, charts, file import/export, per-cell styling, massive paste beyond 50,000 cells per operation and a comprehensive formula language were left out. They would add surface area without helping the technical-test criteria.

## Accessibility and browsers

The grid provides a single keyboard focus target, active-cell announcements, semantic row and cell roles, visible focus, descriptive tooltips and an input for editing. It uses standard CSS and browser APIs supported in current Chromium, Firefox and WebKit. WebKit tests are a Safari-engine approximation. Actual Safari and Opera desktop verification remains a separate manual check.
