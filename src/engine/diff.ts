import { addDays, clock, nightAt, range, shortDate } from './time';
import { plannedSleepH, timeline } from './timeline';
import type { DiffLine, Occ, Series, State } from './types';

const when = (o: Occ) => `${shortDate(o.date)} ${range(o.s, o.e)}`;

function freqText(s: Series): string {
  const t = `${clock(s.startTime)}-${clock(s.endTime)}`;
  const days = (s.days ?? []).map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
  const f = s.freq === 'daily' ? 'every day' : s.freq === 'weekdays' ? 'weekdays' : s.freq === 'weekly' ? `weekly${days ? ' on ' + days : ''}` : `on ${days}`;
  const end = s.until ? ` until ${shortDate(s.until)}` : s.count ? `, ${s.count} times` : '';
  return `${f} ${t}${end}`;
}

/** Human before/after diff between two states over a date window. */
export function diffStates(before: State, after: State, from: string, to: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const newSeries = new Set(after.series.filter(s => !before.series.some(b => b.id === s.id)).map(s => s.id));
  const goneSeries = new Set(before.series.filter(s => !after.series.some(a => a.id === s.id)).map(s => s.id));
  for (const id of newSeries) {
    const s = after.series.find(x => x.id === id)!;
    lines.push({ change: 'add', title: s.title, after: freqText(s) });
  }
  for (const id of goneSeries) {
    const s = before.series.find(x => x.id === id)!;
    lines.push({ change: 'remove', title: s.title + ' (whole series)', before: freqText(s) });
  }
  const skipSeries = (o: Occ) => o.source === 'series' && (newSeries.has(o.id) || goneSeries.has(o.id));
  const A = timeline(before, from, to).filter(o => !o.hint && !skipSeries(o));
  const B = timeline(after, from, to).filter(o => !o.hint && !skipSeries(o));
  const aMap = new Map(A.map(o => [o.key, o])), bMap = new Map(B.map(o => [o.key, o]));
  const removed = A.filter(o => !bMap.has(o.key));
  const added = B.filter(o => !aMap.has(o.key));
  // pair removed/added chunks of the same task as moves
  for (const r of [...removed]) {
    if (!r.taskId) continue;
    const i = added.findIndex(a => a.taskId === r.taskId);
    if (i < 0) continue;
    const a = added.splice(i, 1)[0];
    removed.splice(removed.indexOf(r), 1);
    lines.push({ change: 'move', title: r.title, before: when(r), after: when(a) });
  }
  for (const r of removed) lines.push({ change: 'remove', title: r.title, before: when(r) });
  for (const a of added) lines.push({ change: 'add', title: a.title, after: when(a) });
  for (const o of A) {
    const n = bMap.get(o.key);
    if (!n) continue;
    if (n.s !== o.s || n.e !== o.e) lines.push({ change: 'move', title: o.title, before: when(o), after: when(n) });
    else if (n.status !== o.status) lines.push({ change: 'update', title: o.title, before: o.status, after: n.status });
    else if (n.priority !== o.priority) lines.push({ change: 'update', title: o.title, before: o.priority, after: n.priority });
  }
  // task-level changes
  for (const t of after.tasks) {
    const p = before.tasks.find(x => x.id === t.id);
    if (!p) continue;
    if (p.status !== t.status) lines.push({ change: 'update', title: t.title, before: p.status, after: t.status === 'done' ? 'done ✓' : t.status });
    else if (p.priority !== t.priority) lines.push({ change: 'update', title: t.title, before: p.priority, after: t.priority });
    else if (p.actualMin !== t.actualMin && t.actualMin) lines.push({ change: 'update', title: t.title, before: p.actualMin ? `${p.actualMin} min` : 'no time logged', after: `took ${t.actualMin} min` });
    else if (p.estimateMin !== t.estimateMin) lines.push({ change: 'update', title: t.title, before: `${p.estimateMin} min`, after: `${t.estimateMin} min` });
  }
  for (const t of after.tasks) {
    if (before.tasks.some(x => x.id === t.id)) continue;
    if (!after.events.some(e => e.taskId === t.id)) lines.push({ change: 'add', title: t.title, after: t.deadline ? `unscheduled, due ${shortDate(t.deadline.slice(0, 10))}` : 'unscheduled' });
  }
  for (const ex of after.exams) {
    const p = before.exams.find(x => x.id === ex.id);
    if (p && p.targetHours !== ex.targetHours) lines.push({ change: 'update', title: ex.title, before: `target ${p.targetHours} h`, after: `target ${ex.targetHours} h` });
  }
  // bedtime changes
  for (const d of after.days) {
    const p = before.days.find(x => x.id === d.id);
    if ((p?.bedtime ?? '') === (d.bedtime ?? '')) continue;
    const bt = d.bedtime ?? after.settings.bedtime;
    const was = p?.bedtime ?? before.settings.bedtime;
    lines.push({
      change: 'update', title: `Bedtime ${shortDate(d.id)}`,
      before: clock(was), after: `${clock(bt)} (${plannedSleepH(after, d.id).toFixed(1)} h sleep)`,
    });
  }
  for (const i of after.inbox) if (!before.inbox.some(x => x.id === i.id)) lines.push({ change: 'add', title: `Inbox: ${i.text}` });
  const order = { add: 0, move: 1, remove: 2, update: 3 };
  return group(lines.map((l, i) => ({ l, i })).sort((a, b) => order[a.l.change] - order[b.l.change] || a.i - b.i).map(x => x.l));
}

/** Collapse repeated identical-time lines (e.g. a daily trim) into one. */
function group(lines: DiffLine[]): DiffLine[] {
  const strip = (s?: string) => s?.replace(/^\w{3} \d+ \w{3} /, '');
  const key = (l: DiffLine) => `${l.change}|${l.title}|${strip(l.before)}|${strip(l.after)}`;
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1);
  const out: (DiffLine & { n?: number })[] = [];
  for (const l of lines) {
    const n = counts.get(key(l))!;
    if (n < 3 || !(l.before || l.after)) { out.push({ ...l }); continue; }
    const prev = out.find(o => o.n && key(o) === key(l));
    if (prev) continue;
    out.push({ ...l, n });
  }
  return out.map(o => o.n ? { change: o.change, title: `${o.title} ×${o.n} days`, before: strip(o.before), after: strip(o.after) } : { change: o.change, title: o.title, before: o.before, after: o.after });
}

/** Date window covering everything ops could touch. */
export function diffWindow(before: State, after: State, today: string): [string, string] {
  let max = addDays(today, 21);
  for (const e of after.events) if (e.start.slice(0, 10) > max && !before.events.some(b => b.id === e.id)) max = e.start.slice(0, 10);
  return [addDays(today, -1), max];
}

export function sleepText(st: State, date: string): string {
  const b = nightAt(date, st.days.find(d => d.id === date)?.bedtime ?? st.settings.bedtime);
  return `${clock(b)} → ${plannedSleepH(st, date).toFixed(1)} h sleep`;
}

