# How I built it

I kept the sheet as the main screen. The active sheet name and workbook name sit in the top bar, followed by tools and the formula bar. There is no separate title section taking space from the cells. Tabs and selection statistics stay at the bottom.

The green accent marks the active cell, selected headers and current tab. Formula results use blue; errors use red. The rest is neutral so a dense sheet is still readable. Light and dark themes use the same layout and follow the system until toggled. Fonts are local system fonts, so opening the sheet does not depend on a font download.

On phones, the toolbar scrolls horizontally when needed, while the sheet scrolls independently. The title stays visible in the navbar. Inputs use 16px text to avoid zooming when editing on iOS. Swiping scrolls the grid; the active cell's handle starts a range drag. That keeps touch scrolling and selection from fighting over the same gesture. The formula bar supports single-cell editing and native text paste on mobile.

## Data and rendering

A workbook holds ordered sheets. Each sheet has a sparse map of raw cell strings, column widths and an optional frozen first column. Selection and unfinished edits stay in the view. Displayed formula results are derived, never saved over the raw formulas.

Every sheet has 10,000 rows and starts with 26 columns (A–Z). Column widths grow when a paste or edit reaches further right. Navigation can reveal an empty column without saving a change; Add column explicitly saves one. Addresses stop at XFD10000. Both axes are virtualized, so a wide paste does not mount thousands of columns per row.

The grid keeps row numbers and column headings visible. Only column A can be frozen, and it is off by default. Autofit measures computed cell text with canvas and clamps widths to 64–600px.

## Formulas

The parser supports arithmetic, parentheses, unary signs, relative and absolute cell references, ranges, SUM and AVERAGE. AVG remains a legacy alias for AVERAGE. There is no eval. The engine records dependencies and reverse dependencies, caches results, and invalidates only the cells affected by a change. Cycles, invalid references and division by zero produce cell errors.

A formula can visit at most 120,000 referenced cells across its arguments. The sheet has a 500,000-edge dependency budget; expressions deeper than 128 nodes or reference chains deeper than 256 cells return a cell error. These limits are checked before expanding ranges, so repeated large formulas cannot allocate an unbounded graph. Cross-sheet references, named ranges and a larger function catalogue are outside this test.

## Clipboard and history

Text paste understands spreadsheet TSV, including quoted cells containing tabs, quotes or newlines. HTML-only tables are parsed inside an inert template and reduced to cell text. Scripts, styles, remote images and embedded elements are removed; pasted markup is never inserted into the app DOM. Line breaks become cell text. Plain text that looks like markup stays literal text.

A paste is capped at 50,000 cells and clipboard text at 5 MB. Cell strings are limited to 4,000 characters. Anything outside the sheet bounds is clipped with a visible message. Copy has the same cell-count cap so selecting an entire large sheet does not build a huge clipboard string.

An internal clipboard token identifies formulas copied from Tally and shifts relative references on paste. Copy writes both TSV and an escaped HTML table. The HTML carries the same token because Firefox drops custom clipboard MIME types. Dollar-anchored references stay fixed. Cut keeps formula text unchanged when moved. Firefox can send native clipboard events to the document instead of the focused grid. A document listener forwards those events only when the grid has focus and the event has not already been handled. The browser can deny clipboard API access; keyboard shortcuts and the formula bar remain available.

History records changes with before and after values. Paste and range clear each take one step. Sheet creation, deletion, renaming, column addition, resizing and freezing also have inverses. Deletion stores the sheet and its position so undo restores its contents and order. A new edit clears redo.

## Saving

GET and PUT `/api/workbook/studio` load and save the workbook. PUT validates the payload and atomically replaces a local JSON file. The deliberate delay and 20% random failure remain enabled.

Before a save, edits go into browser storage. Only one request runs at a time. If another edit happens during a request, its revision is queued and the older response cannot clear the newer recovery copy. A failed request leaves a Retry control. Reload chooses the newer server or browser copy.

This is file-backed storage for a local Node.js server. It is not shared editing or durable serverless storage. The workbook limit is 15 sheets and 15 MB. Browser storage has its own smaller quota; if it fills, the UI asks the user to save before closing.

## Scope

The brief excludes file import/export and per-cell formatting, so XLSX/CSV opening, fonts, colors and image paste are intentionally absent. There are no grid, formula or component libraries. The fixtures and simulated save failures stay repeatable enough to demonstrate the original test.

## Performance and safety checks

Number formatting reuses one Intl formatter. Selection statistics reuse an index of populated cell positions, so moving through the 10,000-row sheet does not repeatedly parse every address. Plain values do not allocate empty formula dependency sets. Both grid axes still render only their visible windows.

The save and reset routes reject foreign Origin headers and cross-site browser requests. That prevents another website from using the browser to reset the local demo. It is not authentication: a direct API caller can still access this deliberately local, unauthenticated workbook.

## Finding and entering functions

The navbar's Functions button and the formula bar's ƒx button open the same Insert Function dialog. Shift+F3 opens it from the keyboard. The list, descriptions, aliases and evaluator share one catalog, so the UI only offers functions that actually run.

The dialog accepts separate number/range arguments, shows the generated formula and previews its result using current cell values. Preview parses a temporary expression without rewriting cells or constructing another workbook engine. Insert applies one normal, undoable cell edit; Cancel leaves the saved cell value alone.

Both cell editing and the formula bar use the same input component. A prefix such as `=SU` opens a short suggestion list. Tab, Enter or a tap accepts the selected function, adds parentheses and puts the caret inside. The input tracks nested calls and commas to explain the current parameter. Escape dismisses suggestions before cancelling the edit. The assistance sits above the grid in a positioned portal so row clipping cannot hide it.
