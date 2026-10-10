// Helpers shared by engine tests.
import { applyOps, uid } from './state';
import { seedState } from './seed';
import { dateOf, toT } from './time';
import { bedT, timeline, wakeT } from './timeline';
import type { Ev, PlanResult, Proposal, State, Task } from './types';

/** Seed state plus a made-up exam timetable used by the tests. */
export function base(): State {
  const st = seedState();
  st.exams = [
    { id: 'x-quiz', subject: 'Programming', title: 'Lab quiz', start: '2026-10-20T14:00', end: '2026-10-20T15:00', targetHours: 0 },
    { id: 'x-maths', subject: 'Maths', title: 'Maths exam', start: '2026-10-28T10:00', end: '2026-10-28T12:00', targetHours: 20 },
    { id: 'x-phy', subject: 'Physics', title: 'Physics exam', start: '2026-10-30T10:00', end: '2026-10-30T12:00', targetHours: 10 },
  ];
  return st;
}

export function asProposal(r: PlanResult): Proposal {
  if (r.type !== 'proposal') throw new Error('Expected proposal, got ' + r.type + ': ' + JSON.stringify(r));
  return r;
}

export function apply(st: State, r: PlanResult): State {
  return applyOps(st, asProposal(r).ops);
}

export function task(p: Partial<Task> & { title: string }): Task {
  return {
    id: uid('t'), type: 'assignment', priority: 'normal', estimateMin: 60, doneMin: 0, splittable: false,
    preferredTime: 'any', effort: 'normal', status: 'open', createdAt: '2026-10-01T00:00', ...p,
  };
}

export function chunk(t: Task, start: string, end: string, p: Partial<Ev> = {}): Ev {
  return { id: uid('c'), title: t.title, type: t.type, subject: t.subject, start, end, kind: 'chunk', taskId: t.id, priority: t.priority, status: 'planned', ...p };
}

export function chunksOf(st: State, taskId: string) {
  return st.events.filter(e => e.taskId === taskId && e.status === 'planned').sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** Every planned chunk must not overlap other busy items and must sit inside the day window. */
export function invariantViolations(st: State, from: string, to: string): string[] {
  const out: string[] = [];
  const occs = timeline(st, from, to);
  for (const c of occs.filter(o => o.kind === 'chunk' && o.status === 'planned')) {
    for (const o of occs) {
      if (o.key === c.key || !o.busy || o.status === 'skipped') continue;
      if (o.s < c.e && o.e > c.s) out.push(`${c.title} ${c.s}-${c.e} overlaps ${o.title}`);
    }
    const d = dateOf(c.s);
    if (c.s < wakeT(st, d) || c.e > bedT(st, d)) out.push(`${c.title} outside day window`);
    const t = st.tasks.find(x => x.id === c.taskId);
    if (t?.deadline && c.e > toT(t.deadline)) out.push(`${c.title} after its deadline`);
  }
  return out;
}
