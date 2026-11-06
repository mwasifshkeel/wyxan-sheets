'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { addressAt, bounds, clampPosition, parseAddress, type Selection } from '@/lib/address';
import { clipboardText, parsePastedText, pasteChanges, selectionToTsv } from '@/lib/clipboard';
import { displayValue, FormulaEngine, isFormulaError } from '@/lib/formulas';
import { applyEntry, History } from '@/lib/history';
import { DEFAULT_COL_WIDTH, MAX_COLS, type CellChange, type HistoryEntry, type SavePhase, type Sheet, type Workbook } from '@/lib/types';
import { Grid, type GridHandle } from './Grid';
import { Icon } from './Icons';

const BACKUP_KEY = 'tally:studio:pending';
const initialSelection = { anchor: { row: 6, col: 1 }, focus: { row: 6, col: 1 } };

function readStoredBackup(): { workbook: Workbook } | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.workbook || !Array.isArray(value.workbook.sheets)) return null;
    return value;
  } catch { return null; }
}

export function Spreadsheet({ initialSheetId }: { initialSheetId: string }) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const workbookRef = useRef<Workbook | null>(null);
  const enginesRef = useRef<Map<string, FormulaEngine>>(new Map());
  const historyRef = useRef(new History());
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
  const [formulaDraft, setFormulaDraft] = useState('');
  const [formulaFocused, setFormulaFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>('system');
  const [mobile, setMobile] = useState(false);
  const gridRef = useRef<GridHandle>(null);
  const initialLoadRef = useRef(false);
  const skipFormulaBlurRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});
  const copiedRef = useRef<{ text: string; origin: { row: number; col: number }; sheetId: string } | null>(null);
  const activeSheet = workbook?.sheets.find(sheet => sheet.id === activeSheetId) || null;
  const engine = enginesRef.current.get(activeSheetId);
  const activeAddress = addressAt(selection.focus.row, selection.focus.col);
  const activeRaw = activeSheet?.cells[activeAddress] || '';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

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
      historyRef.current.reset();
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
        setSavePhase('failed');
        setMessage('Working from the browser recovery copy. Saving can be retried.');
      } else setLoadError(error instanceof Error ? error.message : 'Unable to load the workbook.');
    }
  }, []);

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

  useEffect(() => {
    if (!formulaFocused) setFormulaDraft(activeRaw);
  }, [activeRaw, activeSheetId, activeAddress, formulaFocused, revision]);

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
        if (latest) { latest.updatedAt = result.updatedAt; setWorkbook({ ...latest }); }
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
  saveNowRef.current = saveNow;

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
    if (entry.kind === 'add') {
      if (reverse) enginesRef.current.delete(entry.sheet.id);
      else enginesRef.current.set(entry.sheet.id, new FormulaEngine(entry.sheet.cells));
    }
  };

  const commit = useCallback((entry: HistoryEntry) => {
    const previous = workbookRef.current;
    if (!previous) return;
    const next = applyEntry(previous, entry);
    if (next === previous) return;
    updateEngine(entry);
    historyRef.current.record(entry);
    workbookRef.current = next;
    setWorkbook(next);
    dirty(next);
  }, [dirty]);

  const undo = useCallback(() => {
    const current = workbookRef.current;
    if (!current) return;
    const { workbook: next, entry } = historyRef.current.undoDetailed(current);
    if (!entry) return;
    updateEngine(entry, true);
    if (entry.kind === 'add' && activeSheetId === entry.sheet.id) {
      const fallback = next.sheets[0]?.id || 'budget';
      setActiveSheetId(fallback); navigate(fallback, 0, 0, true);
    }
    workbookRef.current = next; setWorkbook(next); dirty(next);
  }, [dirty, activeSheetId]);

  const redo = useCallback(() => {
    const current = workbookRef.current;
    if (!current) return;
    const { workbook: next, entry } = historyRef.current.redoDetailed(current);
    if (!entry) return;
    updateEngine(entry);
    workbookRef.current = next; setWorkbook(next); dirty(next);
  }, [dirty]);

  const navigate = (sheetId: string, row: number, col: number, push = false) => {
    const url = `/s/${encodeURIComponent(sheetId)}?cell=${addressAt(row, col)}`;
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  };

  const select = useCallback((row: number, col: number, extend = false, push = false) => {
    const position = clampPosition(row, col);
    const next: Selection = { anchor: extend ? selectionRef.current.anchor : position, focus: position };
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
    if (!current || mobile) return;
    const before = current.cells[address] || '';
    const after = value.slice(0, 4000);
    if (before !== after) commit({ kind: 'cells', sheetId: activeSheetId, changes: [{ address, before, after }] });
  }, [activeSheetId, commit, mobile]);

  const clearSelection = useCallback(() => {
    if (!activeSheet || mobile) return;
    const rect = bounds(selectionRef.current);
    const changes: CellChange[] = [];
    for (let row = rect.top; row <= rect.bottom; row++) for (let col = rect.left; col <= rect.right; col++) {
      const address = addressAt(row, col);
      const before = activeSheet.cells[address];
      if (before) changes.push({ address, before, after: '' });
    }
    if (changes.length) commit({ kind: 'cells', sheetId: activeSheetId, changes });
  }, [activeSheet, activeSheetId, commit, mobile]);

  const copy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!activeSheet || event.target instanceof HTMLInputElement) return;
    const text = selectionToTsv(selectionRef.current, activeSheet.cells);
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    const b = bounds(selectionRef.current);
    copiedRef.current = { text, origin: { row: b.top, col: b.left }, sheetId: activeSheetId };
    setMessage('Selection copied');
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!activeSheet || mobile || event.target instanceof HTMLInputElement) return;
    const text = clipboardText(event.clipboardData);
    if (!text) return;
    event.preventDefault();
    const matrix = parsePastedText(text);
    const rectangle = bounds(selectionRef.current);
    const origin = { row: rectangle.top, col: rectangle.left };
    const copied = copiedRef.current && copiedRef.current.text === text && copiedRef.current.sheetId === activeSheetId ? copiedRef.current.origin : undefined;
    const changes = pasteChanges(activeSheet.cells, matrix, origin, copied);
    if (changes.length) commit({ kind: 'cells', sheetId: activeSheetId, changes });
    const next = clampPosition(origin.row + matrix.length - 1, origin.col + Math.max(0, ...matrix.map(row => row.length - 1)));
    const selectionNext = { anchor: origin, focus: next };
    selectionRef.current = selectionNext;
    setSelection(selectionNext);
    setMessage(`Pasted ${changes.length.toLocaleString()} changed cells${matrix.reduce((n, r) => n + r.length, 0) >= 50000 ? ' (50,000 cell limit)' : ''}`);
  };

  const cut = (event: ClipboardEvent<HTMLDivElement>) => { copy(event); if (!mobile) clearSelection(); };

  const copyButton = async () => {
    if (!activeSheet) return;
    const text = selectionToTsv(selectionRef.current, activeSheet.cells);
    try {
      await navigator.clipboard.writeText(text);
      const b = bounds(selectionRef.current);
      copiedRef.current = { text, origin: { row: b.top, col: b.left }, sheetId: activeSheetId };
      setMessage('Selection copied');
    } catch { setMessage('Select the grid and press Ctrl+C or Command+C to copy.'); gridRef.current?.focus(); }
  };

  const addSheet = () => {
    const current = workbookRef.current;
    if (!current || current.sheets.length >= 15) { setMessage('This workbook supports up to 15 sheets.'); return; }
    const id = `sheet-${Date.now().toString(36)}`;
    const sheet: Sheet = { id, name: `Untitled ${current.sheets.length - 2}`, cells: {}, widths: Array(MAX_COLS).fill(DEFAULT_COL_WIDTH), frozen: true };
    commit({ kind: 'add', sheet });
    switchSheet(id);
    setRenameId(id); setRenameText(sheet.name);
  };

  const completeRename = () => {
    if (!renameId || !workbookRef.current) { setRenameId(null); return; }
    const current = workbookRef.current.sheets.find(sheet => sheet.id === renameId);
    const name = renameText.trim().slice(0, 80);
    if (current && name && current.name !== name) commit({ kind: 'rename', sheetId: renameId, before: current.name, after: name });
    setRenameId(null);
  };

  const resetDemo = async () => {
    if (!window.confirm('Reset all sheets to the original demo fixtures? Unsaved edits will be discarded.')) return;
    try {
      const response = await fetch('/api/reset', { method: 'POST' });
      if (!response.ok) throw Error();
      localStorage.removeItem(BACKUP_KEY);
      const next = await response.json() as Workbook;
      workbookRef.current = next; setWorkbook(next);
      enginesRef.current = new Map(next.sheets.map(sheet => [sheet.id, new FormulaEngine(sheet.cells)]));
      historyRef.current.reset();
      revisionRef.current = 0; persistedRevRef.current = 0; setRevision(0); setSavePhase('saved'); setMessage('Demo data restored');
      switchSheet('budget');
    } catch { setMessage('Reset failed. Check the server connection.'); }
  };

  const stats = useMemo(() => {
    if (!activeSheet || !engine) return { count: 0, sum: 0, average: 0 };
    const rect = bounds(selection);
    let count = 0, numericCount = 0, sum = 0;
    for (let row = rect.top; row <= rect.bottom; row++) for (let col = rect.left; col <= rect.right; col++) {
      const address = addressAt(row, col), raw = activeSheet.cells[address] || '';
      if (!raw) continue;
      count++;
      const result = engine.evaluate(address);
      if (!isFormulaError(result) && result !== '' && Number.isFinite(Number(result))) {
        sum += Number(result); numericCount++;
      }
    }
    return { count, sum, average: numericCount ? sum / numericCount : 0 };
  }, [activeSheet, engine, selection, revision]);

  const activeResult = engine ? displayValue(engine.evaluate(activeAddress)) : '';
  const saveText = savePhase === 'saved' ? 'All changes saved' : savePhase === 'saving' ? 'Saving changes' : savePhase === 'failed' ? 'Save failed. Retry' : savePhase === 'local' ? 'Changes on this device' : 'Loading';

  if (loadError) return <main className="empty-page"><section className="empty-card"><span className="empty-mark"><Icon name="alert" size={26} /></span><h1>Couldn't open the workbook.</h1><p>{loadError}</p><button className="primary-button" onClick={() => void initialize()}>Try again</button></section></main>;
  if (!workbook) return <div className="app-shell loading-state"><header className="topbar"><div className="brand-mark"><Icon name="grid" /></div><b className="brand-name">tally</b></header><div className="loading-content"><div className="loading-line wide"/><div className="loading-line"/><div className="loading-grid"/></div><p className="loading-copy" role="status">Opening Northline Studio...</p></div>;
  if (!activeSheet || !engine) return <main className="empty-page"><section className="empty-card"><span className="empty-mark">Missing sheet</span><h1>That sheet doesn't exist.</h1><p>The address points to a sheet that isn't in this workbook.</p><button className="primary-button" onClick={() => switchSheet('budget')}>Open operating budget</button></section></main>;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-section"><span className="brand-mark"><Icon name="grid" size={21} /></span><span className="brand-name">tally</span><span className="brand-divider"/><div className="workbook-title"><strong>{workbook.name}</strong><span>Spreadsheet workspace</span></div></div>
      <div className="header-actions">
        <button className={`save-status ${savePhase === 'failed' ? 'failed' : ''}`} title={message || saveText} onClick={() => { if (savePhase === 'failed' || savePhase === 'local') void saveNow(); }} disabled={savePhase === 'saved' || savePhase === 'saving'}><Icon name={savePhase === 'failed' ? 'alert' : savePhase === 'saved' ? 'check' : 'refresh'} size={15}/><span>{saveText}</span></button>
        <span className="vertical-separator"/>
        <button className="icon-button theme-button" title="Toggle light and dark mode" aria-label="Toggle light and dark mode" onClick={() => setTheme(previous => { const current = previous === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : previous; return current === 'light' ? 'dark' : 'light'; })}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18}/></button>
        <button className="icon-button" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" aria-expanded={helpOpen} onClick={() => setHelpOpen(previous => !previous)}><Icon name="keyboard" size={19}/></button>
      </div>
    </header>

    <div className="sheet-heading"><div className="title-block"><span className="section-identifier">Workbook / {activeSheet.name}</span><h1>{activeSheet.name}</h1></div><div className="heading-right"><span className="density-indicator"><span className="density-dot"/>{activeSheetId === 'orders' ? '10,000 rows' : activeSheetId === 'budget' ? 'Operating plan' : 'Sheet view'}</span></div></div>

    <div className="toolbar" role="toolbar" aria-label="Sheet controls">
      <div className="toolbar-group"><button className="tool-button" disabled={!historyRef.current.canUndo} onClick={undo} title="Undo (Ctrl+Z)"><Icon name="undo"/><span>Undo</span></button><button className="tool-button" disabled={!historyRef.current.canRedo} onClick={redo} title="Redo (Ctrl+Y)"><Icon name="redo"/><span>Redo</span></button></div>
      <span className="toolbar-divider"/>
      <div className="toolbar-group"><button className="tool-button" onClick={() => void copyButton()} title="Copy selection"><Icon name="copy"/><span>Copy</span></button><button className={`tool-button ${activeSheet.frozen ? 'is-toggled' : ''}`} disabled={mobile} onClick={() => commit({ kind: 'freeze', sheetId: activeSheetId, before: activeSheet.frozen, after: !activeSheet.frozen })} title="Toggle frozen first column"><Icon name="freeze"/><span>{activeSheet.frozen ? 'Unfreeze' : 'Freeze'} column A</span></button></div>
      <div className="toolbar-right"><span className="shortcut-hint">Double-click to edit</span><button className="tool-button small" title="Rename this sheet" disabled={mobile} onClick={() => { setRenameId(activeSheetId); setRenameText(activeSheet.name); }}><Icon name="edit" size={16}/><span>Rename</span></button></div>
    </div>

    <div className="formula-line"><label className="address-box" htmlFor="formula-editor">{activeAddress}</label><span className="formula-symbol" aria-hidden="true">ƒx</span><input id="formula-editor" className="formula-input" aria-label={`Raw value of ${activeAddress}`} spellCheck={false} value={formulaDraft} onFocus={() => setFormulaFocused(true)} onBlur={() => { if (skipFormulaBlurRef.current) { skipFormulaBlurRef.current = false; return; } if (formulaFocused) { changeCell(activeAddress, formulaDraft); setFormulaFocused(false); } }} onChange={event => setFormulaDraft(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); changeCell(activeAddress, formulaDraft); setFormulaFocused(false); gridRef.current?.focus(); } else if (event.key === 'Escape') { event.preventDefault(); skipFormulaBlurRef.current = true; setFormulaDraft(activeRaw); setFormulaFocused(false); gridRef.current?.focus(); } }} readOnly={mobile}/><span className="formula-result" title="Computed result">{activeRaw.startsWith('=') ? activeResult : ''}</span></div>

    {mobile && <div className="mobile-note">Read-only on phone. Open on a tablet or desktop to edit cells.</div>}

    <div className="grid-area"><Grid key={activeSheetId} ref={gridRef} sheet={activeSheet} engine={engine} selection={selection} revision={revision} readOnly={mobile} onSelect={select} onChangeCell={changeCell} onClear={clearSelection} onUndo={undo} onRedo={redo} onCopy={copy} onCut={cut} onPaste={paste} onResize={(column, width) => { const before = activeSheet.widths[column] || DEFAULT_COL_WIDTH; if (before !== width) commit({ kind: 'width', sheetId: activeSheetId, column, before, after: width }); }}/>
      {!Object.keys(activeSheet.cells).length && <div className="empty-sheet-hint"><div className="empty-sheet-glyph"><Icon name="grid" size={24}/></div><strong>A fresh sheet</strong><p>Choose a cell and start typing. Use the formula bar for expressions.</p></div>}
    </div>

    <div className="bottom-bar"><div className="tab-strip" role="tablist" aria-label="Sheets">{workbook.sheets.map(sheet => renameId === sheet.id ? <input key={sheet.id} autoFocus className="rename-field" aria-label="New sheet name" maxLength={80} value={renameText} onChange={event => setRenameText(event.target.value)} onBlur={completeRename} onKeyDown={event => { if (event.key === 'Enter') completeRename(); else if (event.key === 'Escape') setRenameId(null); }} /> : <button key={sheet.id} role="tab" aria-selected={sheet.id === activeSheetId} className={`sheet-tab ${sheet.id === activeSheetId ? 'current' : ''}`} onDoubleClick={() => { if (!mobile) { setRenameId(sheet.id); setRenameText(sheet.name); } }} onClick={() => switchSheet(sheet.id)}><span className="tab-square"/>{sheet.name}</button>)}<button className="add-tab" aria-label="Add a sheet" title="Add sheet" disabled={mobile} onClick={addSheet}><Icon name="plus" size={17}/></button></div><div className="zoom-indicator">100%</div></div>
    <footer className="statusbar"><div className="left-status"><span className="status-ready"><span className="ready-dot"/>Ready</span><span className="status-range">{addressAt(bounds(selection).top, bounds(selection).left)}{bounds(selection).top !== bounds(selection).bottom || bounds(selection).left !== bounds(selection).right ? `:${addressAt(bounds(selection).bottom, bounds(selection).right)}` : ''}</span><span className="sr-only" aria-live="polite">{message}</span><span className="toast-text" title={message}>{message}</span></div><div className="selection-stats"><span>Sum <b>{displayValue(stats.sum)}</b></span><span>Average <b>{displayValue(stats.average)}</b></span><span>Count <b>{stats.count.toLocaleString()}</b></span></div></footer>

    {helpOpen && <div className="dialog-layer" onPointerDown={event => { if (event.target === event.currentTarget) setHelpOpen(false); }}><section className="shortcut-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><div className="dialog-header"><div><span className="section-identifier">Guide</span><h2>Work without the mouse</h2></div><button className="icon-button" title="Close guide" aria-label="Close guide" onClick={() => setHelpOpen(false)}><Icon name="close"/></button></div><div className="shortcut-list"><div><span>Move through cells</span><kbd>Arrow keys</kbd></div><div><span>Extend a selection</span><kbd>Shift + Arrow</kbd></div><div><span>Edit the active cell</span><kbd>F2</kbd></div><div><span>Commit an edit</span><kbd>Enter</kbd></div><div><span>Copy and paste</span><kbd>Ctrl / Cmd + C / V</kbd></div><div><span>Undo and redo</span><kbd>Ctrl / Cmd + Z / Y</kbd></div><div><span>Clear selected cells</span><kbd>Delete</kbd></div></div><div className="dialog-footer"><button className="text-button" onClick={() => { setHelpOpen(false); void resetDemo(); }}>Reset demo fixtures</button><button className="primary-button" onClick={() => setHelpOpen(false)}>Back to sheet</button></div></section></div>}
  </div>;
}
