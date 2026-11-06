import { MAX_COLS, MAX_ROWS } from './types';

export function columnLabel(index: number): string {
  let n = index + 1;
  let text = '';
  while (n > 0) {
    n -= 1;
    text = String.fromCharCode(65 + (n % 26)) + text;
    n = Math.floor(n / 26);
  }
  return text;
}

export function parseAddress(value: string): { row: number; col: number } | null {
  const match = /^\$?([A-Z]+)\$?([1-9][0-9]*)$/i.exec(value.trim());
  if (!match) return null;
  let col = 0;
  for (const letter of match[1].toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (!Number.isSafeInteger(row) || row < 1 || row > MAX_ROWS || col < 1 || col > MAX_COLS) return null;
  return { row: row - 1, col: col - 1 };
}

export function addressAt(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

export function normalizedAddress(value: string): string | null {
  const parsed = parseAddress(value);
  return parsed ? addressAt(parsed.row, parsed.col) : null;
}

export type Selection = { anchor: { row: number; col: number }; focus: { row: number; col: number } };
export function bounds(selection: Selection) {
  const { anchor, focus } = selection;
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

export function isWithin(selection: Selection, row: number, col: number): boolean {
  const b = bounds(selection);
  return row >= b.top && row <= b.bottom && col >= b.left && col <= b.right;
}

export function clampPosition(row: number, col: number) {
  return { row: Math.max(0, Math.min(MAX_ROWS - 1, row)), col: Math.max(0, Math.min(MAX_COLS - 1, col)) };
}
