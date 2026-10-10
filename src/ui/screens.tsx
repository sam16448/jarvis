import { CalendarPlus, CaretRight, ChartBar, Copy, DownloadSimple, Gear, ListChecks, MagnifyingGlass, Tray, Trash } from '@phosphor-icons/react';
import { useState, type ComponentType } from 'react';
import { examStats, taskRisk, type Risk } from '../engine/metrics';
import { plannedMinutes, remainingMinutes } from '../engine/place';
import { putOp, uid } from '../engine/state';
import { clock, daysBetween, dur, range, shortDate, toT } from '../engine/time';
import { TYPE_LABEL } from '../engine/types';
import { commit, nowStr, propose, today, useApp } from '../store/store';
import { openSheet, setInput } from './bus';
import { Empty, Pill, typeClass } from './common';
import { Settings } from './Settings';
import { Habits, Review, Search, Templates, CalendarExport } from './extras';

type P = { params: URLSearchParams };

function Deadlines() {
  const { st, now } = useApp();
  const s = st!;
  const nowT = toT(now);
  const rows = [
    ...s.tasks.filter(t => t.status === 'open').map(t => ({
      key: 'task:' + t.id, title: t.title, type: t.type as string, when: t.deadline, risk: taskRisk(s, t, nowT) as Risk,
      sub: `${TYPE_LABEL[t.type]}${t.subject ? `, ${t.subject}` : ''}. ${dur(remainingMinutes(t))} left, ${dur(plannedMinutes(s, t.id, nowT))} planned${t.priority === 'critical' ? ', critical' : ''}`,
    })),
    ...s.exams.filter(e => toT(e.end) > nowT).map(e => ({ key: 'exam:' + e.id, title: e.title, type: 'exam', when: e.start as string | undefined, risk: undefined as Risk | undefined, sub: '' })),
  ].sort((a, b) => (a.when ?? '9999') < (b.when ?? '9999') ? -1 : 1);
  const overdue = rows.filter(r => r.when && toT(r.when) < nowT);
  const upcoming = rows.filter(r => r.when && toT(r.when) >= nowT);
  const none = rows.filter(r => !r.when);
  const counts = { 'at risk': 0, tight: 0, 'on track': 0 } as Record<string, number>;
  for (const r of rows) if (r.risk && r.risk in counts) counts[r.risk]++;
  const List = ({ items }: { items: typeof rows }) => (
    <div className="list">
      {items.map(r => (
        <button key={r.key} className={`li ${typeClass(r.type)}`} onClick={() => openSheet({ kind: 'item', ref: r.key })}>
          <span className="bar" aria-hidden="true" />
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t" style={{ display: 'block' }}>{r.title}</span>
            <span className="s">{r.type === 'exam' ? `Exam, ${shortDate(r.when!.slice(0, 10))}, ${clock(r.when!)}` : `${r.when ? `Due ${shortDate(r.when.slice(0, 10))} ${clock(r.when)}. ` : ''}${r.sub}`}</span>
          </span>
          {r.risk ? <Pill risk={r.risk} /> : <span className="pill">{daysBetween(today(), r.when!.slice(0, 10))} d</span>}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <h1>Deadlines</h1>
      {s.tasks.some(t => t.status === 'open') && <p className="small muted">{counts['at risk']} at risk, {counts.tight} tight, {counts['on track']} on track.</p>}
      {overdue.length > 0 && <section className="section"><h3 style={{ color: 'var(--bad)' }}>Overdue</h3><List items={overdue} /></section>}
      <section className="section"><h3>Coming up</h3>{upcoming.length ? <List items={upcoming} /> : <Empty>Nothing due. Say “History essay due Thursday” to add one.</Empty>}</section>
      {none.length > 0 && <section className="section"><h3>No deadline</h3><List items={none} /></section>}
    </>
  );
}

function Exams() {
  const { st, now } = useApp();
  const s = st!;
  const nowT = toT(now);
  const stats = examStats(s, nowT);
  const [editing, setEditing] = useState<string | null>(null);
  const setTarget = (id: string, v: number) => {
    const ex = s.exams.find(e => e.id === id)!;
    commit([putOp('exams', { ...ex, targetHours: Math.max(0, v) })], `Set ${ex.subject} target to ${v} h`, false);
  };
  return (
    <>
      <div className="spread"><h1>Exams</h1><button className="btn" onClick={() => propose({ kind: 'planStudy' }, 'Plan study hours for all exams', 'ui')}>Plan study</button></div>
      {stats.length === 0 && <Empty>No upcoming exams. Say “Maths exam on the 28th 10 to 12” to add one.</Empty>}
      {stats.map(x => {
        const pct = x.targetMin ? Math.min(1, x.doneMin / x.targetMin) : 0;
        const ppct = x.targetMin ? Math.min(1 - pct, x.plannedMin / x.targetMin) : 0;
        return (
          <section key={x.exam.id} className="card stack t-exam" aria-label={x.exam.title}>
            <div className="spread">
              <h2 style={{ fontSize: 18 }}>{x.exam.title}</h2>
              <span className="num" style={{ fontWeight: 700 }}>{x.daysLeft === 0 ? 'Today' : `${x.daysLeft} day${x.daysLeft > 1 ? 's' : ''}`}</span>
            </div>
            <p className="small muted num">{shortDate(x.exam.start.slice(0, 10))}, {range(toT(x.exam.start), toT(x.exam.end))}</p>
            {x.targetMin > 0 ? (
              <>
                <div style={{ display: 'flex', height: 6, gap: 2 }} aria-hidden="true">
                  <span style={{ flex: pct, background: 'var(--ok)', borderRadius: 3 }} />
                  <span style={{ flex: ppct, background: 'var(--c-study)', borderRadius: 3, opacity: 0.7 }} />
                  <span style={{ flex: Math.max(0, 1 - pct - ppct) }} />
                </div>
                <div className="spread small num">
                  <span><b>{dur(x.doneMin)}</b> done, {dur(x.plannedMin)} planned of {x.exam.targetHours} h</span>
                  <Pill risk={x.status} />
                </div>
                {x.targetMin > x.doneMin + x.plannedMin && <p className="small" style={{ color: 'var(--warn)' }}>{dur(x.targetMin - x.doneMin - x.plannedMin)} not yet planned. About {dur(x.perDayNeededMin)} a day.</p>}
              </>
            ) : <p className="small muted">No study target.</p>}
            <div className="row">
              {editing === x.exam.id ? (
                <form className="row grow" onSubmit={e => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('t')); setTarget(x.exam.id, v); setEditing(null); }}>
                  <label className="field grow"><span className="sr-only">Target hours</span><input name="t" type="number" inputMode="decimal" min={0} step={0.5} defaultValue={x.exam.targetHours} /></label>
                  <button className="btn primary">Save</button>
                </form>
              ) : (
                <>
                  <button className="btn ghost" onClick={() => setEditing(x.exam.id)}>Target {x.exam.targetHours} h</button>
                  {x.targetMin > x.doneMin + x.plannedMin && <button className="btn" onClick={() => propose({ kind: 'planStudy', subject: x.exam.subject }, `Plan ${x.exam.subject} study`, 'ui')}>Plan {x.exam.subject}</button>}
                </>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Inbox() {
  const { st } = useApp();
  const [text, setText] = useState('');
  const items = [...st!.inbox].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const add = () => { if (text.trim()) { commit([putOp('inbox', { id: uid('i'), text: text.trim(), createdAt: nowStr() })], 'Inbox capture', false); setText(''); } };
  return (
    <>
      <h1>Inbox</h1>
      <form className="row" onSubmit={e => { e.preventDefault(); add(); }}>
        <label className="field grow"><span className="sr-only">Quick capture</span><input name="capture" value={text} onChange={e => setText(e.target.value)} placeholder="Something to schedule later…" autoComplete="off" enterKeyHint="done" /></label>
        <button className="btn primary" disabled={!text.trim()}>Add</button>
      </form>
      <p className="tiny muted">Anything you say without a time also lands here. Tap Schedule to give it one.</p>
      {items.length === 0 ? <Empty>Inbox is empty.</Empty> : (
        <div className="list">
          {items.map(i => (
            <div key={i.id} className="li">
              <span className="grow" style={{ overflowWrap: 'anywhere' }}>{i.text}<span className="s" style={{ display: 'block' }}>{shortDate(i.createdAt.slice(0, 10))}</span></span>
              <button className="btn" onClick={() => { commit([{ t: 'del', table: 'inbox', id: i.id }], 'Schedule from inbox', false); setInput(i.text + ' '); document.getElementById('ask')?.focus(); }}>Schedule</button>
              <button className="icon-btn" aria-label={`Delete “${i.text}”`} onClick={() => commit([{ t: 'del', table: 'inbox', id: i.id }], 'Delete inbox item')}><Trash size={20} aria-hidden="true" /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function More() {
  const { st } = useApp();
  const links: [string, string, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>, string?][] = [
    ['/inbox', 'Inbox', Tray, st!.inbox.length ? String(st!.inbox.length) : undefined],
    ['/search', 'Search', MagnifyingGlass],
    ['/habits', 'Habits', ListChecks],
    ['/review', 'Weekly review', ChartBar],
    ['/templates', 'Day templates', Copy],
    ['/export', 'Export to Calendar', CalendarPlus],
    ['/settings', 'Settings and backup', Gear],
  ];
  return (
    <>
      <h1>More</h1>
      <nav className="list" aria-label="More screens">
        {links.map(([href, label, Icon, badge]) => (
          <a key={href} href={`#${href}`} className="li" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Icon size={22} aria-hidden={true} />
            <span className="grow t">{label}</span>
            {badge && <span className="pill">{badge}</span>}
            <CaretRight size={18} aria-hidden={true} />
          </a>
        ))}
      </nav>
      <p className="tiny faint" style={{ textAlign: 'center' }}><DownloadSimple size={12} aria-hidden="true" /> All data stays on this device.</p>
    </>
  );
}

export const screens: Record<string, ComponentType<P>> = {
  '/deadlines': Deadlines,
  '/exams': Exams,
  '/inbox': Inbox,
  '/more': More,
  '/settings': Settings,
  '/search': Search,
  '/habits': Habits,
  '/review': Review,
  '/templates': Templates,
  '/export': CalendarExport,
};
