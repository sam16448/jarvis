import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ItemType, Occ } from '../engine/types';

export function typeClass(t: ItemType | string | undefined): string {
  switch (t) {
    case 'exam': return 't-exam';
    case 'study': case 'examprep': case 'course': return 't-study';
    case 'assignment': case 'lab': return 't-assignment';
    case 'club': return 't-club';
    case 'personal': case 'event': return 't-personal';
    case 'block': return 't-block';
    default: return 't-routine';
  }
}

export const LEGEND: [string, string][] = [
  ['t-exam', 'Exam'], ['t-study', 'Study'], ['t-assignment', 'Assignment'], ['t-club', 'Club'], ['t-personal', 'Personal'], ['t-block', 'Blocked'],
];

export function isRoutine(o: Occ) { return o.source === 'template' && o.role !== 'club'; }

export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet fade" role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        <div className="grab" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

/** Hash route like '#/calendar?d=2026-10-12' */
export function useRoute(): { path: string; params: URLSearchParams } {
  const read = () => {
    const h = location.hash.replace(/^#/, '') || '/today';
    const [path, q] = h.split('?');
    return { path, params: new URLSearchParams(q) };
  };
  const [r, setR] = useState(read);
  useEffect(() => {
    const f = () => setR(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}

export function go(path: string) { location.hash = path; }

/** Track on-screen keyboard height (iOS) so the input bar stays visible. */
export function useKeyboardOffset() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const f = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
      setOpen(kb > 80);
    };
    vv.addEventListener('resize', f);
    vv.addEventListener('scroll', f);
    f();
    return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); };
  }, []);
  return open;
}

export function Pill({ risk }: { risk: string }) {
  const cls = risk === 'on track' || risk === 'done' ? 'ok' : risk === 'tight' ? 'warn' : 'bad';
  return <span className={`pill ${cls}`}>{risk}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
