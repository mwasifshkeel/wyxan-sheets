const test = require('node:test');
const assert = require('node:assert/strict');
const { FormulaEngine, displayValue } = require('../out-test/lib/formulas.js');
const { createFixtures } = require('../out-test/lib/fixtures.js');
const { validateWorkbook } = require('../out-test/lib/persistence.js');
const { History, applyEntry } = require('../out-test/lib/history.js');
const { addressAt, parseAddress, bounds, columnLabel } = require('../out-test/lib/address.js');
const { parsePastedText, pasteChanges, shiftFormula, selectionToTsv, selectionToHtml, clipboardToken } = require('../out-test/lib/clipboard.js');

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

test('quoted multiline clipboard cells round-trip and limits stay bounded', () => {
  const selection = { anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } };
  const cells = { A1: 'line one\nline two', B1: 'a\tb', A2: 'say "hello"', B2: 'last' };
  assert.deepEqual(parsePastedText(selectionToTsv(selection, cells)), [['line one\nline two', 'a\tb'], ['say "hello"', 'last']]);
  assert.equal(parsePastedText('x\t'.repeat(50010)).flat().length, 50000);
  assert.equal(parsePastedText('x'.repeat(4500))[0][0].length, 4000);
  const token = '00000000-0000-0000-0000-000000000001';
  const html = selectionToHtml(selection, { A1: '<script>unsafe</script>' }, token);
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.equal(clipboardToken({ getData: type => type === 'text/html' ? html : '' }), token);
  assert.throws(() => parsePastedText('x'.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
  assert.throws(() => selectionToTsv({ anchor: { row: 0, col: 0 }, focus: { row: 9999, col: 11 } }, {}), /50,000/);
});

test('wide paste grows the sheet and formulas can reference columns after L', () => {
  const book = { id: 'studio', name: 'Test', updatedAt: 1, sheets: [{ id: 'budget', name: 'Budget', cells: {}, widths: Array(12).fill(136), frozen: false }] };
  const edits = pasteChanges({}, [['7', '=M1*2']], { row: 0, col: 12 });
  const history = new History();
  const entry = { kind: 'cells', sheetId: 'budget', changes: edits, columnsBefore: 12 };
  history.record(entry);
  const updated = applyEntry(book, entry);
  assert.equal(updated.sheets[0].widths.length, 14);
  assert.equal(new FormulaEngine(updated.sheets[0].cells).evaluate('N1'), 14);
  const undone = history.undo(updated);
  assert.equal(undone.sheets[0].cells.M1, undefined);
  assert.equal(undone.sheets[0].widths.length, 12);
  assert.deepEqual(parseAddress('XFD10000'), { row: 9999, col: 16383 });
  assert.equal(parseAddress('XFE1'), null);
  assert.equal(shiftFormula('=L1+$M$2', 1, 2), '=N2+$M$2');
});

test('sheet deletion restores order and data, and column additions undo', () => {
  const book = createFixtures();
  const entry = { kind: 'delete', sheet: book.sheets[1], index: 1 };
  const history = new History();
  history.record(entry);
  const deleted = applyEntry(book, entry);
  assert.deepEqual(deleted.sheets.map(sheet => sheet.id), ['budget', 'diagnostics']);
  const restored = history.undo(deleted);
  assert.equal(restored.sheets[1].cells.L10000, '=SUM(L2:L9999)');
  assert.equal(history.redo(restored).sheets.length, 2);
  const columns = { kind: 'columns', sheetId: 'budget', before: book.sheets[0].widths, after: [...book.sheets[0].widths, 136] };
  assert.equal(applyEntry(book, columns).sheets[0].widths.length, 27);
  assert.equal(applyEntry(applyEntry(book, columns), columns, true).sheets[0].widths.length, 26);
  assert.ok(book.sheets.every(sheet => !sheet.frozen));
});


test('saved wide sheets keep their dimensions and validate column bounds', () => {
  const book = { id: 'studio', name: 'Test', sheets: [{ id: 'wide', name: 'Wide', cells: { N1: 'value' }, widths: [900] }] };
  const validated = validateWorkbook(book);
  assert.equal(validated.sheets[0].widths.length, 26);
  assert.equal(validated.sheets[0].widths[0], 600);
  assert.equal(validated.sheets[0].frozen, false);
  assert.equal(validated.sheets[0].cells.N1, 'value');
  assert.throws(() => validateWorkbook({ ...book, sheets: [{ ...book.sheets[0], cells: { XFE1: 'outside' } }] }), /invalid cell/);
});

test('hostile formulas remain data and excessive work returns cell errors', () => {
  const engine = new FormulaEngine({
    A1: '=WEBSERVICE("https://example.invalid")',
    A2: '=javascript:alert(1)',
    A3: '=SUM(A1:XFD10000)',
    A4: '=' + '1+'.repeat(500) + '1',
    A5: '=SUM(B1:M10000,B1:M10000)',
  });
  for (const address of ['A1', 'A2', 'A3', 'A4', 'A5']) assert.ok(['#ERROR!', '#REF!'].includes(engine.evaluate(address)));
  const chain = {};
  for (let row = 1; row < 1000; row++) chain[`A${row}`] = `=A${row + 1}+1`;
  chain.A1000 = '1';
  assert.equal(new FormulaEngine(chain).evaluate('A1'), '#ERROR!');
  const repeated = {};
  for (let row = 1; row <= 10; row++) repeated[`N${row}`] = '=SUM(A1:L10000)';
  const bounded = new FormulaEngine(repeated);
  assert.equal(bounded.evaluate('N1'), 0);
  assert.equal(bounded.evaluate('N10'), '#ERROR!');
  bounded.patch([{ address: 'N10', after: '=1+2' }]);
  assert.equal(bounded.evaluate('N10'), 3);
});

test('saved addresses are canonical and prototype keys are rejected', () => {
  const book = { id: 'studio', name: 'Test', sheets: [{ id: 'safe', name: 'Safe', cells: { '$a$1': 'value' }, widths: [] }] };
  assert.equal(validateWorkbook(book).sheets[0].cells.A1, 'value');
  assert.throws(() => validateWorkbook({ ...book, sheets: [{ ...book.sheets[0], cells: JSON.parse('{"__proto__":"bad"}') }] }), /invalid cell/);
});


test('mutation requests reject foreign and opaque origins', () => {
  const { isSameOriginMutation } = require('../out-test/lib/request-security.js');
  const url = 'http://localhost:3000/api/reset';
  assert.equal(isSameOriginMutation(new Request(url)), true);
  assert.equal(isSameOriginMutation(new Request(url, { headers: { origin: 'http://localhost:3000' } })), true);
  assert.equal(isSameOriginMutation(new Request(url, { headers: { origin: 'https://attacker.invalid' } })), false);
  assert.equal(isSameOriginMutation(new Request(url, { headers: { origin: 'null' } })), false);
  assert.equal(isSameOriginMutation(new Request(url, { headers: { 'sec-fetch-site': 'cross-site' } })), false);
});

test('Excel AVERAGE and legacy AVG share the same numeric behavior', () => {
  const engine = new FormulaEngine({ A1: '0', A2: '10', A3: 'text', B1: '=AVERAGE(A1:A4)', B2: '=AVG(A1:A4)', B3: '=SUM(AVERAGE(A1:A2),5)' });
  assert.equal(engine.evaluate('B1'), 5);
  assert.equal(engine.evaluate('B2'), 5);
  assert.equal(engine.evaluate('B3'), 10);
  engine.patch([{ address: 'A2', after: '20' }]);
  assert.equal(engine.evaluate('B1'), 10);
  assert.equal(engine.evaluate('B3'), 15);
});

test('function completion keeps suffixes and identifies nested parameter positions', () => {
  const { functionSuggestions, completeFunction, functionContext, splitFunctionArguments } = require('../out-test/lib/function-catalog.js');
  assert.deepEqual(functionSuggestions('=SU', 3).map(option => option.name), ['SUM']);
  assert.deepEqual(functionSuggestions('SU', 2), []);
  assert.deepEqual(functionSuggestions('=' + 'S'.repeat(5000), 5001), []);
  assert.equal(functionContext('=' + '('.repeat(5000), 5001), null);
  assert.deepEqual(functionSuggestions('=SUM(AV', 7).map(option => option.name), ['AVERAGE', 'AVG']);
  assert.deepEqual(completeFunction('=SU+5', 3, 'SUM', 1), { text: '=SUM()+5', caret: 5 });
  assert.deepEqual(completeFunction('=SU(A1)', 3, 'SUM', 1), { text: '=SUM(A1)', caret: 5 });
  assert.deepEqual(completeFunction('=SUM (A1)', 3, 'SUM', 1), { text: '=SUM (A1)', caret: 6 });
  assert.equal(functionContext('=SUM(A1,AVERAGE(B1,', 19).name, 'AVERAGE');
  assert.equal(functionContext('=SUM(A1,AVERAGE(B1,', 19).argument, 1);
  const nested = '=SUM(A1,AVERAGE(B1,C1),';
  assert.equal(functionContext(nested, nested.length).name, 'SUM');
  assert.equal(functionContext(nested, nested.length).argument, 2);
  assert.deepEqual(splitFunctionArguments('A1:A3,SUM(B1,B2),5'), ['A1:A3', 'SUM(B1,B2)', '5']);
});

test('function preview does not change cells and rejects unsafe or oversized formulas', () => {
  const engine = new FormulaEngine({ A1: '10', A2: '20', B1: '=A1+1' });
  assert.equal(engine.preview('=SUM(A1:A2)', 'C1'), 30);
  assert.equal(engine.preview('=AVERAGE(A1:A2)', 'C1'), 15);
  assert.equal(engine.preview('=SUM(C1)', 'C1'), '#CYCLE!');
  assert.equal(engine.preview('=WEBSERVICE("https://example.invalid")', 'C1'), '#ERROR!');
  assert.equal(engine.preview('=SUM(A1:XFD10000)', 'C1'), '#ERROR!');
  assert.equal(engine.getRaw('C1'), '');
  assert.equal(engine.preview('=SUM(B1)', 'A1'), '#CYCLE!');
  assert.equal(engine.evaluate('B1'), 11);
  assert.equal(engine.preview('=SUM(B1)', 'A1'), '#CYCLE!');
  assert.equal(engine.evaluate('B1'), 11);
});
