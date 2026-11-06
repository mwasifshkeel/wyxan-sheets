import { DEFAULT_COL_WIDTH, type HistoryEntry, type Sheet, type Workbook } from './types';

export function applyEntry(source: Workbook, entry: HistoryEntry, reverse = false): Workbook {
  const workbook: Workbook = { ...source, sheets: [...source.sheets], updatedAt: Math.max(Date.now(), source.updatedAt + 1) };
  if (entry.kind === 'add') {
    workbook.sheets = reverse ? workbook.sheets.filter(sheet => sheet.id !== entry.sheet.id) : [...workbook.sheets, entry.sheet];
    return workbook;
  }
  const index = workbook.sheets.findIndex(sheet => sheet.id === entry.sheetId);
  if (index === -1) return source;
  const sheet: Sheet = { ...workbook.sheets[index] };
  if (entry.kind === 'cells') {
    sheet.cells = { ...sheet.cells };
    for (const change of entry.changes) {
      const value = reverse ? change.before : change.after;
      if (value === '') delete sheet.cells[change.address];
      else sheet.cells[change.address] = value;
    }
  } else if (entry.kind === 'rename') {
    sheet.name = reverse ? entry.before : entry.after;
  } else if (entry.kind === 'width') {
    sheet.widths = [...sheet.widths];
    sheet.widths[entry.column] = (reverse ? entry.before : entry.after) || DEFAULT_COL_WIDTH;
  } else if (entry.kind === 'freeze') {
    sheet.frozen = reverse ? entry.before : entry.after;
  }
  workbook.sheets[index] = sheet;
  return workbook;
}

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  record(entry: HistoryEntry) {
    this.past.push(entry);
    this.future = [];
  }
  undoDetailed(workbook: Workbook): { workbook: Workbook; entry: HistoryEntry | null } {
    const entry = this.past.pop();
    if (!entry) return { workbook, entry: null };
    this.future.push(entry);
    return { workbook: applyEntry(workbook, entry, true), entry };
  }
  redoDetailed(workbook: Workbook): { workbook: Workbook; entry: HistoryEntry | null } {
    const entry = this.future.pop();
    if (!entry) return { workbook, entry: null };
    this.past.push(entry);
    return { workbook: applyEntry(workbook, entry), entry };
  }
  undo(workbook: Workbook) { return this.undoDetailed(workbook).workbook; }
  redo(workbook: Workbook) { return this.redoDetailed(workbook).workbook; }
  reset() { this.past = []; this.future = []; }
}
