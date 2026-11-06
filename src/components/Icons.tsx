import type { ReactNode } from 'react';

type Name = 'grid' | 'undo' | 'redo' | 'copy' | 'plus' | 'check' | 'alert' | 'refresh' | 'freeze' | 'sun' | 'moon' | 'keyboard' | 'edit' | 'chevron' | 'info' | 'menu' | 'close';
const paths: Record<Name, ReactNode> = {
  grid: <><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9h17M9 3.5v17M15 3.5v17M3.5 15h17"/></>,
  undo: <><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></>,
  redo: <><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.7 9A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.3-2"/></>,
  freeze: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
  moon: <path d="M20 15.4A8.5 8.5 0 0 1 8.6 4 8.6 8.6 0 1 0 20 15.4Z"/>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10"/></>,
  edit: <><path d="M12 20h9M4 16.5 15.5 5a2.1 2.1 0 0 1 3 3L7 19.5 3 21z"/></>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  close: <path d="M6 6l12 12M18 6 6 18"/>,
};

export function Icon({ name, size = 18 }: { name: Name; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
