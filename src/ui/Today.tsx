import { CheckCircle, Circle, Lightning, Plus, Timer } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { freeSpans, freeToday } from '../engine/metrics';
import { plan, rollForward } from '../engine/plan';
import { clock, dur, range, timeOf, toT, addDays, weekday } from '../engine/time';
import { plannedSleepH, timeline, bedT } from '../engine/timeline';
import type { Occ, Op, State } from '../engine/types';
import { putOp } from '../engine/state';
import { commit, nowStr, showResult, today, useApp } from '../store/store';
import { openSheet } from './bus';
import { isRoutine, typeClass } from './common';
import { taskRisk } from '../engine/metrics';

export function canTick(o: Occ) {
  return o.source === 'series' || (o.source === 'event' && o.kind !== 'block');
}

/** One-tap done / undone. */
export async function toggleDone(st: State, o: Occ) {
  if (o.status === 'done') {
    const ops: Op[] = [];
    if (o.source === 'event') {
      const ev = st.events.find(e => e.id === o.id)!;
      ops.push(putOp('events', { ...ev, status: 'planned' }));
      const t = st.tasks.find(x => x.id === ev.taskId);
      if (t) ops.push(putOp('tasks', { ...t, status: 'open', doneMin: Math.max(0, t.doneMin - (o.e - o.s)), doneAt: undefined }));
    } else if (o.source === 'series') {
      const s = st.series.find(x => x.id === o.id)!;
      const ex = { ...s.exceptions[o.date] };
      delete ex.status;
      ops.push(putOp('series', { ...s, exceptions: { ...s.exceptions, [o.date]: ex } }));
    }
    await commit(ops, `Unmark ${o.title}`);
    return;
  }
  const r = plan(st, { kind: 'markDone', target: o.title, ref: o.key }, nowStr());
  if (r.type === 'proposal') await commit(r.ops, r.understood);
  else showResult(r);
}

function streak(log: Record<string, boolean>, day: string): number {
  let n = 0;
  let d = log[day] ? day : addDays(day, -1);
  while (log[d]) { n++; d = addDays(d, -1); }
  return n;
}

function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const i = window.setInterval(() => set(x => x + 1), 1000);
    return () => window.clearInterval(i);
  }, [active]);
}

function readFocus(): { key: string; at: number } | null {
  try { return JSON.parse(localStorage.getItem('jarvis-focus') ?? 'null'); } catch { return null; }
}

function FocusTimer({ occ }: { occ: Occ }) {
  const [f, setF] = useState(readFocus);
  const on = f?.key === occ.key;
  useTick(on);
  const start = () => { const v = { key: occ.key, at: Date.now() }; try { localStorage.setItem('jarvis-focus', JSON.stringify(v)); } catch { /* ignore */ } setF(v); };
  const stop = () => { try { localStorage.removeItem('jarvis-focus'); } catch { /* ignore */ } setF(null); };
  if (!on) return <button className="btn" onClick={start}><Timer size={20} aria-hidden="true" />Start focus</button>;
  const elapsed = Math.floor((Date.now() - f!.at) / 1000);
  const nowT = toT(nowStr());
  const left = Math.max(0, (occ.e - nowT) * 60 - new Date().getSeconds());
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div className="spread">
      <div>
        <div className="timer" aria-live="off">{mmss(left)}</div>
        <div className="tiny muted">left in block, {mmss(elapsed)} focused</div>
      </div>
      <button className="btn" onClick={stop}>Stop</button>
    </div>
  );
}

export function Today() {
  const { st, now } = useApp();
  const s = st!;
  const day = today();
  const nowT = toT(now);
  const items = useMemo(() => timeline(s, day, day).filter(o => o.date === day && !o.hint && o.status !== 'skipped'), [s, day]);
  const missed = useMemo(() => rollForward(s, now), [s, now]);
  const visible = items.filter(o => !(o.role === 'commute' || o.role === 'meal') || o.e > nowT);
  const actionable = items.filter(o => !isRoutine(o) && o.status === 'planned');
  const cur = actionable.find(o => o.s <= nowT && o.e > nowT) ?? items.find(o => o.s <= nowT && o.e > nowT && o.status === 'planned');
  const next = actionable.find(o => o.s > nowT) ?? timeline(s, day, addDays(day, 1)).find(o => !o.hint && o.s > nowT && !isRoutine(o) && o.status === 'planned');
  const free = freeToday(s, nowT);
  const gaps = freeSpans(s, day, nowT, 30);
  const due48 = s.tasks.filter(t => t.status === 'open' && t.deadline && toT(t.deadline) - nowT <= 48 * 60 && toT(t.deadline) > nowT);
  const exams48 = s.exams.filter(e => toT(e.start) > nowT && toT(e.start) - nowT <= 48 * 60);
  const atRisk = s.tasks.filter(t => t.status === 'open' && t.deadline && taskRisk(s, t, nowT) === 'at risk');
  const sleepH = plannedSleepH(s, day);
  const bed = bedT(s, day);
  const wrapDue = timeOf(nowT) >= s.settings.wrapupTime;

  type Row = { kind: 'occ'; o: Occ; s: number } | { kind: 'free'; a: number; b: number; s: number };
  const rows: Row[] = [
    ...visible.map(o => ({ kind: 'occ' as const, o, s: o.s })),
    ...gaps.map(([a, b]) => ({ kind: 'free' as const, a, b, s: a })),
  ].sort((x, y) => x.s - y.s);

  return (
    <>
      <h1 className="sr-only">Today</h1>
      {missed && (
        <div className="banner warn">
          <p className="grow small">{missed.understood.replace(/^Roll forward (\d+) unfinished session(s?)\.$/, (_m, n, pl) => `${n} unfinished session${pl} from earlier ${pl ? 'are' : 'is'} still open.`)}</p>
          <button className="btn" onClick={() => showResult(missed, undefined, undefined, 'ui')}>Reschedule</button>
        </div>
      )}
      {atRisk.length > 0 && (
        <a className="banner bad" href="#/deadlines" style={{ color: 'inherit', textDecoration: 'none' }}>
          <p className="small"><b>{atRisk.length} at risk:</b> {atRisk.map(t => t.title).join(', ')}</p>
        </a>
      )}

      {cur ? (
        <section className={`card now-card ${typeClass(cur.type)}`} aria-label="Now">
          <div className="spread"><span className="label">NOW</span><span className="tiny muted num">{range(cur.s, cur.e)}</span></div>
          <p className="title">{cur.title}</p>
          {!isRoutine(cur) && cur.source !== 'exam' && (
            <div className="row">
              {canTick(cur) && <button className="btn primary grow" onClick={() => toggleDone(s, cur)}><CheckCircle size={20} aria-hidden="true" />Done</button>}
              <FocusTimer occ={cur} />
            </div>
          )}
        </section>
      ) : (
        <section className="card now-card" aria-label="Now">
          <span className="label">NOW</span>
          <p className="title">Free{next ? ` until ${clock(next.s)}` : ''}</p>
        </section>
      )}
      {next && (
        <button className={`card now-card ${typeClass(next.type)}`} style={{ textAlign: 'left', color: 'inherit' }} onClick={() => openSheet({ kind: 'item', ref: next.key })}>
          <div className="spread"><span className="label">NEXT</span><span className="tiny muted num">{next.date === day ? `in ${dur(next.s - nowT)}` : 'tomorrow'}</span></div>
          <p className="title" style={{ fontSize: 18 }}>{next.title}</p>
          <span className="small muted num">{range(next.s, next.e)}</span>
        </button>
      )}

      <div className="stats">
        <div className="stat"><b className="num">{dur(free)}</b><span>free today</span></div>
        <a className="stat" href="#/deadlines" style={{ color: 'inherit', textDecoration: 'none' }}><b className="num">{due48.length + exams48.length}</b><span>due in 48 h</span></a>
        <div className="stat"><b className="num">{sleepH.toFixed(1)} h</b><span>sleep, bed {clock(bed).replace(' ', ' ')}</span></div>
      </div>

      <div className="habits" role="group" aria-label="Habits">
        {s.habits.map(h => (
          <button key={h.id} className="habit" aria-pressed={!!h.log[day]}
            onClick={() => commit([putOp('habits', { ...h, log: { ...h.log, [day]: !h.log[day] } })], `${h.name} ${h.log[day] ? 'unchecked' : 'checked'}`, false)}>
            {h.log[day] ? <CheckCircle size={16} weight="fill" aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
            {h.name}{streak(h.log, day) > 1 ? <span className="num"> {streak(h.log, day)}</span> : null}
          </button>
        ))}
      </div>

      <section className="section" aria-label="Today's timeline">
        <div className="spread">
          <h2>Timeline</h2>
          <div className="row">
            <button className="btn ghost" aria-label="Panic: keep only critical items today" onClick={() => showResult(plan(s, { kind: 'panic' }, nowStr()), 'Panic button', { kind: 'panic' }, 'ui')}><Lightning size={18} aria-hidden="true" />Panic</button>
            <button className="icon-btn filled" aria-label="Add item" onClick={() => openSheet({ kind: 'add', preset: { date: day } })}><Plus size={20} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="list">
          {rows.length === 0 && <p className="empty">Nothing planned today.</p>}
          {rows.map(r => r.kind === 'free' ? (
            <button key={'f' + r.a} className="tl-free" onClick={() => openSheet({ kind: 'add', preset: { date: day, start: timeOf(r.a), end: timeOf(Math.min(r.b, r.a + 60)) } })}>
              <span className="time">{clock(r.a)}</span><span>Free for {dur(r.b - r.a)}. Tap to add</span>
            </button>
          ) : (
            <div key={r.o.key} className={`row ${typeClass(r.o.type)}`} style={{ gap: 0 }}>
              <button className={`tl-item grow${isRoutine(r.o) ? ' routine' : ''}${r.o.status === 'done' ? ' done' : ''}${r.o.e <= nowT && r.o.status !== 'done' ? ' past' : ''}`} onClick={() => openSheet({ kind: 'item', ref: r.o.key })}>
                <span className="time">{clock(r.o.s)}</span>
                <span className="bar" aria-hidden="true" />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t" style={{ display: 'block' }}>{r.o.title}</span>
                  <span className="s num">{range(r.o.s, r.o.e)}{r.o.priority === 'critical' && r.o.source !== 'exam' ? ', critical' : ''}{r.o.status === 'missed' ? ', missed' : ''}</span>
                </span>
              </button>
              {canTick(r.o) && !isRoutine(r.o) ? (
                <button className="tick" aria-label={r.o.status === 'done' ? `Mark ${r.o.title} not done` : `Mark ${r.o.title} done`} aria-pressed={r.o.status === 'done'} onClick={() => toggleDone(s, r.o)}>
                  {r.o.status === 'done' ? <CheckCircle size={26} weight="fill" aria-hidden="true" /> : <Circle size={26} aria-hidden="true" />}
                </button>
              ) : <span style={{ width: 44 }} />}
            </div>
          ))}
        </div>
      </section>
      {weekday(day) === 0 && <a className="btn block" href="#/review">Sunday: open weekly review</a>}
      {weekday(day) === 0 && <a className="btn block" href="#/review">Sunday: open weekly review</a>}
      {wrapDue && <button className="btn big block" onClick={() => openSheet({ kind: 'wrapup' })}>Night wrap-up</button>}
    </>
  );
}
