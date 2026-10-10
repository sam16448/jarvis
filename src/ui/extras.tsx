import { Plus, Trash } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { buildICS, icsEvents } from '../engine/ics';
import { examStats, overload, studyBySubject, dayLoad } from '../engine/metrics';
import { putOp, uid } from '../engine/state';
import { addDays, clock, dateRange, dur, fmtHM, minOfDay, range, shortDate, toT, weekday, WEEKDAYS } from '../engine/time';
import { timeline } from '../engine/timeline';
import { TYPE_LABEL, type SavedTemplate } from '../engine/types';
import { commit, propose, today, useApp } from '../store/store';
import { openSheet } from './bus';
import { Empty, isRoutine, typeClass } from './common';
import { saveFile } from './Settings';

// ---------- Habits ----------
export function streak(log: Record<string, boolean>, day: string): number {
  let n = 0;
  let d = log[day] ? day : addDays(day, -1);
  while (log[d]) { n++; d = addDays(d, -1); }
  return n;
}

export function Habits() {
  const { st } = useApp();
  const s = st!;
  const d = today();
  const days = dateRange(addDays(d, -13), d);
  const [name, setName] = useState('');
  return (
    <>
      <h1>Habits</h1>
      <p className="small muted">Tick them on Today. The last two weeks are shown here.</p>
      {s.habits.length === 0 && <Empty>No habits yet.</Empty>}
      {s.habits.map(h => (
        <section key={h.id} className="card stack" aria-label={h.name}>
          <div className="spread">
            <h2 style={{ fontSize: 17 }}>{h.name}</h2>
            <span className="row"><span className="small muted num">{streak(h.log, d)} day streak</span>
              <button className="icon-btn" aria-label={`Delete habit ${h.name}`} onClick={() => commit([{ t: 'del', table: 'habits', id: h.id }], `Delete habit ${h.name}`)}><Trash size={20} aria-hidden="true" /></button></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 3 }}>
            {days.map(x => (
              <button key={x} aria-label={`${shortDate(x)}: ${h.log[x] ? 'done' : 'not done'}`} aria-pressed={!!h.log[x]}
                onClick={() => commit([putOp('habits', { ...h, log: { ...h.log, [x]: !h.log[x] } })], `${h.name} ${shortDate(x)}`, false)}
                style={{ aspectRatio: '1', border: 'none', borderRadius: 4, background: h.log[x] ? 'var(--ok)' : 'var(--surface-2)', minHeight: 18, padding: 0 }} />
            ))}
          </div>
          <div className="spread tiny faint"><span>{shortDate(days[0])}</span><span>Today</span></div>
        </section>
      ))}
      <form className="row" onSubmit={e => { e.preventDefault(); if (name.trim()) { commit([putOp('habits', { id: uid('h'), name: name.trim(), order: s.habits.length, log: {} })], `Add habit ${name}`); setName(''); } }}>
        <label className="field grow"><span className="sr-only">New habit</span><input name="habit" value={name} onChange={e => setName(e.target.value)} placeholder="New habit…" autoComplete="off" /></label>
        <button className="btn primary" disabled={!name.trim()}><Plus size={18} aria-hidden="true" />Add</button>
      </form>
    </>
  );
}

// ---------- Weekly review ----------
export function Review() {
  const { st, now } = useApp();
  const s = st!;
  const nowT = toT(now);
  const d = today();
  const mon = addDays(d, -((weekday(d) + 6) % 7));
  const sun = addDays(mon, 6);
  const nextMon = addDays(mon, 7);
  const studied = studyBySubject(s, mon, nextMon);
  const exams = examStats(s, nowT);
  const weekTasks = s.tasks.filter(t => t.deadline && t.deadline.slice(0, 10) >= mon && t.deadline.slice(0, 10) <= sun);
  const hit = weekTasks.filter(t => t.status === 'done' && t.doneAt && t.doneAt <= t.deadline!);
  const missed = weekTasks.filter(t => (t.status === 'done' && t.doneAt && t.doneAt > t.deadline!) || (t.status === 'open' && toT(t.deadline!) < nowT));
  const timed = s.tasks.filter(t => t.status === 'done' && t.actualMin && t.doneAt && t.doneAt.slice(0, 10) >= mon);
  const byType = new Map<string, { est: number; act: number; n: number }>();
  for (const t of timed) { const v = byType.get(t.type) ?? { est: 0, act: 0, n: 0 }; v.est += t.estimateMin; v.act += t.actualMin!; v.n++; byType.set(t.type, v); }
  const nextDue = s.tasks.filter(t => t.status === 'open' && t.deadline && t.deadline.slice(0, 10) >= nextMon && t.deadline.slice(0, 10) <= addDays(nextMon, 6));
  const nextExams = s.exams.filter(e => e.start.slice(0, 10) >= nextMon && e.start.slice(0, 10) <= addDays(nextMon, 6));
  const nextWork = dateRange(nextMon, addDays(nextMon, 6)).reduce((a, x) => a + dayLoad(s, x).workMin, 0);
  const ov = overload(s, toT(`${nextMon}T00:00`));
  return (
    <>
      <h1>Weekly review</h1>
      <p className="small muted">{shortDate(mon)} to {shortDate(sun)}</p>
      <section className="card stack">
        <h2 style={{ fontSize: 17 }}>Study hours vs target</h2>
        {exams.filter(e => e.targetMin > 0).map(e => (
          <div key={e.exam.id} className="spread small num"><span>{e.exam.subject}</span><span>{dur(studied[e.exam.subject] ?? 0)} this week, {dur(e.doneMin)} of {e.exam.targetHours} h total</span></div>
        ))}
        {Object.entries(studied).filter(([k]) => !exams.some(e => e.exam.subject === k)).map(([k, v]) => <div key={k} className="spread small num"><span>{k}</span><span>{dur(v)} this week</span></div>)}
        {Object.keys(studied).length === 0 && <p className="small muted">No study sessions marked done this week.</p>}
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: 17 }}>Deadlines</h2>
        <p className="small"><b style={{ color: 'var(--ok)' }}>{hit.length} hit</b>, <b style={{ color: missed.length ? 'var(--bad)' : undefined }}>{missed.length} missed</b>{weekTasks.length - hit.length - missed.length > 0 ? `, ${weekTasks.length - hit.length - missed.length} still to come` : ''}.</p>
        {missed.map(t => <p key={t.id} className="small muted">Missed: {t.title} ({shortDate(t.deadline!.slice(0, 10))})</p>)}
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: 17 }}>Estimate accuracy</h2>
        {[...byType].length ? [...byType].map(([type, v]) => (
          <p key={type} className="small num">{TYPE_LABEL[type as keyof typeof TYPE_LABEL]}: estimated {dur(v.est / v.n)}, took {dur(v.act / v.n)} on average ({Math.round((v.act / v.est) * 100)}%)</p>
        )) : <p className="small muted">Say “that took 2 hours” after finishing a task to track this.</p>}
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: 17 }}>Next week</h2>
        <p className="small num">{dur(nextWork)} of planned work, {nextDue.length} deadline{nextDue.length === 1 ? '' : 's'}, {nextExams.length} exam{nextExams.length === 1 ? '' : 's'}.</p>
        {nextExams.map(e => <p key={e.id} className="small">{shortDate(e.start.slice(0, 10))}: {e.title}</p>)}
        {nextDue.map(t => <p key={t.id} className="small">{shortDate(t.deadline!.slice(0, 10))}: {t.title}</p>)}
        {ov.week && <p className="small" style={{ color: 'var(--warn)' }}>Overloaded: {dur(ov.week.demandMin)} needed, {dur(ov.week.supplyMin)} free. Consider dropping {ov.week.cut.slice(0, 3).map(c => c.title).join(', ')}.</p>}
        {ov.days.map(x => <p key={x.date} className="small" style={{ color: 'var(--warn)' }}>{shortDate(x.date)} has {dur(x.workMin)} of work (limit {dur(x.capMin)}).</p>)}
      </section>
    </>
  );
}

// ---------- Search ----------
export function Search() {
  const { st } = useApp();
  const s = st!;
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    const has = (...xs: (string | undefined)[]) => xs.some(x => x?.toLowerCase().includes(n));
    const out: { key: string; title: string; sub: string; type: string; go: () => void }[] = [];
    for (const t of s.tasks) if (has(t.title, t.subject, t.notes)) out.push({ key: 'task:' + t.id, title: t.title, type: t.type, sub: `Task, ${t.status}${t.deadline ? `, due ${shortDate(t.deadline.slice(0, 10))}` : ''}`, go: () => openSheet({ kind: 'item', ref: 'task:' + t.id }) });
    for (const e of s.events) if (!e.taskId && has(e.title, e.subject, e.notes)) out.push({ key: 'ev:' + e.id, title: e.title, type: e.type, sub: `${shortDate(e.start.slice(0, 10))} ${range(toT(e.start), toT(e.end))}`, go: () => openSheet({ kind: 'item', ref: 'ev:' + e.id }) });
    for (const se of s.series) if (has(se.title, se.subject)) {
      const next = timeline(s, today(), addDays(today(), 30)).find(o => o.source === 'series' && o.id === se.id);
      out.push({ key: 'ser:' + se.id, title: se.title, type: se.type, sub: `Repeats ${clock(se.startTime)}-${clock(se.endTime)}${se.until ? ` until ${shortDate(se.until)}` : ''}`, go: () => next && openSheet({ kind: 'item', ref: next.key }) });
    }
    for (const x of s.exams) if (has(x.title, x.subject)) out.push({ key: 'exam:' + x.id, title: x.title, type: 'exam', sub: `Exam, ${shortDate(x.start.slice(0, 10))}`, go: () => openSheet({ kind: 'item', ref: 'exam:' + x.id }) });
    for (const i of s.inbox) if (has(i.text)) out.push({ key: 'in:' + i.id, title: i.text, type: 'routine', sub: 'Inbox', go: () => { location.hash = '/inbox'; } });
    return out.slice(0, 50);
  }, [q, s]);
  return (
    <>
      <h1>Search</h1>
      <label className="field"><span className="sr-only">Search tasks and events</span>
        <input type="search" name="q" value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks, events, exams…" autoComplete="off" enterKeyHint="search" />
      </label>
      {q.trim().length >= 2 && (results.length ? (
        <div className="list">
          {results.map(r => (
            <button key={r.key} className={`li ${typeClass(r.type)}`} onClick={r.go}>
              <span className="bar" aria-hidden="true" />
              <span className="grow" style={{ minWidth: 0 }}><span className="t" style={{ display: 'block' }}>{r.title}</span><span className="s">{r.sub}</span></span>
            </button>
          ))}
        </div>
      ) : <Empty>No matches for “{q}”.</Empty>)}
    </>
  );
}

// ---------- Templates ----------
export function Templates() {
  const { st } = useApp();
  const s = st!;
  const [date, setDate] = useState(addDays(today(), 1));
  const [from, setFrom] = useState(today());
  const [name, setName] = useState('');
  const saveDay = () => {
    const items = timeline(s, from, from).filter(o => o.date === from && !o.hint && !isRoutine(o) && o.source !== 'exam')
      .map(o => ({ title: o.title, type: o.type, subject: o.subject, start: fmtHM(minOfDay(o.s)), end: fmtHM(minOfDay(o.e)) }));
    if (!items.length) return;
    const tpl: SavedTemplate = { id: uid('tpl'), name: name.trim() || `Day like ${shortDate(from)}`, items };
    commit([putOp('templates', tpl)], `Save template ${tpl.name}`);
    setName('');
  };
  return (
    <>
      <h1>Day templates</h1>
      <p className="small muted">Reuse a day’s pattern, e.g. an exam-week day. Applying one adds its blocks as fixed events and moves anything in the way.</p>
      <label className="field">Apply to date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      {s.templates.length === 0 && <Empty>No templates yet.</Empty>}
      {s.templates.map(t => (
        <section key={t.id} className="card stack" aria-label={t.name}>
          <div className="spread"><h2 style={{ fontSize: 17 }}>{t.name}</h2>
            <button className="icon-btn" aria-label={`Delete template ${t.name}`} onClick={() => commit([{ t: 'del', table: 'templates', id: t.id }], `Delete template ${t.name}`)}><Trash size={20} aria-hidden="true" /></button></div>
          <div className="small muted num">{t.items.map((i, k) => <p key={k}>{clock(i.start)}-{clock(i.end)} {i.title}</p>)}</div>
          <button className="btn primary" onClick={() => propose({ kind: 'applyTemplate', templateId: t.id, date }, `Apply ${t.name} to ${shortDate(date)}`, 'ui')}>Apply to {shortDate(date)}</button>
        </section>
      ))}
      <section className="card stack">
        <h2 style={{ fontSize: 17 }}>Save a day as a template</h2>
        <div className="row">
          <label className="field grow">Day<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="field grow">Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Exam-week day…" autoComplete="off" /></label>
        </div>
        <button className="btn" onClick={saveDay}>Save Template</button>
      </section>
    </>
  );
}

// ---------- Calendar export ----------
export function CalendarExport() {
  const { st, now } = useApp();
  const s = st!;
  const [alert, setAlert] = useState(10);
  const evs = icsEvents(s, today(), 7);
  return (
    <>
      <h1>Export to Calendar</h1>
      <p className="small muted">Creates an .ics file for the next 7 days with alerts, so iPhone Calendar can remind you when Jarvis is closed. Re-export after big changes. Importing again adds new copies, so delete the old Jarvis events first (or import into a separate “Jarvis” calendar you can clear).</p>
      <label className="field">Alert before each item (minutes)
        <select value={alert} onChange={e => setAlert(Number(e.target.value))}>{[0, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m}</option>)}</select>
      </label>
      <p className="tiny muted">Exams always get a 60-minute alert.</p>
      <button className="btn primary big" onClick={() => saveFile(`jarvis-${today()}.ics`, buildICS(s, now, 7, alert), 'text/calendar')}>Export {evs.length} Items</button>
      <div className="list">
        {evs.slice(0, 40).map(o => <div key={o.key} className={`li compact small num ${typeClass(o.type)}`}><span className="bar" aria-hidden="true" /><span className="muted" style={{ width: 92, flex: 'none' }}>{WEEKDAYS[weekday(o.date)]} {clock(o.s)}</span><span className="t grow">{o.title}</span></div>)}
      </div>
    </>
  );
}
