import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dayLoad } from '../engine/metrics';
import { addDays, at, clock, DAY, range, dateRange, dayLabel, dayNum, fmtHM, fromT, hm, MONTHS, shortDate, toT, weekday, WEEKDAYS } from '../engine/time';
import { timeline } from '../engine/timeline';
import type { Occ, State } from '../engine/types';
import { nowStr, propose, today, useApp } from '../store/store';
import { openSheet } from './bus';
import { go, isRoutine, LEGEND, typeClass } from './common';

type View = 'month' | 'week' | 'day';

export function Calendar({ params }: { params: URLSearchParams }) {
  const { st } = useApp();
  const view = (params.get('v') as View) || 'week';
  const d = params.get('d') || today();
  const nav = (v: View, date: string) => go(`/calendar?v=${v}&d=${date}`);
  const step = (n: number) => {
    if (view === 'day') nav(view, addDays(d, n));
    else if (view === 'week') nav(view, addDays(d, 7 * n));
    else { const [y, m] = d.split('-').map(Number); const nm = new Date(Date.UTC(y, m - 1 + n, 1)); nav(view, nm.toISOString().slice(0, 10)); }
  };
  const title = view === 'month' ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
    : view === 'week' ? `Week of ${shortDate(weekStart(d))}` : `${dayLabel(d, today())}, ${shortDate(d)}`;
  return (
    <>
      <h1 className="sr-only">Calendar</h1>
      <div className="seg" role="group" aria-label="Calendar view">
        {(['month', 'week', 'day'] as View[]).map(v => (
          <button key={v} aria-pressed={view === v} onClick={() => nav(v, d)}>{v[0].toUpperCase() + v.slice(1)}</button>
        ))}
      </div>
      <div className="spread">
        <button className="icon-btn filled" aria-label="Previous" onClick={() => step(-1)}><CaretLeft size={20} aria-hidden="true" /></button>
        <h2 className="num" style={{ fontSize: 17 }}>{title}</h2>
        <div className="row">
          <button className="btn ghost" onClick={() => nav(view, today())}>Today</button>
          <button className="icon-btn filled" aria-label="Next" onClick={() => step(1)}><CaretRight size={20} aria-hidden="true" /></button>
        </div>
      </div>
      {view === 'month' && <Month st={st!} d={d} onPick={date => nav('day', date)} />}
      {view === 'week' && <TimeGrid st={st!} dates={dateRange(weekStart(d), addDays(weekStart(d), 6))} hourPx={44} onHead={date => nav('day', date)} />}
      {view === 'day' && <TimeGrid st={st!} dates={[d]} hourPx={64} />}
      <div className="legend" aria-label="Colour key">
        {LEGEND.map(([c, l]) => <span key={c} className={c}><i aria-hidden="true" />{l}</span>)}
      </div>
    </>
  );
}

const weekStart = (d: string) => addDays(d, -((weekday(d) + 6) % 7)); // Monday

function Month({ st, d, onPick }: { st: State; d: string; onPick: (date: string) => void }) {
  const first = `${d.slice(0, 7)}-01`;
  const start = weekStart(first);
  const days = dateRange(start, addDays(start, 41));
  const t = today();
  const month = d.slice(0, 7);
  const info = useMemo(() => {
    const m = new Map<string, { load: number; due: number; exam: boolean }>();
    for (const x of days) m.set(x, { load: dayLoad(st, x).workMin, due: 0, exam: false });
    for (const tk of st.tasks) if (tk.status === 'open' && tk.deadline) { const v = m.get(tk.deadline.slice(0, 10)); if (v) v.due++; }
    for (const e of st.exams) { const v = m.get(e.start.slice(0, 10)); if (v) v.exam = true; }
    return m;
  }, [st, start]); // eslint-disable-line
  return (
    <div className="month" role="grid" aria-label="Month">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <div key={w} className="wd" role="columnheader">{w}</div>)}
      {days.map(x => {
        const v = info.get(x)!;
        const dots = v.load >= 300 ? 3 : v.load >= 180 ? 2 : v.load >= 45 ? 1 : 0;
        const label = `${shortDate(x)}${v.exam ? ', exam' : ''}${v.due ? `, ${v.due} due` : ''}, ${Math.round(v.load / 60)} hours of work`;
        return (
          <button key={x} role="gridcell" aria-label={label} className={`mday${x.slice(0, 7) !== month ? ' other' : ''}${x === t ? ' today' : ''}`} onClick={() => onPick(x)}>
            <span>{Number(x.slice(8))}</span>
            <span className="dots" aria-hidden="true">{Array.from({ length: dots }, (_, i) => <i key={i} />)}</span>
            <span className="dl" aria-hidden="true">{v.exam ? 'EXAM' : v.due ? 'DUE' : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

const MOVABLE = (o: Occ) => (o.source === 'event' || o.source === 'series') && o.status === 'planned';

function layoutLanes(items: Occ[]): Map<string, { lane: number; lanes: number }> {
  const res = new Map<string, { lane: number; lanes: number }>();
  let cluster: Occ[] = [], clusterEnd = -1, ends: number[] = [];
  const flush = () => { const n = ends.length; for (const o of cluster) res.get(o.key)!.lanes = n; cluster = []; ends = []; };
  for (const o of [...items].sort((a, b) => a.s - b.s || b.e - a.e)) {
    if (o.s >= clusterEnd) { flush(); clusterEnd = -1; }
    let lane = ends.findIndex(e => e <= o.s);
    if (lane < 0) { lane = ends.length; ends.push(o.e); } else ends[lane] = o.e;
    res.set(o.key, { lane, lanes: 1 });
    cluster.push(o);
    clusterEnd = Math.max(clusterEnd, o.e);
  }
  flush();
  return res;
}

interface Drag { key: string; mode: 'move' | 'resize'; y0: number; x0: number; dy: number; dx: number; active: boolean; timer?: number; }

function TimeGrid({ st, dates, hourPx, onHead }: { st: State; dates: string[]; hourPx: number; onHead?: (d: string) => void }) {
  const startH = Math.floor(hm(st.settings.wake) / 60);
  const endH = 25;
  const H = (endH - startH) * hourPx;
  const px = (min: number) => (min / 60) * hourPx;
  const nowT = toT(nowStr());
  const t = today();
  const wrap = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const byDate = useMemo(() => {
    const m = new Map<string, Occ[]>();
    const all = timeline(st, dates[0], dates[dates.length - 1]);
    for (const d of dates) {
      const lo = at(d, `${String(startH).padStart(2, '0')}:00`), hi = dayNum(d) * DAY + endH * 60;
      m.set(d, all.filter(o => o.e > lo && o.s < hi && o.status !== 'skipped' && (o.date === d || o.s >= lo)));
    }
    return m;
  }, [st, dates.join(), startH]); // eslint-disable-line

  // block page scroll while dragging (iOS needs a non-passive listener)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const f = (e: TouchEvent) => { if (dragRef.current?.active) e.preventDefault(); };
    el.addEventListener('touchmove', f, { passive: false });
    return () => el.removeEventListener('touchmove', f);
  }, []);

  // open scrolled to the current time (or the first item)
  useEffect(() => {
    const el = wrap.current?.querySelector('.nowline') as HTMLElement | null;
    if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 220) });
  }, [dates.join()]); // eslint-disable-line

  const snap = (min: number) => Math.round(min / 15) * 15;

  const onDown = (e: React.PointerEvent, o: Occ, mode: Drag['mode']) => {
    if (!MOVABLE(o)) return;
    e.stopPropagation();
    const d: Drag = { key: o.key, mode, y0: e.clientY, x0: e.clientX, dy: 0, dx: 0, active: e.pointerType === 'mouse' };
    if (e.pointerType !== 'mouse') d.timer = window.setTimeout(() => { if (dragRef.current?.key === o.key) { setDrag({ ...dragRef.current, active: true }); navigator.vibrate?.(10); } }, 300);
    setDrag(d);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.y0, dx = e.clientX - d.x0;
    if (!d.active) {
      if (Math.abs(dy) > 8 || Math.abs(dx) > 8) { window.clearTimeout(d.timer); setDrag(null); }
      return;
    }
    setDrag({ ...d, dy, dx });
  };
  const onUp = (o: Occ) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    window.clearTimeout(d.timer);
    const moved = Math.abs(d.dy) > 4 || Math.abs(d.dx) > 4;
    if (!d.active || !moved) { openSheet({ kind: 'item', ref: o.key }); return; }
    const deltaMin = snap((d.dy / hourPx) * 60);
    let colShift = 0;
    if (dates.length > 1 && cols.current) colShift = Math.round(d.dx / (cols.current.clientWidth / dates.length));
    const newDate = addDays(o.date, colShift);
    if (d.mode === 'move') {
      const startMin = o.s - dayNum(o.date) * DAY + deltaMin;
      const sT = dayNum(newDate) * DAY + startMin;
      propose({ kind: 'move', target: o.title, ref: o.key, start: fromT(sT), end: fromT(sT + o.e - o.s) }, `Drag ${o.title} to ${shortDate(newDate)} ${clock(sT)}`, 'ui');
    } else {
      const e2 = Math.max(o.s + 15, o.e + deltaMin);
      propose({ kind: 'move', target: o.title, ref: o.key, start: fromT(o.s), end: fromT(e2) }, `Resize ${o.title} to end ${clock(e2)}`, 'ui');
    }
  };

  const tapSlot = (e: React.MouseEvent, date: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const min = Math.floor(((e.clientY - rect.top) / hourPx) * 2) * 30 + startH * 60;
    openSheet({ kind: 'add', preset: { date, start: fmtHM(min), end: fmtHM(min + 60) } });
  };

  const gridCols = `36px repeat(${dates.length}, 1fr)`;
  return (
    <div ref={wrap} className={dates.length === 1 ? 'day-grid' : ''}>
      {dates.length > 1 && (
        <div className="grid-head" style={{ gridTemplateColumns: gridCols }}>
          <span />
          {dates.map(d => (
            <button key={d} className={d === t ? 'is-today' : ''} onClick={() => onHead?.(d)} aria-label={shortDate(d)}>
              {WEEKDAYS[weekday(d)]}<b>{Number(d.slice(8))}</b>
            </button>
          ))}
        </div>
      )}
      <div className="grid-wrap" style={{ gridTemplateColumns: gridCols, height: H }} ref={cols}>
        <div className="hours" style={{ height: H }} aria-hidden="true">
          {Array.from({ length: endH - startH }, (_, i) => (
            <div key={i} className="h num" style={{ top: i * hourPx }}>{((startH + i) % 12) || 12}{(startH + i) % 24 < 12 ? 'a' : 'p'}</div>
          ))}
        </div>
        {dates.map(d => {
          const lo = dayNum(d) * DAY + startH * 60;
          const occs = byDate.get(d) ?? [];
          const hints = occs.filter(o => o.hint);
          const real = occs.filter(o => !o.hint);
          const lanes = layoutLanes(real);
          return (
            <div key={d} className="col" style={{ height: H }} onClick={e => tapSlot(e, d)} role="group" aria-label={`${shortDate(d)}, tap empty time to add`}>
              {Array.from({ length: endH - startH }, (_, i) => <div key={i} aria-hidden="true" style={{ position: 'absolute', top: i * hourPx, left: 0, right: 0, borderTop: '1px solid var(--line)' }} />)}
              {hints.map(o => <div key={o.key} className="blk hint" aria-hidden="true" style={{ top: px(o.s - lo), height: px(o.e - o.s) }}>{dates.length === 1 ? o.title : ''}</div>)}
              {real.map(o => {
                const L = lanes.get(o.key)!;
                const dragging = drag?.key === o.key && drag.active;
                const dy = dragging && drag!.mode === 'move' ? drag!.dy : 0;
                const dh = dragging && drag!.mode === 'resize' ? drag!.dy : 0;
                const dx = dragging && drag!.mode === 'move' ? drag!.dx : 0;
                const h = Math.max(14, px(o.e - o.s) + dh);
                return (
                  <button key={o.key}
                    className={`blk ${typeClass(o.type)}${isRoutine(o) ? ' routine' : ''}${o.status === 'done' ? ' done' : ''}${dragging ? ' dragging' : ''}`}
                    style={{ top: px(o.s - lo) + dy, height: h, left: `calc(${(L.lane / L.lanes) * 100}% + 1px)`, width: `calc(${100 / L.lanes}% - 2px)`, right: 'auto', transform: dx ? `translateX(${dx}px)` : undefined, touchAction: dragging ? 'none' : undefined }}
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => onDown(e, o, 'move')} onPointerMove={onMove} onPointerUp={() => onUp(o)} onPointerCancel={() => setDrag(null)}
                    aria-label={`${o.title}, ${clock(o.s)} to ${clock(o.e)}${MOVABLE(o) ? '. Hold and drag to move' : ''}`}
                    onKeyDown={e => { if (e.key === 'Enter') openSheet({ kind: 'item', ref: o.key }); }}
                  >
                    {o.title}{dates.length === 1 && h > 30 ? <span className="faint" style={{ display: 'block' }}>{range(o.s, o.e)}</span> : null}
                    {MOVABLE(o) && dates.length === 1 && <span className="rs" aria-hidden="true" onPointerDown={e => onDown(e, o, 'resize')} />}
                  </button>
                );
              })}
              {d === t && nowT > lo && nowT < lo + (endH - startH) * 60 && <div className="nowline" style={{ top: px(nowT - lo) }} aria-hidden="true" />}
            </div>
          );
        })}
      </div>
      {dates.length === 1 && <p className="tiny faint" style={{ marginTop: 6 }}>Tap empty time to add. Hold an item, then drag to move it, or drag its bottom edge to resize.</p>}
    </div>
  );
}
