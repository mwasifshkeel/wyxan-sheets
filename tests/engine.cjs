const test = require('node:test');
const assert = require('node:assert/strict');
const { FormulaEngine, displayValue } = require('../out-test/lib/formulas.js');
const { createFixtures } = require('../out-test/lib/fixtures.js');
const { History, applyEntry } = require('../out-test/lib/history.js');
const { addressAt, parseAddress, bounds, columnLabel } = require('../out-test/lib/address.js');
const { parsePastedText, pasteChanges, shiftFormula, selectionToTsv } = require('../out-test/lib/clipboard.js');

test('cell addressing respects grid bounds', () => {
  assert.equal(columnLabel(11), 'L');
  assert.equal(addressAt(9999, 11), 'L10000');
  assert.deepEqual(parseAddress('$B$7'), { row: 6, col: 1 });
  assert.equal(parseAddress('XFE99999'), null);
  assert.equal(parseAddress('L10001'), null);
});

test('formula parser uses mathematical precedence and parentheses', () => {
  const engine = new FormulaEngine({ A1: '=2+3*4', A2: '=(2+3)*4', A3: '=-4+10/2', A4: '=1.5e2+5' });
  assert.equal(engine.evaluate('A1'), 14);
  assert.equal(engine.evaluate('A2'), 20);
  assert.equal(engine.evaluate('A3'), 1);
  assert.equal(engine.evaluate('A4'), 155);
});

test('cell references and ranges recalculate only affected dependents', () => {
  const engine = new FormulaEngine({ A1: '2', A2: '3', B1: '=SUM(A1:A2)', C1: '=B1*2', D1: '100' });
  assert.equal(engine.evaluate('C1'), 10);
  assert.equal(engine.evaluate('D1'), '100');
  const changed = engine.patch([{ address: 'A1', after: '7' }]);
  assert.deepEqual([...changed].sort(), ['A1', 'B1', 'C1']);
  assert.equal(engine.evaluate('C1'), 20);
  assert.equal(engine.evaluate('D1'), '100');
});

test('average and blank cells behave correctly', () => {
  const engine = new FormulaEngine({ A1: '10', A2: '20', A3: 'text', B1: '=AVG(A1:A4)', B2: '=SUM(A1:A4)', B3: '=AVG(A1,A4)', B4: '=SUM(A3,A4)' });
  assert.equal(engine.evaluate('B1'), 15);
  assert.equal(engine.evaluate('B2'), 30);
  assert.equal(engine.evaluate('B3'), 10);
  assert.equal(engine.evaluate('B4'), 0);
});

test('cycle, bad reference, division by zero and propagated failure', () => {
  const engine = new FormulaEngine({ A1: '=B1+1', B1: '=A1+1', C1: '=XFE99999', D1: '=10/0', E1: '=D1+1', F1: '=UNSUPPORTED(5)' });
  assert.equal(engine.evaluate('A1'), '#CYCLE!');
  assert.equal(engine.evaluate('B1'), '#CYCLE!');
  assert.equal(engine.evaluate('C1'), '#REF!');
  assert.equal(engine.evaluate('D1'), '#DIV/0!');
  assert.equal(engine.evaluate('E1'), '#DIV/0!');
  assert.equal(engine.evaluate('F1'), '#ERROR!');
});

test('repairing a formula removes the dependency cycle', () => {
  const engine = new FormulaEngine({ A1: '=B1+1', B1: '=A1+1' });
  assert.equal(engine.evaluate('A1'), '#CYCLE!');
  engine.patch([{ address: 'B1', after: '4' }]);
  assert.equal(engine.evaluate('A1'), 5);
});

test('absolute references and formula shifts preserve anchors', () => {
  assert.equal(shiftFormula('=A1+$B$2+C$3+$D4', 2, 1), '=B3+$B$2+D$3+$D6');
  assert.equal(new FormulaEngine({ A1: '8', B1: '=$A$1*3' }).evaluate('B1'), 24);
});

test('paste treats content as data and one block becomes one transaction', () => {
  const matrix = parsePastedText('12\t=<img src=x>\r\n<script>alert(1)</script>\t33\n');
  assert.equal(matrix.length, 2);
  const edits = pasteChanges({ A1: 'old' }, matrix, { row: 0, col: 0 });
  assert.equal(edits.length, 4);
  assert.equal(edits[2].after, '<script>alert(1)</script>');
  const workbook = { id: 'studio', name: 'Test', updatedAt: 1, sheets: [{ id: 'budget', name: 'Budget', cells: {}, widths: [], frozen: true }] };
  const history = new History();
  const entry = { kind: 'cells', sheetId: 'budget', changes: edits };
  history.record(entry);
  const updated = applyEntry(workbook, entry);
  assert.equal(updated.sheets[0].cells.B1, '=<img src=x>');
  assert.equal(history.undo(updated).sheets[0].cells.A1, 'old');
  assert.equal(history.redo(workbook).sheets[0].cells.A1, '12');
});

test('new edit clears redo history', () => {
  const history = new History();
  const book = { id: 'studio', name: 'Test', updatedAt: 1, sheets: [{ id: 'budget', name: 'Budget', cells: {}, widths: [], frozen: true }] };
  history.record({ kind: 'cells', sheetId: 'budget', changes: [{ address: 'A1', before: '', after: '1' }] });
  history.undo(book);
  assert.equal(history.canRedo, true);
  history.record({ kind: 'cells', sheetId: 'budget', changes: [{ address: 'A2', before: '', after: '2' }] });
  assert.equal(history.canRedo, false);
});

test('selection TSV returns cell raw values', () => {
  assert.equal(selectionToTsv({ anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } }, { A1: '1', B1: '=A1+2', A2: 'text' }), '1\t=A1+2\ntext\t');
  assert.deepEqual(bounds({ anchor: { row: 5, col: 4 }, focus: { row: 1, col: 1 } }), { top: 1, bottom: 5, left: 1, right: 4 });
});

test('deterministic fixtures include 10,000 rows and layered budget formulas', () => {
  const workbook = createFixtures();
  const [budget, orders, diagnostics] = workbook.sheets;
  assert.equal(budget.cells.E10, '=SUM(E7:E9)');
  assert.equal(budget.cells.E30, '=E29+E26');
  assert.equal(orders.cells.L9999.startsWith('='), true);
  assert.equal(orders.cells.L10000, '=SUM(L2:L9999)');
  const total = new FormulaEngine(orders.cells).evaluate('L10000');
  assert.equal(typeof total, 'number');
  assert.ok(Number.isFinite(total));
  assert.equal(new FormulaEngine(diagnostics.cells).evaluate('B5'), '#CYCLE!');
});

test('formatting has stable numeric precision', () => {
  assert.equal(displayValue(12456.78945), '12,456.7895');
  assert.equal(displayValue('#REF!'), '#REF!');
});
