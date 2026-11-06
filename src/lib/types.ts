export const MAX_ROWS = 10000;
export const MAX_COLS = 12;
export const ROW_HEIGHT = 34;
export const HEADER_HEIGHT = 38;
export const ROW_HEADER_WIDTH = 54;
export const DEFAULT_COL_WIDTH = 136;

export type CellMap = Record<string, string>;
export type Sheet = {
  id: string;
  name: string;
  cells: CellMap;
  widths: number[];
  frozen: boolean;
};
export type Workbook = {
  id: string;
  name: string;
  sheets: Sheet[];
  updatedAt: number;
};
export type CellChange = { address: string; before: string; after: string };
export type HistoryEntry =
  | { kind: 'cells'; sheetId: string; changes: CellChange[] }
  | { kind: 'rename'; sheetId: string; before: string; after: string }
  | { kind: 'add'; sheet: Sheet }
  | { kind: 'width'; sheetId: string; column: number; before: number; after: number }
  | { kind: 'freeze'; sheetId: string; before: boolean; after: boolean };

export type SavePhase = 'loading' | 'saved' | 'saving' | 'failed' | 'local';
