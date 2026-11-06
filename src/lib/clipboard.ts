import { addressAt, bounds, parseAddress, type Selection } from './address';
import { MAX_COLS, MAX_ROWS, type CellMap, type CellChange } from './types';

export const PASTE_LIMIT = 50000;
export const CLIPBOARD_LIMIT = 5 * 1024 * 1024;
export const INTERNAL_CLIPBOARD_TYPE = 'application/x-tally-selection';

export function clipboardToken(data: DataTransfer): string {
  // firefox drops custom mime types; its html clipboard keeps this marker.
  return data.getData(INTERNAL_CLIPBOARD_TYPE) || /data-tally-copy="([a-f0-9-]{36})"/i.exec(data.getData('text/html').slice(0, 4096))?.[1] || '';
}

export function selectionToHtml(selection: Selection, values: CellMap, token: string): string {
  const b = bounds(selection);
  if ((b.bottom - b.top + 1) * (b.right - b.left + 1) > PASTE_LIMIT) throw Error('Copy up to 50,000 cells at a time.');
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const rows: string[] = [];
  for (let row = b.top; row <= b.bottom; row++) {
    const cells: string[] = [];
    for (let col = b.left; col <= b.right; col++) cells.push(`<td>${escape(values[addressAt(row, col)] || '').replace(/\n/g, '<br>')}</td>`);
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table data-tally-copy="${escape(token)}">${rows.join('')}</table>`;
}

export function selectionToTsv(selection: Selection, values: CellMap): string {
  const b = bounds(selection);
  if ((b.bottom - b.top + 1) * (b.right - b.left + 1) > PASTE_LIMIT) throw Error('Copy up to 50,000 cells at a time.');
  const rows: string[] = [];
  for (let row = b.top; row <= b.bottom; row++) {
    const cells: string[] = [];
    for (let col = b.left; col <= b.right; col++) {
      const value = values[addressAt(row, col)] ?? '';
      cells.push(/[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    }
    rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

export function parsePastedText(source: string, limit = PASTE_LIMIT): string[][] {
  if (source.length > CLIPBOARD_LIMIT) throw Error('Paste less than 5 MB of text at a time.');
  const text = source.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false, total = 0;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (char === '"' && (quoted || value === '')) {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if ((!quoted && (char === '\t' || char === '\n')) || i === text.length) {
      row.push(value.slice(0, 4000)); value = ''; total++;
      if (char !== '\t' || total >= limit) { rows.push(row); row = []; }
      if (total >= limit) break;
    } else value += char;
  }
  if (text.endsWith('\n') && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop();
  return rows;
}

export function clipboardMatrix(data: DataTransfer): string[][] {
  // template contents stay inert: pasted scripts and remote resources never run.
  if (data.types.includes('text/plain')) return parsePastedText(data.getData('text/plain'));
  const html = data.getData('text/html');
  if (html.length > CLIPBOARD_LIMIT) throw Error('Paste less than 5 MB of HTML at a time.');
  if (!html) return [];
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  content.querySelectorAll('script,style,iframe,object,embed,svg,math,link,meta,base,img,audio,video,source,track,template').forEach(node => node.remove());
  content.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  const table = content.querySelector('table');
  if (!table) return parsePastedText(content.textContent || '');
  const matrix: string[][] = [];
  let total = 0;
  for (const row of Array.from(table.rows)) {
    const values: string[] = [];
    for (const cell of Array.from(row.cells)) {
      if (total >= PASTE_LIMIT) break;
      values.push((cell.textContent || '').slice(0, 4000)); total++;
      for (let span = 1; span < cell.colSpan && total < PASTE_LIMIT; span++) { values.push(''); total++; }
    }
    if (values.length) matrix.push(values);
    if (total >= PASTE_LIMIT) break;
  }
  return matrix;
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
