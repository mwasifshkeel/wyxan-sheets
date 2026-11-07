'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent } from 'react';
import { addressAt, bounds, clampPosition, isWithin, parseAddress, type Selection } from '@/lib/address';
import { clipboardMatrix, clipboardToken, INTERNAL_CLIPBOARD_TYPE, PASTE_LIMIT, parsePastedText, pasteChanges, selectionToHtml, selectionToTsv } from '@/lib/clipboard';
import { displayValue, FormulaEngine, isFormulaError } from '@/lib/formulas';
import { applyEntry, History } from '@/lib/history';
import { DEFAULT_COL_WIDTH, INITIAL_COLS, MAX_COLS, MAX_ROWS, type CellChange, type HistoryEntry, type SavePhase, type Sheet, type Workbook } from '@/lib/types';
import { Grid, type GridHandle } from './Grid';
import { Icon } from './Icons';
import { FormulaInput } from './FormulaInput';
import { FunctionDialog } from './FunctionDialog';

const PHONE_QUERY = '(max-width: 640px), (max-height: 640px) and (pointer: coarse)';
const subscribePhone = (notify: () => void) => {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

const BACKUP_KEY = 'tally:studio:pending';
const initialSelection = { anchor: { row: 6, col: 1 }, focus: { row: 6, col: 1 } };
type SheetClipboardEvent = Pick<ClipboardEvent<HTMLDivElement>, 'target' | 'clipboardData' | 'preventDefault'>;

function readStoredBackup(): { workbook: Workbook } | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.workbook || !Array.isArray(value.workbook.sheets)) return null;
    return value;
  } catch { return null; }
}

const navigate = (sheetId: string, row: number, col: number, push = false) => {
  const url = `/s/${encodeURIComponent(sheetId)}?cell=${addressAt(row, col)}`;
  if (push) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
};

export function Spreadsheet({ initialSheetId }: { initialSheetId: string }) {
  const readOnly = useSyncExternalStore(subscribePhone, isPhone, () => true);
  const [viewFrozen, setViewFrozen] = useState<Record<string, boolean>>({});
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const workbookRef = useRef<Workbook | null>(null);
  const enginesRef = useRef<Map<string, FormulaEngine>>(new Map());
  const [history] = useState(() => new History());
  const [engines, setEngines] = useState<Map<string, FormulaEngine>>(new Map());
  const [activeSheetId, setActiveSheetId] = useState(initialSheetId);
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const selectionRef = useRef<Selection>(initialSelection);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const persistedRevRef = useRef(0);
  const [savePhase, setSavePhase] = useState<SavePhase>('loading');
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const cancelRenameRef = useRef(false);
  const [formulaText, setFormulaDraft] = useState('');
  const [formulaFocused, setFormulaFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [functionsOpen, setFunctionsOpen] = useState(false);
  const [functionSource, setFunctionSource] = useState('');
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const functionDraftRef = useRef<{ value: string; source: 'cell' | 'bar'; changed: boolean } | null>(null);
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>('system');
  const gridRef = useRef<GridHandle>(null);
  const initialLoadRef = useRef(false);
  const skipFormulaBlurRef = useRef(false);
  const formulaAddressRef = useRef('');
  const formulaChangedRef = useRef(false);
  const guideRef = useRef<HTMLElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});
  const copiedRef = useRef<{ text: string; origin: { row: number; col: number }; sheetId: string; token: string; cut?: boolean } | null>(null);
  const activeSheet = workbook?.sheets.find(sheet => sheet.id === activeSheetId) || null;
  const gridSheet = activeSheet && readOnly && viewFrozen[activeSheetId] !== undefined ? { ...activeSheet, frozen: viewFrozen[activeSheetId] } : activeSheet;
  const engine = engines.get(activeSheetId);
  const activeAddress = addressAt(selection.focus.row, selection.focus.col);
  const activeRaw = activeSheet?.cells[activeAddress] || '';
  const formulaDraft = formulaFocused ? formulaText : activeRaw;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!helpOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const guide = guideRef.current;
    guide?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setHelpOpen(false); }
      if (event.key !== 'Tab') return;
      const items = Array.from(guide?.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]') || []);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [helpOpen]);

  const initialize = useCallback(async () => {
    setSavePhase('loading');
    setLoadError('');
    try {
      const response = await fetch('/api/workbook/studio', { cache: 'no-store' });
      if (!response.ok) throw Error('The workbook could not be loaded. Check the server and try again.');
      const server = await response.json() as Workbook;
      const backup = readStoredBackup();
      const recover = backup && backup.workbook.updatedAt > server.updatedAt;
      const next = recover ? backup.workbook : server;
      if (!recover) localStorage.removeItem(BACKUP_KEY);
      workbookRef.current = next;
      setWorkbook(next);
      enginesRef.current = new Map(next.sheets.map(sheet => [sheet.id, new FormulaEngine(sheet.cells)]));
      setEngines(new Map(enginesRef.current));
      history.reset();
      revisionRef.current = 0;
      persistedRevRef.current = recover ? -1 : 0;
      setRevision(0);
      setSavePhase(recover ? 'failed' : 'saved');
      const url = new URL(window.location.href);
      const parsed = parseAddress(url.searchParams.get('cell') || 'B7') || { row: 6, col: 1 };
      const current: Selection = { anchor: parsed, focus: parsed };
      selectionRef.current = current;
      setSelection(current);
      window.setTimeout(() => gridRef.current?.moveTo(parsed.row, parsed.col), 80);
    } catch (error) {
      const backup = readStoredBackup();
      if (backup) {
        const next = backup.workbook;
        workbookRef.current = next;
        setWorkbook(next);
        enginesRef.current = new Map(next.sheets.map(sheet => [sheet.id, new FormulaEngine(sheet.cells)]));
        setEngines(new Map(enginesRef.current));
        setSavePhase('failed');
        setMessage('Working from the browser recovery copy. Saving can be retried.');
      } else setLoadError(error instanceof Error ? error.message : 'Unable to load the workbook.');
    }
  }, [history]);

  useEffect(() => { if (initialLoadRef.current) return; initialLoadRef.current = true; void initialize(); }, [initialize]);

  useEffect(() => {
    const restore = () => {
      const url = new URL(window.location.href);
      const id = url.pathname.split('/')[2] || 'budget';
      setActiveSheetId(id);
      const parsed = parseAddress(url.searchParams.get('cell') || 'A1') || { row: 0, col: 0 };
      const next = { anchor: parsed, focus: parsed };
      selectionRef.current = next;
      setSelection(next);
      gridRef.current?.moveTo(parsed.row, parsed.col);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const saveNow = useCallback(async () => {
    if (inFlightRef.current) return;
    const current = workbookRef.current;
    if (!current) return;
    const sentRevision = revisionRef.current;
    if (sentRevision === persistedRevRef.current) { setSavePhase('saved'); return; }
    inFlightRef.current = true;
    setSavePhase('saving');
    try {
      const response = await fetch('/api/workbook/studio', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current),
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw Error(details.error || 'Save failed. Your edits are safe in this browser.');
      }
      const result = await response.json() as { updatedAt: number };
      persistedRevRef.current = sentRevision;
      if (revisionRef.current === sentRevision) {
        const latest = workbookRef.current;
        if (latest) { const saved = { ...latest, updatedAt: result.updatedAt }; workbookRef.current = saved; setWorkbook(saved); }
        localStorage.removeItem(BACKUP_KEY);
        setSavePhase('saved');
        setMessage('');
      } else {
        setSavePhase('local');
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => void saveNowRef.current(), 250);
      }
    } catch (error) {
      setSavePhase('failed');
      setMessage(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      inFlightRef.current = false;
    }
  }, []);
  useEffect(() => { saveNowRef.current = saveNow; }, [saveNow]);

  const dirty = useCallback((next: Workbook) => {
    const rev = ++revisionRef.current;
    setRevision(rev);
    setSavePhase('local');
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ workbook: next, revision: rev })); }
    catch { setMessage('Browser storage is full. Save to the server before closing this tab.'); }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void saveNowRef.current(), 900);
    workbookRef.current = next;
  }, []);

  const updateEngine = (entry: HistoryEntry, reverse = false) => {
    if (entry.kind === 'cells') enginesRef.current.get(entry.sheetId)?.patch(entry.changes.map(change => ({ address: change.address, after: reverse ? change.before : change.after })));
    if (entry.kind === 'add' || entry.kind === 'delete') {
      const remove = entry.kind === 'add' ? reverse : !reverse;
      if (remove) enginesRef.current.delete(entry.sheet.id);
      else enginesRef.current.set(entry.sheet.id, new FormulaEngine(entry.sheet.cells));
      setEngines(new Map(enginesRef.current));
    }
  };

  const commit = useCallback((entry: HistoryEntry) => {
    if (readOnly) return;
    const previous = workbookRef.current;
    if (!previous) return;
    if (entry.kind === 'cells') {
      const sheetId = entry.sheetId;
      entry = { ...entry, columnsBefore: previous.sheets.find(sheet => sheet.id === sheetId)?.widths.length };
    }
    const next = applyEntry(previous, entry);
    if (next === previous) return;
    updateEngine(entry);
    history.record(entry);
    workbookRef.current = next;
    setWorkbook(next);
    dirty(next);
  }, [dirty, history, readOnly]);

  const undo = useCallback(() => {
    if (readOnly) return;
    const current = workbookRef.current;
    if (!current) return;
    const { workbook: next, entry } = history.undoDetailed(current);
    if (!entry) return;
    updateEngine(entry, true);
    if (!next.sheets.some(sheet => sheet.id === activeSheetId)) {
      const fallback = next.sheets[0]?.id || 'budget';
      setActiveSheetId(fallback); navigate(fallback, 0, 0, true);
    }
    workbookRef.current = next; setWorkbook(next); dirty(next);
  }, [dirty, activeSheetId, history, readOnly]);

  const redo = useCallback(() => {
    if (readOnly) return;
    const current = workbookRef.current;
    if (!current) return;
    const { workbook: next, entry } = history.redoDetailed(current);
    if (!entry) return;
    updateEngine(entry);
    if (!next.sheets.some(sheet => sheet.id === activeSheetId)) {
      const fallback = next.sheets[0].id;
      setActiveSheetId(fallback); navigate(fallback, 0, 0, true);
    }
    workbookRef.current = next; setWorkbook(next); dirty(next);
  }, [dirty, activeSheetId, history, readOnly]);

  const select = useCallback((row: number, col: number, extend = false, push = false) => {
    const position = clampPosition(row, col);
    const next: Selection = { anchor: extend ? selectionRef.current.anchor : position, focus: position };
    const previous = selectionRef.current;
    if (previous.focus.row === next.focus.row && previous.focus.col === next.focus.col && previous.anchor.row === next.anchor.row && previous.anchor.col === next.anchor.col) return;
    selectionRef.current = next;
    setSelection(next);
    navigate(activeSheetId, position.row, position.col, push);
  }, [activeSheetId]);

  const switchSheet = (sheetId: string) => {
    setActiveSheetId(sheetId);
    const position = { row: 0, col: 0 };
    const next = { anchor: position, focus: position };
    selectionRef.current = next;
    setSelection(next);
    navigate(sheetId, 0, 0, true);
    gridRef.current?.focus();
    gridRef.current?.moveTo(0, 0);
  };

  const changeCell = useCallback((address: string, value: string) => {
    const current = workbookRef.current?.sheets.find(sheet => sheet.id === activeSheetId);
    if (!current) return;
    const before = current.cells[address] || '';
    const after = value.slice(0, 4000);
    if (before !== after) commit({ kind: 'cells', sheetId: activeSheetId, changes: [{ address, before, after }] });
  }, [activeSheetId, commit]);

  const clearSelection = () => {
    if (!activeSheet) return;
    const changes: CellChange[] = [];
    for (const [address, before] of Object.entries(activeSheet.cells)) {
      const position = parseAddress(address);
      if (position && isWithin(selectionRef.current, position.row, position.col)) changes.push({ address, before, after: '' });
    }
    if (changes.length) commit({ kind: 'cells', sheetId: activeSheetId, changes });
  };

  const rememberCopy = (text: string, cut = false) => {
    const b = bounds(selectionRef.current);
    const token = crypto.randomUUID();
    copiedRef.current = { text, origin: { row: b.top, col: b.left }, sheetId: activeSheetId, token, cut };
    return token;
  };

  const copy = (event: SheetClipboardEvent, cutting = false) => {
    if (!activeSheet || event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    try {
      const text = selectionToTsv(selectionRef.current, activeSheet.cells);
      const token = rememberCopy(text, cutting);
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('text/html', selectionToHtml(selectionRef.current, activeSheet.cells, token));
      event.clipboardData.setData(INTERNAL_CLIPBOARD_TYPE, token);
      if (cutting) clearSelection();
      setMessage(cutting ? 'Selection cut. Paste to move it; undo restores it.' : 'Selection copied');
    } catch (error) { setMessage((error as Error).message); }
  };

  const applyPaste = (matrix: string[][], token = '', text = '') => {
    if (readOnly) return;
    const sheet = workbookRef.current?.sheets.find(sheet => sheet.id === activeSheetId);
    if (!sheet || !matrix.length) return;
    const rectangle = bounds(selectionRef.current);
    const origin = { row: rectangle.top, col: rectangle.left };
    const copied = copiedRef.current;
    const internal = copied && !copied.cut && copied.token === token && copied.text === text ? copied.origin : undefined;
    // pasting one value into a range fills that range as one undo step.
    if (matrix.length === 1 && matrix[0].length === 1 && (rectangle.bottom !== rectangle.top || rectangle.right !== rectangle.left)) {
      const size = (rectangle.bottom - rectangle.top + 1) * (rectangle.right - rectangle.left + 1);
      if (size > PASTE_LIMIT) { setMessage('Fill up to 50,000 cells at a time.'); return; }
      matrix = Array.from({ length: rectangle.bottom - rectangle.top + 1 }, () => Array(rectangle.right - rectangle.left + 1).fill(matrix[0][0]));
    }
    const changes = pasteChanges(sheet.cells, matrix, origin, internal);
    if (changes.length) commit({ kind: 'cells', sheetId: activeSheetId, changes });
    const width = matrix.reduce((n, row) => Math.max(n, row.length), 0);
    const next = clampPosition(origin.row + matrix.length - 1, origin.col + width - 1);
    const selectionNext = { anchor: origin, focus: next };
    selectionRef.current = selectionNext; setSelection(selectionNext);
    navigate(activeSheetId, next.row, next.col);
    const clipped = origin.row + matrix.length > MAX_ROWS || origin.col + width > MAX_COLS;
    setMessage(`Pasted ${changes.length.toLocaleString()} changed cells${clipped ? ' · clipped at the sheet edge' : matrix.reduce((n, row) => n + row.length, 0) >= PASTE_LIMIT ? ' · 50,000 cell limit' : ''}`);
  };

  const paste = (event: SheetClipboardEvent) => {
    if (readOnly) { event.preventDefault(); return; }
    if (!activeSheet || event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    try {
      const matrix = clipboardMatrix(event.clipboardData);
      if (!matrix.length) { setMessage('Paste text or a table. Images are not supported.'); return; }
      applyPaste(matrix, clipboardToken(event.clipboardData), event.clipboardData.getData('text/plain'));
    } catch (error) { setMessage((error as Error).message); }
  };
  const cut = (event: SheetClipboardEvent) => copy(event, !readOnly);

  const copyButton = async () => {
    if (!activeSheet) return;
    try {
      const text = selectionToTsv(selectionRef.current, activeSheet.cells);
      const token = rememberCopy(text);
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        const html = selectionToHtml(selectionRef.current, activeSheet.cells, token);
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
        } catch { await navigator.clipboard.writeText(text); }
      } else await navigator.clipboard.writeText(text);
      setMessage('Selection copied');
    } catch (error) {
      setMessage(error instanceof Error && error.message.startsWith('Copy up to') ? error.message : 'Clipboard unavailable. Focus the grid and use Ctrl/Cmd+C.');
      gridRef.current?.focus();
    }
  };
  const pasteButton = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { setMessage('The clipboard has no text to paste.'); return; }
      const copied = copiedRef.current;
      applyPaste(parsePastedText(text), copied?.text === text ? copied.token : '', text);
    } catch (error) {
      setMessage(error instanceof Error && error.message.startsWith('Paste less') ? error.message : 'Clipboard unavailable. Focus the grid and use Ctrl/Cmd+V, or paste into the formula bar.');
    }
  };

  useEffect(() => {
    // firefox sends clipboard events to the document for a focused non-editable grid.
    const forward = (event: globalThis.ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData || document.activeElement?.getAttribute('role') !== 'grid') return;
      const input: SheetClipboardEvent = { target: event.target!, clipboardData: event.clipboardData, preventDefault: () => event.preventDefault() };
      if (event.type === 'copy') copy(input);
      else if (event.type === 'cut') cut(input);
      else paste(input);
    };
    document.addEventListener('copy', forward);
    document.addEventListener('cut', forward);
    document.addEventListener('paste', forward);
    return () => {
      document.removeEventListener('copy', forward);
      document.removeEventListener('cut', forward);
      document.removeEventListener('paste', forward);
    };
  });

  const addSheet = () => {
    const current = workbookRef.current;
    if (!current || current.sheets.length >= 15) { setMessage('This workbook supports up to 15 sheets.'); return; }
    const id = `sheet-${crypto.randomUUID()}`;
    let number = 1;
    while (current.sheets.some(sheet => sheet.name === `Sheet ${number}`)) number++;
    const sheet: Sheet = { id, name: `Sheet ${number}`, cells: {}, widths: Array(INITIAL_COLS).fill(DEFAULT_COL_WIDTH), frozen: false };
    commit({ kind: 'add', sheet });
    switchSheet(id);
    cancelRenameRef.current = false; setRenameId(id); setRenameText(sheet.name);
  };

  const deleteSheet = () => {
    const current = workbookRef.current;
    if (!current || !activeSheet || current.sheets.length <= 1) return;
    const index = current.sheets.findIndex(sheet => sheet.id === activeSheetId);
    const fallback = current.sheets[index + 1] || current.sheets[index - 1];
    commit({ kind: 'delete', sheet: activeSheet, index });
    setRenameId(null); switchSheet(fallback.id);
    setMessage(`Deleted ${activeSheet.name}. Undo to restore it.`);
  };
  const addColumn = () => {
    if (!activeSheet || activeSheet.widths.length >= MAX_COLS) return;
    const after = [...activeSheet.widths, DEFAULT_COL_WIDTH];
    commit({ kind: 'columns', sheetId: activeSheetId, before: activeSheet.widths, after });
    select(selection.focus.row, after.length - 1);
  };

  const completeRename = () => {
    if (cancelRenameRef.current) { cancelRenameRef.current = false; setRenameId(null); return; }
    if (!renameId || !workbookRef.current) { setRenameId(null); return; }
    const current = workbookRef.current.sheets.find(sheet => sheet.id === renameId);
    const name = renameText.trim().slice(0, 80);
    if (current && name && current.name !== name) commit({ kind: 'rename', sheetId: renameId, before: current.name, after: name });
    setRenameId(null);
  };

  const resetDemo = async () => {
    if (readOnly) return;
    if (!window.confirm('Reset all sheets to the original demo fixtures? Unsaved edits will be discarded.')) return;
    try {
      const response = await fetch('/api/reset', { method: 'POST' });
      if (!response.ok) throw Error();
      localStorage.removeItem(BACKUP_KEY);
      const next = await response.json() as Workbook;
      workbookRef.current = next; setWorkbook(next);
      enginesRef.current = new Map(next.sheets.map(sheet => [sheet.id, new FormulaEngine(sheet.cells)]));
      setEngines(new Map(enginesRef.current));
      history.reset();
      revisionRef.current = 0; persistedRevRef.current = 0; setRevision(0); setSavePhase('saved'); setMessage('Demo data restored');
      switchSheet('budget');
    } catch { setMessage('Reset failed. Check the server connection.'); }
  };

  const populatedCells = useMemo(() => Object.entries(activeSheet?.cells || {}).map(([address, raw]) => ({
    address, raw, position: parseAddress(address),
  })), [activeSheet?.cells]);

  const stats = useMemo(() => {
    if (!activeSheet || !engine) return { count: 0, sum: 0, average: 0 };
    let count = 0, numericCount = 0, sum = 0;
    const rectangle = bounds(selection);
    for (const { address, raw, position } of populatedCells) {
      if (!raw || !position || position.row < rectangle.top || position.row > rectangle.bottom || position.col < rectangle.left || position.col > rectangle.right) continue;
      count++;
      const result = engine.evaluate(address);
      if (!isFormulaError(result) && result !== '' && Number.isFinite(Number(result))) {
        sum += Number(result); numericCount++;
      }
    }
    return { count, sum, average: numericCount ? sum / numericCount : 0 };
  }, [activeSheet, engine, selection, populatedCells]);

  const openFunctions = () => {
    if (readOnly) return;
    const cellDraft = gridRef.current?.takeDraft() ?? null;
    functionDraftRef.current = cellDraft !== null ? { value: cellDraft, source: 'cell', changed: true } : formulaFocused ? { value: formulaDraft, source: 'bar', changed: formulaChangedRef.current } : null;
    setFunctionSource(cellDraft ?? formulaDraft);
    if (formulaFocused) {
      skipFormulaBlurRef.current = true;
      setFormulaFocused(false);
    }
    setHelpOpen(false);
    setFunctionsOpen(true);
  };

  const closeFunctions = () => {
    const draft = functionDraftRef.current;
    functionDraftRef.current = null;
    setFunctionsOpen(false);
    requestAnimationFrame(() => {
      if (draft?.source === 'cell') gridRef.current?.edit(draft.value);
      else if (draft?.source === 'bar') {
        formulaInputRef.current?.focus();
        setFormulaDraft(draft.value);
        formulaChangedRef.current = draft.changed;
        setFormulaFocused(true);
      } else gridRef.current?.focus();
    });
  };

  const activeResult = engine ? displayValue(engine.evaluate(activeAddress)) : '';
  const saveText = savePhase === 'saved' ? 'All changes saved' : savePhase === 'saving' ? 'Saving changes' : savePhase === 'failed' ? 'Save failed. Retry' : savePhase === 'local' ? 'Changes on this device' : 'Loading';

  if (loadError) return <main className="empty-page"><section className="empty-card"><span className="empty-mark"><Icon name="alert" size={26} /></span><h1>Couldn&apos;t open the workbook.</h1><p>{loadError}</p><button className="primary-button" onClick={() => void initialize()}>Try again</button></section></main>;
  if (!workbook) return <div className="app-shell loading-state"><header className="topbar"><div className="brand-mark"><Icon name="grid" /></div><b className="brand-name">tally</b></header><div className="loading-content"><div className="loading-line wide"/><div className="loading-line"/><div className="loading-grid"/></div><p className="loading-copy" role="status">Opening Northline Studio...</p></div>;
  if (!activeSheet || !engine) return <main className="empty-page"><section className="empty-card"><span className="empty-mark">Missing sheet</span><h1>That sheet doesn&apos;t exist.</h1><p>The address points to a sheet that isn&apos;t in this workbook.</p><button className="primary-button" onClick={() => switchSheet(workbook.sheets[0].id)}>Open {workbook.sheets[0].name}</button></section></main>;

  return <div className="app-shell" data-readonly={readOnly} onKeyDownCapture={event => {
    if (!readOnly && event.shiftKey && event.key === 'F3' && !functionsOpen) { event.preventDefault(); event.stopPropagation(); openFunctions(); }
  }}>
    <header className="topbar">
      <div className="brand-section"><span className="brand-mark"><Icon name="grid" size={21} /></span><span className="brand-name">tally</span><span className="brand-divider"/><div className="workbook-title"><h1>{activeSheet.name}</h1><span>{workbook.name}</span></div></div>
      <div className="header-actions">
        <button disabled={readOnly} className="functions-nav" aria-label="Functions" title="Functions (Shift+F3)" aria-haspopup="dialog" aria-expanded={functionsOpen} onPointerDown={event => event.preventDefault()} onClick={openFunctions}><span className="fx-label" aria-hidden="true">ƒx</span><span className="functions-nav-text">Functions</span></button>
        <button className={`save-status ${savePhase === 'failed' ? 'failed' : ''}`} aria-label={saveText} title={message || saveText} onClick={() => { if (savePhase === 'failed' || savePhase === 'local') void saveNow(); }} disabled={savePhase === 'saved' || savePhase === 'saving'}><Icon name={savePhase === 'failed' ? 'alert' : savePhase === 'saved' ? 'check' : 'refresh'} size={15}/><span className="save-label">{saveText}</span><span className="save-mobile" aria-hidden="true">{savePhase === 'saved' ? 'Saved' : savePhase === 'saving' ? 'Saving' : savePhase === 'failed' ? 'Retry' : 'Unsaved'}</span></button>
        <span className="vertical-separator"/>
        <button className="icon-button theme-button" title="Toggle light and dark mode" aria-label="Toggle light and dark mode" onClick={() => setTheme(previous => { const current = previous === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : previous; return current === 'light' ? 'dark' : 'light'; })}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18}/></button>
        <button className="icon-button" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" aria-expanded={helpOpen} onClick={() => setHelpOpen(previous => !previous)}><Icon name="keyboard" size={19}/></button>
      </div>
    </header>

    <div className={`toolbar ${readOnly ? 'view-only-toolbar' : ''}`} role="toolbar" aria-label="Sheet controls">
      {readOnly && <span className="view-only-notice" role="status">View only · Edit on desktop</span>}
      <div className="toolbar-group"><button className="tool-button" disabled={readOnly || !history.canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo"/><span>Undo</span></button><button className="tool-button" disabled={readOnly || !history.canRedo} onClick={redo} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo"/><span>Redo</span></button></div>
      <span className="toolbar-divider"/>
      <div className="toolbar-group"><button className="tool-button" onClick={() => void copyButton()} title="Copy selection" aria-label="Copy selection"><Icon name="copy"/><span>Copy</span></button><button disabled={readOnly} className="tool-button" onClick={() => void pasteButton()} title="Paste selection" aria-label="Paste selection"><Icon name="paste"/><span>Paste</span></button><button className={`tool-button ${gridSheet?.frozen ? 'is-toggled' : ''}`} onClick={() => { if (readOnly) setViewFrozen(previous => ({ ...previous, [activeSheetId]: !gridSheet?.frozen })); else commit({ kind: 'freeze', sheetId: activeSheetId, before: activeSheet.frozen, after: !activeSheet.frozen }); }} title="Toggle frozen first column" aria-label={gridSheet?.frozen ? 'Unfreeze column A' : 'Freeze column A'} aria-pressed={gridSheet?.frozen}><Icon name="freeze"/><span>{gridSheet?.frozen ? 'Unfreeze' : 'Freeze'} column A</span></button></div>
      <div className="toolbar-right"><button className="tool-button" onClick={addColumn} disabled={readOnly || activeSheet.widths.length >= MAX_COLS} title="Add column" aria-label="Add column"><Icon name="plus"/><span>Column</span></button><button className="tool-button small" title="Rename this sheet" disabled={readOnly} aria-label="Rename this sheet" onClick={() => { cancelRenameRef.current = false; setRenameId(activeSheetId); setRenameText(activeSheet.name); }}><Icon name="edit" size={16}/><span>Rename</span></button><button className="tool-button" title="Delete this sheet" aria-label="Delete this sheet" disabled={readOnly || workbook.sheets.length <= 1} onClick={deleteSheet}><Icon name="trash"/><span>Delete sheet</span></button></div>
    </div>

    <div className="formula-line"><input key={activeAddress} className="address-box" aria-label="Go to cell" defaultValue={activeAddress} spellCheck={false} onKeyDown={event => {
      if (event.key === 'Enter') {
        const position = parseAddress(event.currentTarget.value);
        if (position) { select(position.row, position.col, false, true); gridRef.current?.focus(); }
        else setMessage('Enter an address from A1 to XFD10000.');
      } else if (event.key === 'Escape') { event.currentTarget.value = activeAddress; gridRef.current?.focus(); }
    }} /><button type="button" disabled={readOnly} className="formula-symbol" aria-label="Insert function" title="Insert function (Shift+F3)" aria-haspopup="dialog" onPointerDown={event => event.preventDefault()} onClick={openFunctions}>ƒx</button><FormulaInput readOnly={readOnly} ref={formulaInputRef} id="formula-editor" className="formula-input" placeholder="Type a value or formula" aria-label={`Raw value of ${activeAddress}`} spellCheck={false} value={readOnly ? activeRaw : formulaDraft} onFocus={() => { if (readOnly) return; formulaAddressRef.current = activeAddress; formulaChangedRef.current = false; setFormulaDraft(activeRaw); setFormulaFocused(true); }} onBlur={() => { if (skipFormulaBlurRef.current) { skipFormulaBlurRef.current = false; return; } if (formulaFocused) { if (!readOnly && formulaChangedRef.current) changeCell(formulaAddressRef.current || activeAddress, formulaDraft); setFormulaFocused(false); } }} onValueChange={value => { formulaChangedRef.current = true; setFormulaDraft(value); }} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); if (!readOnly && formulaChangedRef.current) changeCell(formulaAddressRef.current || activeAddress, formulaDraft); setFormulaFocused(false); gridRef.current?.focus(); } else if (event.key === 'Escape') { event.preventDefault(); skipFormulaBlurRef.current = true; setFormulaDraft(activeRaw); setFormulaFocused(false); gridRef.current?.focus(); } }}/><span className="formula-result" title="Computed result">{activeRaw.startsWith('=') ? activeResult : ''}</span></div>

    <div className="grid-area"><Grid readOnly={readOnly} key={`${activeSheetId}-${readOnly}`} ref={gridRef} sheet={gridSheet!} engine={engine} selection={selection} revision={revision} onSelect={select} onChangeCell={changeCell} onClear={clearSelection} onUndo={undo} onRedo={redo} onCopy={copy} onCut={cut} onPaste={paste} onResize={(column, width) => { const before = activeSheet.widths[column] || DEFAULT_COL_WIDTH; if (before !== width) commit({ kind: 'width', sheetId: activeSheetId, column, before, after: width }); }}/>
    </div>

    <div className="bottom-bar"><button className="add-tab" aria-label="Add a sheet" title="Add sheet" onClick={addSheet} disabled={readOnly || workbook.sheets.length >= 15}><Icon name="plus" size={17}/></button><div className="tab-strip" role="tablist" aria-label="Sheets">{workbook.sheets.map(sheet => !readOnly && renameId === sheet.id ? <input key={sheet.id} autoFocus className="rename-field" aria-label="New sheet name" maxLength={80} value={renameText} onChange={event => setRenameText(event.target.value)} onBlur={completeRename} onKeyDown={event => { if (event.key === 'Enter') completeRename(); else if (event.key === 'Escape') { cancelRenameRef.current = true; setRenameId(null); } }} /> : <button key={sheet.id} role="tab" aria-selected={sheet.id === activeSheetId} className={`sheet-tab ${sheet.id === activeSheetId ? 'current' : ''}`} onDoubleClick={() => { if (readOnly) return; cancelRenameRef.current = false; setRenameId(sheet.id); setRenameText(sheet.name); }} onClick={() => switchSheet(sheet.id)}>{sheet.name}</button>)}</div><div className="zoom-indicator">100%</div></div>
    <footer className="statusbar"><div className="left-status"><span className="status-ready"><span className="ready-dot"/>Ready</span><span className="status-range">{addressAt(bounds(selection).top, bounds(selection).left)}{bounds(selection).top !== bounds(selection).bottom || bounds(selection).left !== bounds(selection).right ? `:${addressAt(bounds(selection).bottom, bounds(selection).right)}` : ''}</span><span className="sr-only" aria-live="polite">{message}</span><span className="toast-text" title={message}>{message}</span></div><div className="selection-stats"><span>Sum <b>{displayValue(stats.sum)}</b></span><span>Average <b>{displayValue(stats.average)}</b></span><span>Count <b>{stats.count.toLocaleString()}</b></span></div></footer>

    {functionsOpen && !readOnly && <FunctionDialog address={activeAddress} raw={functionSource} engine={engine} onClose={closeFunctions} onInsert={formula => {
      functionDraftRef.current = null;
      changeCell(activeAddress, formula);
      setFunctionsOpen(false);
      requestAnimationFrame(() => gridRef.current?.focus());
    }}/>}
    {helpOpen && <div className="dialog-layer" onPointerDown={event => { if (event.target === event.currentTarget) setHelpOpen(false); }}><section ref={guideRef} className="shortcut-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><div className="dialog-header"><div><h2>Work without the mouse</h2></div><button className="icon-button" title="Close guide" aria-label="Close guide" onClick={() => setHelpOpen(false)}><Icon name="close"/></button></div><div className="shortcut-list"><div><span>Move through cells</span><kbd>Arrow keys</kbd></div><div><span>Extend a selection</span><kbd>Shift + Arrow</kbd></div><div><span>Edit the active cell</span><kbd>F2</kbd></div><div><span>Insert a function</span><kbd>Shift + F3</kbd></div><div><span>Complete a function name</span><kbd>Tab</kbd></div><div><span>Commit an edit</span><kbd>Enter</kbd></div><div><span>Copy and paste</span><kbd>Ctrl / Cmd + C / V</kbd></div><div><span>Undo and redo</span><kbd>Ctrl / Cmd + Z / Y</kbd></div><div><span>Clear selected cells</span><kbd>Delete</kbd></div></div><div className="dialog-footer"><button disabled={readOnly} className="text-button" onClick={() => { setHelpOpen(false); void resetDemo(); }}>Reset demo fixtures</button><button className="primary-button" onClick={() => setHelpOpen(false)}>Back to sheet</button></div></section></div>}
  </div>;
}
