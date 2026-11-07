'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { addressAt, bounds, clampPosition, columnLabel, isWithin, parseAddress, type Selection } from '@/lib/address';
import { displayValue, FormulaEngine, isFormulaError } from '@/lib/formulas';
import { FormulaInput } from './FormulaInput';
import { DEFAULT_COL_WIDTH, HEADER_HEIGHT, INITIAL_COLS, MAX_ROWS, ROW_HEADER_WIDTH, ROW_HEIGHT, type Sheet } from '@/lib/types';

export type GridHandle = { focus: () => void; moveTo: (row: number, col: number) => void; takeDraft: () => string | null; edit: (text: string) => void };
type GridProps = {
  sheet: Sheet;
  readOnly: boolean;
  engine: FormulaEngine;
  selection: Selection;
  revision: number;
  onSelect: (row: number, col: number, extend?: boolean, push?: boolean) => void;
  onChangeCell: (address: string, value: string) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: (event: ClipboardEvent<HTMLDivElement>) => void;
  onCut: (event: ClipboardEvent<HTMLDivElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onResize: (col: number, width: number) => void;
};
type Editor = { row: number; col: number; text: string };
const constrainWidth = (width: number) => Math.max(64, Math.min(600, width));

export const Grid = forwardRef<GridHandle, GridProps>(function Grid(props, forwardedRef) {
  const { sheet, readOnly, engine, selection, onSelect, onChangeCell, onClear, onUndo, onRedo, onCopy, onCut, onPaste, onResize } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [viewport, setViewport] = useState({ top: 0, left: 0, height: 550, width: 1200 });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draftWidth, setDraftWidth] = useState<{ col: number; width: number } | null>(null);
  const { focus } = selection;
  const columnCount = Math.max(INITIAL_COLS, sheet.widths.length, focus.col + 1);
  const widths = useMemo(() => Array.from({ length: columnCount }, (_, i) => draftWidth?.col === i ? draftWidth.width : sheet.widths[i] || DEFAULT_COL_WIDTH), [columnCount, sheet.widths, draftWidth]);
  const offsets = useMemo(() => {
    const result = [ROW_HEADER_WIDTH];
    widths.forEach(width => result.push(result[result.length - 1] + width));
    return result;
  }, [widths]);
  const visibleCols = widths.map((_, col) => col).filter(col => (col === 0 && sheet.frozen) || (offsets[col + 1] >= viewport.left - DEFAULT_COL_WIDTH && offsets[col] <= viewport.left + viewport.width + DEFAULT_COL_WIDTH));
  const rowStart = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - 7);
  const rowEnd = Math.min(MAX_ROWS, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + 7);
  const totalWidth = offsets[offsets.length - 1];

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const update = () => setViewport({ top: scroll.scrollTop, left: scroll.scrollLeft, height: scroll.clientHeight, width: scroll.clientWidth });
    const observer = new ResizeObserver(update);
    observer.observe(scroll); update();
    return () => { observer.disconnect(); cleanupRef.current?.(); };
  }, []);
  useEffect(() => { inputRef.current?.focus(); }, [editor?.row, editor?.col]);

  const moveTo = useCallback((row: number, col: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const top = HEADER_HEIGHT + row * ROW_HEIGHT;
    if (top < element.scrollTop + HEADER_HEIGHT) element.scrollTop = row * ROW_HEIGHT;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    if (col === 0 && sheet.frozen) return;
    const left = offsets[col] ?? totalWidth + (col - widths.length) * DEFAULT_COL_WIDTH;
    const right = left + (widths[col] || DEFAULT_COL_WIDTH);
    const stationary = ROW_HEADER_WIDTH + (sheet.frozen ? widths[0] : 0);
    if (left < element.scrollLeft + stationary) element.scrollLeft = Math.max(0, left - stationary);
    else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
  }, [offsets, widths, totalWidth, sheet.frozen]);
  // moving after layout also handles a newly revealed column and browser history.
  useEffect(() => { moveTo(focus.row, focus.col); }, [focus.row, focus.col, moveTo]);
  useImperativeHandle(forwardedRef, () => ({ focus: () => scrollRef.current?.focus({ preventScroll: true }), moveTo, takeDraft: () => { const text = editor?.text ?? null; setEditor(null); return text; }, edit: text => { if (!readOnly) setEditor({ row: focus.row, col: focus.col, text }); } }), [moveTo, editor, focus.row, focus.col, readOnly]);

  const commitEditor = (next?: string) => {
    if (readOnly || !editor) return;
    onChangeCell(addressAt(editor.row, editor.col), next ?? editor.text);
    setEditor(null);
  };
  function startEdit(value?: string) {
    if (readOnly) return;
    setEditor({ row: focus.row, col: focus.col, text: value ?? sheet.cells[addressAt(focus.row, focus.col)] ?? '' });
  }
  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== scrollRef.current) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) onRedo(); else onUndo(); return; }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); onRedo(); return; }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault(); onSelect(MAX_ROWS - 1, columnCount - 1); onSelect(0, 0, true); return;
    }
    if ((mod && !['Home', 'End'].includes(event.key)) || event.altKey) return;
    const movements: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      Tab: [0, event.shiftKey ? -1 : 1], Enter: [event.shiftKey ? -1 : 1, 0],
      PageDown: [Math.max(1, Math.floor(viewport.height / ROW_HEIGHT)), 0],
      PageUp: [-Math.max(1, Math.floor(viewport.height / ROW_HEIGHT)), 0],
    };
    if (event.key in movements) {
      event.preventDefault(); const [dr, dc] = movements[event.key];
      const next = clampPosition(focus.row + dr, focus.col + dc);
      onSelect(next.row, next.col, event.shiftKey && event.key.startsWith('Arrow')); return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onSelect(mod ? event.key === 'Home' ? 0 : MAX_ROWS - 1 : focus.row, event.key === 'Home' ? 0 : columnCount - 1, event.shiftKey); return;
    }
    if (event.key === 'Escape') { onSelect(focus.row, focus.col); return; }
    if (readOnly) return;
    if (event.key === 'F2') { event.preventDefault(); startEdit(); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); onClear(); return; }
    if (event.key.length === 1 && !event.metaKey) { event.preventDefault(); startEdit(event.key); }
  };

  function beginRangeDrag(event: PointerEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation();
    cleanupRef.current?.();
    const element = scrollRef.current;
    if (!element) return;
    let x = event.clientX, y = event.clientY, frame = 0;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const dx = x < rect.left + 36 ? -18 : x > rect.right - 36 ? 18 : 0;
      const dy = y < rect.top + HEADER_HEIGHT + 20 ? -18 : y > rect.bottom - 30 ? 18 : 0;
      element.scrollLeft += dx; element.scrollTop += dy;
      const localX = x - rect.left + element.scrollLeft;
      let col = widths.findIndex((_, c) => localX >= offsets[c] && localX < offsets[c + 1]);
      if (sheet.frozen && x - rect.left < ROW_HEADER_WIDTH + widths[0]) col = 0;
      if (col < 0) col = localX < ROW_HEADER_WIDTH ? 0 : widths.length - 1;
      const row = Math.max(0, Math.min(MAX_ROWS - 1, Math.floor((y - rect.top + element.scrollTop - HEADER_HEIGHT) / ROW_HEIGHT)));
      onSelect(row, col, true);
      frame = requestAnimationFrame(update);
    };
    const move = (e: globalThis.PointerEvent) => { x = e.clientX; y = e.clientY; };
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop);
      cleanupRef.current = null;
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    cleanupRef.current = stop;
    frame = requestAnimationFrame(update);
  }
  function handleCellPointer(event: PointerEvent<HTMLDivElement>, row: number, col: number) {
    if (event.button !== 0 || event.target instanceof HTMLInputElement) return;
    onSelect(row, col, event.shiftKey, true);
    if (event.pointerType !== 'touch') { scrollRef.current?.focus({ preventScroll: true }); beginRangeDrag(event); }
  }
  function handleResize(event: PointerEvent<HTMLSpanElement>, col: number) {
    event.stopPropagation(); event.preventDefault(); cleanupRef.current?.();
    const start = event.clientX, baseline = widths[col];
    const move = (e: globalThis.PointerEvent) => setDraftWidth({ col, width: constrainWidth(baseline + e.clientX - start) });
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', cancel); cleanupRef.current = null; };
    const stop = (e: globalThis.PointerEvent) => { setDraftWidth(null); if (Math.abs(e.clientX - start) > 2) onResize(col, constrainWidth(baseline + e.clientX - start)); cleanup(); };
    const cancel = () => { setDraftWidth(null); cleanup(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', cancel);
    cleanupRef.current = cancel;
  }
  function autoFit(col: number) {
    const context = document.createElement('canvas').getContext('2d');
    if (!context || !scrollRef.current) return;
    context.font = `12.5px ${getComputedStyle(scrollRef.current).fontFamily}`;
    let size = 64;
    for (const address of Object.keys(sheet.cells)) if (parseAddress(address)?.col === col) {
      size = Math.max(size, context.measureText(displayValue(engine.evaluate(address))).width + 26);
    }
    onResize(col, constrainWidth(Math.ceil(size)));
  }
  const activeAddress = addressAt(focus.row, focus.col);
  const activeRaw = sheet.cells[activeAddress] || '';
  const activeResult = displayValue(engine.evaluate(activeAddress));
  const rect = bounds(selection);
  const selectColumn = (col: number) => { onSelect(MAX_ROWS - 1, col); onSelect(0, col, true); };
  const selectRow = (row: number) => { onSelect(row, columnCount - 1); onSelect(row, 0, true); };
  // Native sticky positioning stays in sync with compositor-driven touch scrolling.
  const columnLeft = (col: number) => col === 0 && sheet.frozen ? ROW_HEADER_WIDTH : offsets[col];

  return <>
    <div className="sr-only" aria-live="polite" aria-atomic="true">Cell {activeAddress}. {activeRaw.startsWith('=') ? `Formula ${activeRaw}. Result ${activeResult}` : activeRaw ? `Value ${activeResult}` : 'Empty'}</div>
    <div className="grid-viewport" ref={scrollRef} role="grid" aria-readonly={readOnly} tabIndex={0} aria-label={`${sheet.name} spreadsheet`} aria-rowcount={MAX_ROWS + 1} aria-colcount={columnCount + 1} aria-activedescendant={focus.row >= rowStart && focus.row < rowEnd && visibleCols.includes(focus.col) ? `cell-${sheet.id}-${activeAddress}` : undefined} onScroll={event => { const el = event.currentTarget; setViewport({ top: el.scrollTop, left: el.scrollLeft, height: el.clientHeight, width: el.clientWidth }); }} onKeyDown={handleKeyboard} onCopy={onCopy} onCut={onCut} onPaste={onPaste}>
      <div className="grid-canvas" style={{ width: totalWidth, height: HEADER_HEIGHT + MAX_ROWS * ROW_HEIGHT }}>
        <div className="column-headings" role="row" style={{ width: totalWidth }}>
          <button role="columnheader" className="corner heading" style={{ width: ROW_HEADER_WIDTH }} aria-label="Select all" onClick={() => { onSelect(MAX_ROWS - 1, columnCount - 1); onSelect(0, 0, true); }} />
          {visibleCols.map(col => <div key={col} role="columnheader" aria-colindex={col + 2} className={`heading column-heading ${col >= rect.left && col <= rect.right ? 'axis-active' : ''} ${col === 0 && sheet.frozen ? 'frozen-column' : ''}`} style={{ width: widths[col], left: columnLeft(col) }}>
            <button className="axis-button" aria-label={`Select column ${columnLabel(col)}`} onClick={() => selectColumn(col)}>{columnLabel(col)}</button>
            {!readOnly && <span className="resize-grip" title={`Resize column ${columnLabel(col)}; double-click to fit`} role="separator" aria-orientation="vertical" aria-valuenow={widths[col]} aria-valuemin={64} aria-valuemax={600} aria-label={`Resize column ${columnLabel(col)}`} tabIndex={0} onDoubleClick={event => { event.stopPropagation(); autoFit(col); }} onPointerDown={event => handleResize(event, col)} onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); autoFit(col); }
              else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); onResize(col, constrainWidth(widths[col] + (event.key === 'ArrowRight' ? 16 : -16))); }
            }} />}
          </div>)}
        </div>
        {Array.from({ length: rowEnd - rowStart }, (_, index) => rowStart + index).map(row => <div key={row} className="grid-row" role="row" aria-rowindex={row + 2} style={{ top: HEADER_HEIGHT + row * ROW_HEIGHT, width: totalWidth, height: ROW_HEIGHT }}>
          <button className={`row-number heading ${row >= rect.top && row <= rect.bottom ? 'axis-active' : ''}`} role="rowheader" style={{ width: ROW_HEADER_WIDTH }} aria-label={`Select row ${row + 1}`} onClick={() => selectRow(row)}>{row + 1}</button>
          {visibleCols.map(col => {
            const address = addressAt(row, col), raw = sheet.cells[address] || '';
            const value = engine.evaluate(address), error = isFormulaError(value);
            const active = focus.row === row && focus.col === col;
            const selected = isWithin(selection, row, col);
            const currentlyEditing = editor?.row === row && editor.col === col;
            return <div key={address} id={`cell-${sheet.id}-${address}`} role="gridcell" aria-colindex={col + 2} aria-selected={selected} aria-label={`${address}, ${raw ? displayValue(value) : 'empty'}`} className={`data-cell ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''} ${raw.startsWith('=') ? 'is-computed' : ''} ${error ? 'is-error' : ''} ${col === 0 && sheet.frozen ? 'frozen-column' : ''}`} style={{ width: widths[col], left: columnLeft(col) }} onPointerDown={event => handleCellPointer(event, row, col)} onDoubleClick={() => { onSelect(row, col); if (!readOnly) setEditor({ row, col, text: raw }); }}>
              {currentlyEditing ? <FormulaInput ref={inputRef} className="cell-input" aria-label={`Edit ${address}`} value={editor.text} onValueChange={text => setEditor({ ...editor, text })} onPointerDown={event => event.stopPropagation()} onBlur={() => commitEditor()} onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Escape') { event.preventDefault(); setEditor(null); scrollRef.current?.focus(); }
                else if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault(); const next = clampPosition(row + (event.key === 'Enter' ? event.shiftKey ? -1 : 1 : 0), col + (event.key === 'Tab' ? event.shiftKey ? -1 : 1 : 0));
                  commitEditor(event.currentTarget.value); onSelect(next.row, next.col); scrollRef.current?.focus();
                }
              }} /> : <span className={`cell-content ${typeof value === 'number' || (!raw.startsWith('=') && raw.trim() !== '' && Number.isFinite(Number(raw))) ? 'numeric' : ''}`}>{displayValue(value)}</span>}
              {active && !currentlyEditing && <button className="range-handle" aria-label="Extend selection" title="Drag to select a range" onPointerDown={beginRangeDrag} />}
            </div>;
          })}
        </div>)}
      </div>
    </div>
  </>;
});
