'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { addressAt, bounds, clampPosition, columnLabel, isWithin, type Selection } from '@/lib/address';
import { displayValue, FormulaEngine, isFormulaError } from '@/lib/formulas';
import { DEFAULT_COL_WIDTH, HEADER_HEIGHT, MAX_COLS, MAX_ROWS, ROW_HEADER_WIDTH, ROW_HEIGHT, type Sheet } from '@/lib/types';

export type GridHandle = { focus: () => void; moveTo: (row: number, col: number) => void };
type GridProps = {
  sheet: Sheet;
  engine: FormulaEngine;
  selection: Selection;
  revision: number;
  readOnly: boolean;
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

export const Grid = forwardRef<GridHandle, GridProps>(function Grid(props, forwardedRef) {
  const { sheet, engine, selection, readOnly, onSelect, onChangeCell, onClear, onUndo, onRedo, onCopy, onCut, onPaste, onResize } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(550);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draftWidth, setDraftWidth] = useState<{ col: number; width: number } | null>(null);
  const { focus } = selection;
  const widths = useMemo(() => Array.from({ length: MAX_COLS }, (_, i) => draftWidth?.col === i ? draftWidth.width : sheet.widths[i] || DEFAULT_COL_WIDTH), [sheet.widths, draftWidth]);
  const totalWidth = ROW_HEADER_WIDTH + widths.reduce((sum, width) => sum + width, 0);
  const rowStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 7);
  const rowEnd = Math.min(MAX_ROWS, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 7);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => setViewportHeight(scroll.clientHeight));
    observer.observe(scroll);
    setViewportHeight(scroll.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const finish = () => setDragging(false);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => { window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); };
  }, [dragging]);

  useEffect(() => { if (editor) inputRef.current?.focus(); }, [editor?.row, editor?.col]);

  const moveTo = useCallback((row: number, col: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const top = HEADER_HEIGHT + row * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const scrolledTop = element.scrollTop;
    if (top < scrolledTop + HEADER_HEIGHT) element.scrollTop = Math.max(0, top - HEADER_HEIGHT);
    else if (bottom > scrolledTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
    if (col === 0) return;
    const left = ROW_HEADER_WIDTH + widths.slice(0, col).reduce((sum, width) => sum + width, 0);
    const right = left + widths[col];
    const stationary = ROW_HEADER_WIDTH + (sheet.frozen ? widths[0] : 0);
    if (left < element.scrollLeft + stationary) element.scrollLeft = Math.max(0, left - stationary);
    else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
  }, [widths, sheet.frozen]);

  useImperativeHandle(forwardedRef, () => ({ focus: () => scrollRef.current?.focus(), moveTo }), [moveTo]);

  const commitEditor = useCallback((next?: string) => {
    if (!editor) return;
    onChangeCell(addressAt(editor.row, editor.col), next ?? editor.text);
    setEditor(null);
  }, [editor, onChangeCell]);

  function startEdit(value?: string) {
    if (readOnly) return;
    setEditor({ row: focus.row, col: focus.col, text: value ?? sheet.cells[addressAt(focus.row, focus.col)] ?? '' });
  }

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== scrollRef.current) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) onRedo(); else onUndo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); onRedo(); return; }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelect(0, 0, false, false);
      onSelect(MAX_ROWS - 1, MAX_COLS - 1, true, false);
      return;
    }
    if ((mod && !['Home', 'End'].includes(event.key)) || event.altKey) return;
    const movements: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      Tab: [0, event.shiftKey ? -1 : 1], Enter: [event.shiftKey ? -1 : 1, 0],
      PageDown: [Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT)), 0],
      PageUp: [-Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT)), 0],
    };
    if (event.key in movements) {
      event.preventDefault();
      const [dr, dc] = movements[event.key];
      const next = clampPosition(focus.row + dr, focus.col + dc);
      onSelect(next.row, next.col, event.shiftKey && event.key.startsWith('Arrow'), false);
      moveTo(next.row, next.col);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = clampPosition(event.ctrlKey || event.metaKey ? event.key === 'Home' ? 0 : MAX_ROWS - 1 : focus.row, event.key === 'Home' ? 0 : MAX_COLS - 1);
      onSelect(next.row, next.col, event.shiftKey, false);
      moveTo(next.row, next.col);
      return;
    }
    if (event.key === 'Escape') { onSelect(focus.row, focus.col, false, false); return; }
    if (readOnly) return;
    if (event.key === 'F2') { event.preventDefault(); startEdit(); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); onClear(); return; }
    if (event.key.length === 1 && !event.metaKey) { event.preventDefault(); startEdit(event.key); }
  };

  function handleCellPointer(event: PointerEvent<HTMLDivElement>, row: number, col: number) {
    if (event.button !== 0) return;
    if (event.pointerType !== 'touch') event.preventDefault();
    onSelect(row, col, event.shiftKey, true);
    if (event.pointerType !== 'touch') setDragging(true);
    scrollRef.current?.focus();
  }

  function handleResize(event: PointerEvent<HTMLSpanElement>, col: number) {
    event.stopPropagation();
    event.preventDefault();
    const start = event.clientX, baseline = widths[col];
    const move = (e: globalThis.PointerEvent) => setDraftWidth({ col, width: Math.max(88, Math.min(360, baseline + e.clientX - start)) });
    const stop = (e: globalThis.PointerEvent) => {
      const width = Math.max(88, Math.min(360, baseline + e.clientX - start));
      setDraftWidth(null);
      onResize(col, width);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  const activeAddress = addressAt(focus.row, focus.col);
  const activeRaw = sheet.cells[activeAddress] || '';
  const activeResult = displayValue(engine.evaluate(activeAddress));
  return <>
    <div className="sr-only" aria-live="polite" aria-atomic="true">Cell {activeAddress}. {activeRaw.startsWith('=') ? `Formula ${activeRaw}. Result ${activeResult}` : activeRaw ? `Value ${activeResult}` : 'Empty'}</div>
    <div className="grid-viewport" ref={scrollRef} role="grid" tabIndex={0} aria-label={`${sheet.name} spreadsheet`} aria-rowcount={MAX_ROWS + 1} aria-colcount={MAX_COLS + 1} aria-activedescendant={`cell-${sheet.id}-${activeAddress}`} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={handleKeyboard} onCopy={onCopy} onCut={onCut} onPaste={onPaste}>
      <div className="grid-canvas" style={{ width: totalWidth, height: HEADER_HEIGHT + MAX_ROWS * ROW_HEIGHT }}>
        <div className="column-headings" role="row" style={{ width: totalWidth }}>
          <div role="columnheader" className="corner heading" style={{ width: ROW_HEADER_WIDTH }} aria-label="Select all" />
          {widths.map((width, col) => <div key={col} role="columnheader" aria-colindex={col + 2} className={`heading column-heading ${col === focus.col ? 'axis-active' : ''} ${col === 0 && sheet.frozen ? 'frozen-column' : ''}`} style={{ width, left: col === 0 && sheet.frozen ? ROW_HEADER_WIDTH : undefined }}>
            {columnLabel(col)}
            <span className="resize-grip" title={`Resize column ${columnLabel(col)}`} role="separator" aria-label={`Resize column ${columnLabel(col)}`} tabIndex={0} onPointerDown={event => handleResize(event, col)} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); onResize(col, Math.max(88, Math.min(360, width + (event.key === 'ArrowRight' ? 16 : -16)))); } }} />
          </div>)}
        </div>
        {Array.from({ length: rowEnd - rowStart }, (_, index) => rowStart + index).map(row => <div key={row} className="grid-row" role="row" aria-rowindex={row + 2} style={{ top: HEADER_HEIGHT + row * ROW_HEIGHT, width: totalWidth, height: ROW_HEIGHT }}>
          <div className={`row-number heading ${focus.row === row ? 'axis-active' : ''}`} role="rowheader" style={{ width: ROW_HEADER_WIDTH }} aria-label={`Row ${row + 1}`}>{row + 1}</div>
          {widths.map((width, col) => {
            const address = addressAt(row, col);
            const raw = sheet.cells[address] || '';
            const value = engine.evaluate(address);
            const error = isFormulaError(value);
            const active = focus.row === row && focus.col === col;
            const selected = isWithin(selection, row, col);
            const currentlyEditing = editor?.row === row && editor.col === col;
            return <div key={address} id={`cell-${sheet.id}-${address}`} role="gridcell" aria-colindex={col + 2} aria-selected={selected} aria-label={`${address}, ${raw ? displayValue(value) : 'empty'}`} className={`data-cell ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''} ${raw.startsWith('=') ? 'is-computed' : ''} ${error ? 'is-error' : ''} ${col === 0 && sheet.frozen ? 'frozen-column' : ''}`} style={{ width, left: col === 0 && sheet.frozen ? ROW_HEADER_WIDTH : undefined }} onPointerDown={event => handleCellPointer(event, row, col)} onPointerEnter={() => { if (dragging) onSelect(row, col, true, false); }} onDoubleClick={() => { if (!readOnly) { onSelect(row, col); setEditor({ row, col, text: raw }); } }}>
              {currentlyEditing ? <input ref={inputRef} className="cell-input" aria-label={`Edit ${address}`} value={editor.text} onChange={event => setEditor({ ...editor, text: event.target.value })} onPointerDown={event => event.stopPropagation()} onBlur={() => commitEditor()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setEditor(null); scrollRef.current?.focus(); } else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); const next = clampPosition(row + (event.key === 'Enter' ? event.shiftKey ? -1 : 1 : 0), col + (event.key === 'Tab' ? event.shiftKey ? -1 : 1 : 0)); commitEditor(event.currentTarget.value); onSelect(next.row, next.col); moveTo(next.row, next.col); scrollRef.current?.focus(); } }} /> : <span className={`cell-content ${typeof value === 'number' || (!raw.startsWith('=') && raw.trim() !== '' && Number.isFinite(Number(raw))) ? 'numeric' : ''}`}>{displayValue(value)}</span>}
            </div>;
          })}
        </div>)}
      </div>
    </div>
  </>;
});
