'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FUNCTIONS, findFunction, splitFunctionArguments } from '@/lib/function-catalog';
import { displayValue, FormulaEngine, isFormulaError } from '@/lib/formulas';
import { Icon } from './Icons';

export function FunctionDialog({ address, raw, engine, onInsert, onClose }: {
  address: string;
  raw: string;
  engine: FormulaEngine;
  onInsert: (formula: string) => void;
  onClose: () => void;
}) {
  const initial = /^=([A-Z]+)\((.*)\)$/is.exec(raw);
  const initialFunction = initial ? findFunction(initial[1]) : undefined;
  const [name, setName] = useState(initialFunction?.name || 'SUM');
  const [query, setQuery] = useState('');
  const [args, setArgs] = useState<string[]>(initialFunction && initial ? splitFunctionArguments(initial[2]) : ['']);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const definition = findFunction(name)!;
  const functions = FUNCTIONS.filter(fn => query.toLowerCase().trim().split(/\s+/).every(word => `${fn.name} ${fn.aliases.join(' ')} ${fn.description}`.toLowerCase().includes(word)));
  const formula = `=${name}(${args.filter(value => value.trim()).join(',')})`;
  const hasArguments = args.some(value => value.trim());
  const preview = useMemo(() => hasArguments ? engine.preview(formula, address) : '', [engine, formula, address, hasArguments]);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    return () => dialog?.close();
  }, []);

  return <dialog ref={dialogRef} className="function-dialog" aria-labelledby="insert-function-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <form onSubmit={event => { event.preventDefault(); if (hasArguments && formula.length <= 4000) onInsert(formula); }}>
      <div className="dialog-header"><div><h2 id="insert-function-title">Insert function</h2><p className="function-target">Into {address}</p></div><button type="button" className="icon-button" aria-label="Close functions" onClick={onClose}><Icon name="close"/></button></div>
      <label className="function-search-label" htmlFor="function-search">Search for a function</label>
      <input id="function-search" className="function-search" type="search" placeholder="Try sum, average, or add numbers" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
      <div className="function-list" aria-label="Available functions">{functions.map(fn => <button key={fn.name} type="button" className={`function-choice ${fn.name === name ? 'selected' : ''}`} aria-pressed={fn.name === name} onClick={() => setName(fn.name)}><strong>{fn.name}</strong><span>{fn.description}</span></button>)}{!functions.length && <p className="function-no-results">No matching functions. Available: SUM, AVERAGE, and the AVG alias.</p>}</div>
      <div className="function-details"><code>{definition.syntax}</code><p>{definition.parameter}</p><span>Example: <code>{definition.example}</code></span></div>
      <div className="function-arguments">{args.map((value, index) => <div className="function-argument" key={index}><label htmlFor={`function-argument-${index}`}>Number {index + 1}{index > 0 && <span> (optional)</span>}</label><div><input id={`function-argument-${index}`} aria-label={`Number ${index + 1}`} autoComplete="off" spellCheck={false} placeholder={index === 0 ? 'A1:A10' : 'B1 or 5'} maxLength={3900} value={value} onChange={event => setArgs(current => current.map((arg, i) => i === index ? event.target.value : arg))}/>{args.length > 1 && <button type="button" className="icon-button" aria-label={`Remove argument ${index + 1}`} onClick={() => setArgs(current => current.filter((_, i) => i !== index))}><Icon name="close" size={15}/></button>}</div></div>)}</div>
      <button type="button" className="text-button add-argument" onClick={() => setArgs(current => [...current, ''])} disabled={args.length >= 12}>Add argument</button>
      <div className="function-preview"><code>{formula}</code><span className={isFormulaError(preview) ? 'preview-error' : ''}>Result: <b>{hasArguments ? displayValue(preview) : '—'}</b></span></div>
      <p className="function-scope">Preview uses current cell values. This sheet supports SUM and AVERAGE (also AVG), arithmetic, parentheses, and cell references. Other Excel functions are unavailable.</p>
      {formula.length > 4000 && <p role="alert" className="preview-error">Keep the formula under 4,000 characters.</p>}
      <div className="dialog-footer"><button type="button" className="text-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={!hasArguments || formula.length > 4000}>Insert function</button></div>
    </form>
  </dialog>;
}
