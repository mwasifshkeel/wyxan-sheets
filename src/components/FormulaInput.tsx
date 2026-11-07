'use client';

import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { completeFunction, functionContext, functionSuggestions } from '@/lib/function-catalog';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
};

export const FormulaInput = forwardRef<HTMLInputElement, Props>(function FormulaInput({ value, onValueChange, onFocus, onBlur, onKeyDown, onSelect, ...props }, forwardedRef) {
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const suggestions = focused && !props.readOnly && !dismissed ? functionSuggestions(value, caret) : [];
  const context = focused && !props.readOnly && !dismissed ? functionContext(value, caret) : null;
  const selected = Math.min(highlighted, Math.max(0, suggestions.length - 1));
  const showPopup = !!(suggestions.length || context);
  useImperativeHandle(forwardedRef, () => inputRef.current!, []);

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(caret, caret);
    pendingCaretRef.current = null;
  }, [value, caret]);

  useLayoutEffect(() => {
    if (!showPopup) return;
    const update = () => {
      const input = inputRef.current, popup = popupRef.current;
      if (!input || !popup) return;
      const rect = input.getBoundingClientRect();
      const screenBottom = (window.visualViewport?.height || window.innerHeight) + (window.visualViewport?.offsetTop || 0);
      const width = Math.min(360, window.innerWidth - 16);
      popup.style.width = `${width}px`;
      popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      const height = popup.offsetHeight;
      const top = rect.bottom + height + 8 > screenBottom && rect.top > height + 8 ? rect.top - height - 4 : rect.bottom + 4;
      popup.style.top = `${Math.max(8, Math.min(top, screenBottom - height - 8))}px`;
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); window.visualViewport?.removeEventListener('resize', update); };
  }, [showPopup, value, caret]);

  const choose = (index: number) => {
    const option = suggestions[index];
    if (!option) return;
    const result = completeFunction(value, caret, option.name, option.start);
    pendingCaretRef.current = result.caret;
    onValueChange(result.text); setCaret(result.caret); setHighlighted(0); setDismissed(false);
  };

  return <>
    <input {...props} maxLength={Math.min(props.maxLength ?? 4000, 4000)} autoComplete={props.autoComplete || 'off'} ref={inputRef} value={value} role={suggestions.length ? 'combobox' : undefined} aria-autocomplete="list" aria-expanded={suggestions.length ? true : undefined} aria-controls={suggestions.length ? `${id}-list` : undefined} aria-activedescendant={suggestions.length ? `${id}-option-${selected}` : undefined} aria-describedby={context ? `${id}-parameters` : props['aria-describedby']} onFocus={event => {
      setFocused(true); setCaret(event.currentTarget.selectionStart ?? value.length); setDismissed(false); onFocus?.(event);
    }} onBlur={event => { setFocused(false); onBlur?.(event); }} onChange={event => {
      onValueChange(event.target.value.slice(0, 4000)); setCaret(Math.min(event.target.selectionStart ?? event.target.value.length, 4000)); setHighlighted(0); setDismissed(false);
    }} onSelect={event => { setCaret(event.currentTarget.selectionStart ?? value.length); onSelect?.(event); }} onKeyDown={event => {
      if (suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); event.stopPropagation(); setHighlighted((selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); return;
      }
      if (suggestions.length && (event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation(); choose(selected); return;
      }
      if (showPopup && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
      onKeyDown?.(event);
    }} />
    {showPopup && createPortal(<div ref={popupRef} className="formula-assistance" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      {suggestions.length > 0 && <><div id={`${id}-list`} role="listbox" aria-label="Function suggestions">{suggestions.map((option, index) => <button type="button" key={option.name} role="option" tabIndex={-1} id={`${id}-option-${index}`} aria-selected={index === selected} className={`function-option ${index === selected ? 'highlighted' : ''}`} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}><strong>{option.name}</strong><span>{option.definition.description}</span></button>)}</div><div className="formula-assistance-note">Tab or Enter to complete · Esc to dismiss</div></>}
      {context && <div id={`${id}-parameters`} className="function-parameters" role="status"><div><b>{context.name}</b>(<span className={context.argument === 0 ? 'current-parameter' : ''}>number1</span>, <span className={context.argument > 0 ? 'current-parameter' : ''}>[number2], …</span>)</div><p>Argument {context.argument + 1}: {context.definition.parameter}</p></div>}
    </div>, document.body)}
  </>;
});
