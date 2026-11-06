import { addressAt, bounds, parseAddress, type Selection } from './address';
import { MAX_COLS, MAX_ROWS, type CellMap, type CellChange } from './types';

export function selectionToTsv(selection: Selection, values: CellMap): string {
  const b = bounds(selection);
  const rows: string[] = [];
  for (let row = b.top; row <= b.bottom; row++) {
    const cells: string[] = [];
    for (let col = b.left; col <= b.right; col++) cells.push(values[addressAt(row, col)] ?? '');
    rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

export function parsePastedText(source: string, limit = 50000): string[][] {
  const lines = source.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const rows: string[][] = [];
  let total = 0;
  for (const line of lines) {
    const values = line.split('\t');
    const count = Math.min(values.length, limit - total);
    if (count <= 0) break;
    rows.push(values.slice(0, count).map(value => value.slice(0, 4000)));
    total += count;
  }
  return rows;
}

export function clipboardText(data: DataTransfer): string {
  if (data.types.includes('text/plain')) return data.getData('text/plain');
  const html = data.getData('text/html');
  if (!html) return '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  const table = document.querySelector('table');
  if (table) return Array.from(table.querySelectorAll('tr')).map(row =>
    Array.from(row.querySelectorAll('th, td')).map(cell => cell.textContent || '').join('\t')
  ).join('\n');
  return document.body.textContent || '';
}

export function shiftFormula(raw: string, rowOffset: number, colOffset: number): string {
  if (!raw.startsWith('=')) return raw;
  return raw.replace(/(\$?)([A-Z]+)(\$?)([1-9][0-9]*)/gi, (whole, absCol: string, letters: string, absRow: string, rowText: string, index: number, text: string) => {
    if (index > 0 && /[A-Z_0-9]/i.test(text[index - 1])) return whole;
    const after = text[index + whole.length];
    if (after && /[A-Z_0-9]/i.test(after)) return whole;
    const ref = parseAddress(`${letters}${rowText}`);
    if (!ref) return '#REF!';
    const col = ref.col + (absCol ? 0 : colOffset);
    const row = ref.row + (absRow ? 0 : rowOffset);
    if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return '#REF!';
    const shifted = addressAt(row, col);
    const match = /^([A-Z]+)([0-9]+)$/.exec(shifted)!;
    return `${absCol}${match[1]}${absRow}${match[2]}`;
  });
}

export function pasteChanges(cells: CellMap, matrix: string[][], origin: { row: number; col: number }, copiedOrigin?: { row: number; col: number }): CellChange[] {
  const changes: CellChange[] = [];
  for (let r = 0; r < matrix.length && origin.row + r < MAX_ROWS; r++) {
    for (let c = 0; c < matrix[r].length && origin.col + c < MAX_COLS; c++) {
      const row = origin.row + r, col = origin.col + c;
      const address = addressAt(row, col);
      const previous = cells[address] ?? '';
      const value = copiedOrigin
        ? shiftFormula(matrix[r][c], row - (copiedOrigin.row + r), col - (copiedOrigin.col + c))
        : matrix[r][c];
      if (value !== previous) changes.push({ address, before: previous, after: value });
    }
  }
  return changes;
}
