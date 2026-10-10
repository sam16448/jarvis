import { at, addDays, dateOf, dateRange, DAY, dayNum, endAt, hm, nightAt, toT, weekday, type T } from './time';
import { HINT_ROLES, type ItemType, type Occ, type Series, type SlotRole, type State } from './types';

const ROLE_TYPE: Record<SlotRole, ItemType> = {
  college: 'routine', commute: 'routine', meal: 'routine', other: 'routine',
  club: 'club', study: 'study', assignment: 'assignment',
};

export function seriesOccursOn(s: Series, date: string): boolean {
  if (date < s.startDate) return false;
  if (s.until && date > s.until) return false;
  if (!matchesFreq(s, date)) return false;
  if (s.count) {
    let n = 0;
    for (let d = s.startDate; d <= date; d = addDays(d, 1)) if (matchesFreq(s, d)) n++;
    if (n > s.count) return false;
  }
  return true;
}

function matchesFreq(s: Series, date: string): boolean {
  const wd = weekday(date);
  switch (s.freq) {
    case 'daily': return true;
    case 'weekdays': return wd >= 1 && wd <= 5;
    case 'weekly': return (s.days?.length ? s.days : [weekday(s.startDate)]).includes(wd);
    case 'days': return (s.days ?? []).includes(wd);
  }
}

/** All occurrences overlapping dates [from, to] inclusive, sorted by start. */
export function timeline(st: State, from: string, to: string): Occ[] {
  const out: Occ[] = [];
  const lo = dayNum(from) * DAY, hi = (dayNum(to) + 1) * DAY;
  for (const d of dateRange(addDays(from, -1), to)) {
    const wd = weekday(d);
    const ov = st.days.find(x => x.id === d);
    for (const slot of st.settings.template) {
      if (!slot.days.includes(wd)) continue;
      const sk = ov?.slots[slot.id];
      if (sk?.deleted) continue;
      const s = at(d, sk?.start ?? slot.start);
      const e = endAt(d, sk?.start ?? slot.start, sk?.end ?? slot.end);
      const hint = HINT_ROLES.includes(slot.role);
      out.push({
        key: `tpl:${slot.id}:${d}`, source: 'template', id: slot.id, date: d, s, e,
        title: slot.label, type: ROLE_TYPE[slot.role], priority: slot.role === 'club' ? 'flexible' : 'normal',
        busy: !hint, hint: hint ? slot.role : undefined, role: slot.role, status: 'planned',
      });
    }
    for (const se of st.series) {
      if (!seriesOccursOn(se, d)) continue;
      const ex = se.exceptions[d];
      if (ex?.deleted) continue;
      const st0 = ex?.start ?? se.startTime;
      out.push({
        key: `ser:${se.id}:${d}`, source: 'series', id: se.id, date: d,
        s: at(d, st0), e: endAt(d, st0, ex?.end ?? se.endTime),
        title: se.title, type: se.type, subject: se.subject, priority: se.priority,
        busy: true, status: ex?.status ?? 'planned',
      });
    }
  }
  for (const ev of st.events) {
    const s = toT(ev.start), e = toT(ev.end);
    if (e <= lo || s >= hi) continue;
    out.push({
      key: `ev:${ev.id}`, source: 'event', id: ev.id, date: dateOf(s), s, e, title: ev.title,
      type: ev.type, subject: ev.subject, priority: ev.priority, busy: ev.status !== 'skipped',
      status: ev.status, kind: ev.kind, taskId: ev.taskId,
    });
  }
  for (const ex of st.exams) {
    const s = toT(ex.start), e = toT(ex.end);
    if (e <= lo || s >= hi) continue;
    out.push({
      key: `exam:${ex.id}`, source: 'exam', id: ex.id, date: dateOf(s), s, e, title: ex.title,
      type: 'exam', subject: ex.subject, priority: 'critical', busy: true, status: 'planned',
    });
  }
  return out.filter(o => o.e > lo && o.s < hi).sort((a, b) => a.s - b.s || a.e - b.e);
}

export function occByKey(st: State, key: string, date: string): Occ | undefined {
  return timeline(st, date, date).find(o => o.key === key);
}

// ---------- Day windows & sleep ----------

export function wakeT(st: State, date: string): T {
  return at(date, st.settings.wake);
}

/** Planned bedtime for the night starting on `date` (override if set). */
export function bedT(st: State, date: string): T {
  const ov = st.days.find(d => d.id === date)?.bedtime;
  return nightAt(date, ov ?? st.settings.bedtime);
}

/** Latest allowed bedtime: min(latestBedtime, next wake - minimum sleep). */
export function hardBedT(st: State, date: string): T {
  const s = st.settings;
  return Math.min(nightAt(date, s.latestBedtime), at(addDays(date, 1), s.wake) - Math.round(s.minSleepH * 60));
}

export function plannedSleepH(st: State, date: string): number {
  return (at(addDays(date, 1), st.settings.wake) - bedT(st, date)) / 60;
}

export function normalSleepH(st: State): number {
  return (DAY - hm(st.settings.bedtime) + hm(st.settings.wake)) % DAY / 60 || 0;
}

// ---------- Free time ----------

export type Interval = [number, number];

export function subtract(base: Interval[], cut: Interval[]): Interval[] {
  let res = base.slice();
  for (const [cs, ce] of cut) {
    const next: Interval[] = [];
    for (const [s, e] of res) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    res = next;
  }
  return res;
}

export interface FreeOpts {
  ignoreKeys?: Set<string>;
  /** Override the end of the day window for specific dates (T). */
  dayEnd?: Record<string, T>;
  buffer?: number;
}

/** Free intervals between `from` and `to`, inside each day's wake..bedtime window. */
export function freeIntervals(st: State, from: T, to: T, opts: FreeOpts = {}): Interval[] {
  if (to <= from) return [];
  const buf = opts.buffer ?? st.settings.bufferMin;
  const d0 = dateOf(from), d1 = dateOf(to);
  const occs = timeline(st, addDays(d0, -1), d1).filter(o => o.busy && !opts.ignoreKeys?.has(o.key));
  const windows: Interval[] = [];
  for (const d of dateRange(addDays(d0, -1), d1)) {
    const end = opts.dayEnd?.[d] ?? bedT(st, d);
    windows.push([wakeT(st, d), end]);
  }
  const cuts: Interval[] = occs.map(o => [o.s - buf, o.e + buf]);
  return subtract(windows, cuts)
    .map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as Interval)
    .filter(([s, e]) => e - s >= 5);
}

export function freeMinutes(st: State, from: T, to: T): number {
  return freeIntervals(st, from, to).reduce((a, [s, e]) => a + e - s, 0);
}
