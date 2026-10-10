import { Draft, uid } from './state';
import { DAY, dateOf, fromT, hm, minOfDay, toT, type T } from './time';
import { freeIntervals, timeline } from './timeline';
import type { Effort, Ev, Priority, Range, State, Task, TaskType, TimeOfDay } from './types';

const HORIZON_DAYS = 14;

// ---------- Estimates, effort, priority ----------

/** Default duration for a type, nudged toward how long past tasks of that type really took. */
export function estimateFor(st: State, type: TaskType): number {
  const def = st.settings.durationDefaults[type];
  const past = st.tasks.filter(t => t.type === type && t.status === 'done' && t.actualMin && t.actualMin > 0);
  if (!past.length) return def;
  const recent = past.slice(-10);
  const sum = recent.reduce((a, t) => a + (t.actualMin ?? 0), 0);
  const prior = 2; // weight of the default, in "tasks"
  return Math.max(15, Math.round((def * prior + sum) / (prior + recent.length) / 15) * 15);
}

export function defaultPriority(type: TaskType): Priority {
  if (type === 'club' || type === 'personal') return 'flexible';
  if (type === 'lab' || type === 'examprep') return 'high';
  return 'normal';
}

export function subjectEffort(st: State, subject?: string): Effort | undefined {
  if (!subject) return undefined;
  return st.settings.subjects.find(s => s.name.toLowerCase() === subject.toLowerCase())?.effort;
}

export function inferEffort(st: State, title: string, type: TaskType, subject?: string): Effort {
  const t = title.toLowerCase();
  if (/write-?up|typing|notes|copy|format|report|record|journal/.test(t) || type === 'lab') return 'light';
  if (/numerical|problem|maths?|calculus|derivation|proof|circuit/.test(t)) return 'hard';
  const se = subjectEffort(st, subject);
  if (se) return se;
  if (type === 'personal' || type === 'club') return 'light';
  return 'normal';
}

const TIER: Record<Priority, number> = { critical: 0, high: 1, normal: 2, flexible: 3 };

/** Sort key: lower = more important. */
export function rank(st: State, task: Pick<Task, 'priority' | 'type' | 'subject' | 'deadline'>): [number, number] {
  const dl = task.deadline ? toT(task.deadline) : Number.MAX_SAFE_INTEGER;
  if (task.priority === 'critical') return [0, dl];
  if ((task.type === 'study' || task.type === 'examprep') && task.subject) {
    const exam = st.exams.filter(e => e.subject.toLowerCase() === task.subject!.toLowerCase())
      .map(e => toT(e.start)).sort((a, b) => a - b)[0];
    if (exam !== undefined) return [1, exam];
  }
  return [TIER[task.priority] + (task.type === 'club' || task.type === 'personal' ? 1 : 0), dl];
}

export function compareRank(a: [number, number], b: [number, number]) {
  return a[0] - b[0] || a[1] - b[1];
}

// ---------- Placement ----------

function inRanges(min: number, len: number, ranges: Range[]): number {
  // minutes of [min, min+len) covered by ranges (clock times within a day)
  let cov = 0;
  for (const r of ranges) {
    const s = hm(r.start), e = hm(r.end) <= s ? hm(r.end) + DAY : hm(r.end);
    cov += Math.max(0, Math.min(min + len, e) - Math.max(min, s));
  }
  return cov;
}

const TOD: Record<Exclude<TimeOfDay, 'any'>, [number, number]> = {
  morning: [0, 12 * 60], afternoon: [12 * 60, 17 * 60], evening: [17 * 60, DAY + 180],
};

export interface PlaceOpts {
  from: T;
  until?: T;             // hard end (default: deadline or horizon)
  dayEnd?: Record<string, T>;
  ignoreKeys?: Set<string>;
  preferWithin?: [T, T]; // strongly prefer this window (e.g. "tomorrow morning")
  noSplit?: boolean;
}

export interface PlaceResult { placed: Ev[]; unplaced: number; }

/** Score for putting `len` minutes of `task` at `s`. Lower is better. */
function score(st: State, task: Task, s: T, len: number, ctx: { now: T; prefBy?: T; hints: { s: T; e: T; role: string }[]; dayLoad: Map<string, number>; sameDay: Map<string, number>; preferWithin?: [T, T] }): number {
  const m = minOfDay(s);
  let sc = 0;
  if (ctx.prefBy !== undefined && s + len > ctx.prefBy) sc += 400;
  if (ctx.preferWithin && (s < ctx.preferWithin[0] || s + len > ctx.preferWithin[1])) sc += 2000;
  // matching template hint slot
  const want = task.type === 'assignment' || task.type === 'lab' ? 'assignment'
    : task.type === 'study' || task.type === 'examprep' || task.type === 'course' ? 'study' : null;
  if (want) {
    const cov = ctx.hints.filter(h => h.role === want).reduce((a, h) => a + Math.max(0, Math.min(s + len, h.e) - Math.max(s, h.s)), 0);
    sc += 40 * (1 - cov / len);
  }
  const focus = inRanges(m, len, st.settings.focusHours) / len;
  const low = inRanges(m, len, st.settings.lowEnergy) / len;
  if (task.effort === 'hard') sc += 35 * (1 - focus);
  else if (task.effort === 'light') sc += 15 * focus + 10 * (1 - low);
  if (task.preferredTime !== 'any') {
    const [a, b] = TOD[task.preferredTime];
    if (m < a || m + len > b) sc += 30;
  }
  const d = dateOf(s);
  sc += 6 * Math.floor((s - ctx.now) / DAY);         // earlier days preferred, gently
  sc += 10 * (ctx.sameDay.get(d) ?? 0);               // spread chunks of one task
  const load = (ctx.dayLoad.get(d) ?? 0) / 60;
  if (load > 4) sc += 8 * (load - 4);                  // avoid piling work on one day
  sc += m / 600;                                       // tie-break: earlier in day
  return sc;
}

/**
 * Greedily place `minutes` of a task as chunks into free time. Deterministic.
 * Adds chunk events to the draft. Returns what could not be placed.
 */
export function placeTask(dr: Draft, task: Task, minutes: number, opts: PlaceOpts): PlaceResult {
  const st0 = dr.state;
  const set = st0.settings;
  const now = opts.from;
  const deadline = task.deadline ? toT(task.deadline) : undefined;
  const until = opts.until ?? deadline ?? now + HORIZON_DAYS * DAY;
  const from = Math.max(now, task.earliestStart ? toT(task.earliestStart) : now);
  const prefBy = deadline !== undefined && deadline - DAY > from + 60 ? deadline - DAY : undefined;
  const placed: Ev[] = [];
  let remaining = Math.round(minutes);
  const splittable = task.splittable && !opts.noSplit;
  const sameDay = new Map<string, number>();

  for (let guard = 0; remaining > 0 && guard < 60; guard++) {
    const st = dr.state;
    const free = freeIntervals(st, from, until, { dayEnd: opts.dayEnd, ignoreKeys: opts.ignoreKeys });
    if (!free.length) break;
    const occs = timeline(st, dateOf(from), dateOf(until));
    const hints = occs.filter(o => o.hint).map(o => ({ s: o.s, e: o.e, role: o.hint! }));
    const dayLoad = new Map<string, number>();
    for (const o of occs) if (o.kind === 'chunk' || o.source === 'series' && o.type !== 'routine') dayLoad.set(o.date, (dayLoad.get(o.date) ?? 0) + o.e - o.s);

    // even chunks of at most chunkMax, rounded to 15 min (120 -> 60+60, 200 -> 75+75+50)
    let len = remaining;
    if (splittable && remaining > set.chunkMaxMin) {
      const n = Math.ceil(remaining / set.chunkMaxMin);
      len = Math.min(set.chunkMaxMin, Math.ceil(remaining / n / 15) * 15);
    }
    const longest = Math.max(...free.map(([s, e]) => e - s));
    if (longest < len) {
      if (!splittable || longest < Math.min(set.minChunkMin, remaining)) break;
      len = Math.floor(longest / 5) * 5;
    }
    let best: { s: T; sc: number } | null = null;
    for (const [a, b] of free) {
      if (b - a < len) continue;
      const cands = new Set<number>([a, b - len]);
      for (let s = Math.ceil(a / 15) * 15; s + len <= b; s += 15) cands.add(s);
      for (const s of cands) {
        const sc = score(st, task, s, len, { now, prefBy, hints, dayLoad, sameDay, preferWithin: opts.preferWithin });
        if (!best || sc < best.sc - 1e-9 || (Math.abs(sc - best.sc) < 1e-9 && s < best.s)) best = { s, sc };
      }
    }
    if (!best) break;
    const ev: Ev = {
      id: uid('c'), title: task.title, type: task.type, subject: task.subject,
      start: fromT(best.s), end: fromT(best.s + len), kind: 'chunk', taskId: task.id,
      priority: task.priority, status: 'planned',
    };
    dr.put('events', ev);
    placed.push(ev);
    remaining -= len;
    const d = dateOf(best.s);
    sameDay.set(d, (sameDay.get(d) ?? 0) + 1);
  }
  return { placed, unplaced: Math.max(0, remaining) };
}

/** Minutes of a task already scheduled in future (planned) chunks. */
export function plannedMinutes(st: State, taskId: string, from?: T): number {
  return st.events
    .filter(e => e.taskId === taskId && e.status === 'planned' && (from === undefined || toT(e.end) > from))
    .reduce((a, e) => a + toT(e.end) - Math.max(toT(e.start), from ?? -Infinity), 0);
}

export function remainingMinutes(task: Task): number {
  return Math.max(0, task.estimateMin - task.doneMin);
}

/** Remaining minutes not yet covered by planned chunks. */
export function unplannedMinutes(st: State, task: Task, now: T): number {
  return Math.max(0, remainingMinutes(task) - plannedMinutes(st, task.id, now));
}

