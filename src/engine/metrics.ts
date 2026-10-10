import { compareRank, plannedMinutes, rank, remainingMinutes } from './place';
import { studyDoneMinutes, studyPlannedMinutes } from './plan';
import { addDays, at, DAY, dateOf, daysBetween, toT, weekday, type T } from './time';
import { bedT, freeIntervals, freeMinutes, normalSleepH, plannedSleepH, timeline } from './timeline';
import type { Exam, Occ, State, Task } from './types';

export type Risk = 'on track' | 'tight' | 'at risk' | 'done';

export function taskRisk(st: State, t: Task, now: T): Risk {
  if (t.status !== 'open') return 'done';
  const rem = remainingMinutes(t);
  if (rem <= 0) return 'on track';
  if (!t.deadline) return plannedMinutes(st, t.id, now) >= rem ? 'on track' : 'tight';
  const dl = toT(t.deadline);
  if (dl <= now) return 'at risk';
  const planned = plannedMinutes(st, t.id, now);
  const unplanned = rem - planned;
  if (unplanned > 0) return freeMinutes(st, now, dl) >= unplanned ? 'tight' : 'at risk';
  const last = Math.max(...st.events.filter(e => e.taskId === t.id && e.status === 'planned').map(e => toT(e.end)));
  return dl - last < DAY ? 'tight' : 'on track';
}

export interface ExamStat {
  exam: Exam;
  daysLeft: number;
  targetMin: number;
  doneMin: number;
  plannedMin: number;
  freeMin: number;
  status: Risk;
  perDayNeededMin: number; // to finish the remaining target evenly
}

export function examStats(st: State, now: T): ExamStat[] {
  const today = dateOf(now);
  return st.exams
    .filter(e => toT(e.end) > now)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map(exam => {
      const start = toT(exam.start);
      const targetMin = Math.round(exam.targetHours * 60);
      const doneMin = studyDoneMinutes(st, exam.subject);
      const plannedMin = studyPlannedMinutes(st, exam.subject, now, start);
      const freeMin = freeMinutes(st, now, start);
      const daysLeft = Math.max(0, daysBetween(today, exam.start.slice(0, 10)));
      const left = Math.max(0, targetMin - doneMin);
      const status: Risk = doneMin + plannedMin >= targetMin ? 'on track' : doneMin + plannedMin + freeMin * 0.5 >= targetMin ? 'tight' : 'at risk';
      return { exam, daysLeft, targetMin, doneMin, plannedMin, freeMin, status, perDayNeededMin: daysLeft ? Math.ceil(left / daysLeft) : left };
    });
}

/** Planned sleep (or logged) per night for the 7 nights ending last night, plus debt vs normal sleep. */
export function sleepWeek(st: State, now: T): { nights: { date: string; hours: number; logged: boolean }[]; debtH: number; lastNightH?: number } {
  const today = dateOf(now);
  const normal = normalSleepH(st);
  const nights = [];
  for (let i = 7; i >= 1; i--) {
    const d = addDays(today, -i);
    const log = st.sleep.find(s => s.id === d);
    const hours = log ? (toT(log.wake) - toT(log.bedtime)) / 60 : plannedSleepH(st, d);
    nights.push({ date: d, hours, logged: !!log });
  }
  const debtH = nights.reduce((a, n) => a + Math.max(0, normal - n.hours), 0);
  return { nights, debtH, lastNightH: nights[nights.length - 1]?.hours };
}

export const WORK_TYPES = new Set(['assignment', 'lab', 'study', 'examprep', 'course', 'club']);

export function isWork(o: Occ): boolean {
  return !o.hint && o.source !== 'template' && o.source !== 'exam' && WORK_TYPES.has(o.type);
}

export function dayLoad(st: State, date: string, from?: T): { workMin: number; freeMin: number } {
  const lo = Math.max(from ?? -Infinity, at(date, st.settings.wake));
  const occs = timeline(st, date, date).filter(o => o.date === date && isWork(o) && o.status === 'planned' && o.e > lo);
  const workMin = occs.reduce((a, o) => a + o.e - Math.max(o.s, lo), 0);
  return { workMin, freeMin: freeMinutes(st, lo, bedT(st, date)) };
}

export interface Overload {
  days: { date: string; workMin: number; capMin: number }[];
  week?: { demandMin: number; supplyMin: number; cut: { title: string; when: string; minutes: number }[] };
}

export function overload(st: State, now: T): Overload {
  const today = dateOf(now);
  const cap = st.settings.dailyWorkCapH * 60;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const { workMin } = dayLoad(st, d);
    if (workMin > cap) days.push({ date: d, workMin, capMin: cap });
  }
  const end = now + 7 * DAY;
  let demand = 0;
  for (const t of st.tasks) {
    if (t.status !== 'open' || !t.deadline || toT(t.deadline) > end) continue;
    demand += Math.max(0, remainingMinutes(t) - plannedMinutes(st, t.id, now));
  }
  for (const s of examStats(st, now)) {
    if (toT(s.exam.start) > end) continue;
    demand += Math.max(0, s.targetMin - s.doneMin - s.plannedMin);
  }
  const supply = freeMinutes(st, now, end);
  let week: Overload['week'];
  if (demand > supply) {
    const cut = timeline(st, today, addDays(today, 6))
      .filter(o => o.priority === 'flexible' && o.s > now && !o.hint && o.status === 'planned')
      .slice(0, 6)
      .map(o => ({ title: o.title, when: `${o.date}`, minutes: o.e - o.s }));
    week = { demandMin: demand, supplyMin: supply, cut };
  }
  return { days, week };
}

/** Top priorities: open tasks with work today or soon, by rank. */
export function topPriorities(st: State, now: T, n = 3): Task[] {
  const soon = now + 3 * DAY;
  return st.tasks
    .filter(t => t.status === 'open' && ((t.deadline !== undefined && toT(t.deadline) <= soon) || plannedMinutes(st, t.id, now) > 0))
    .sort((a, b) => compareRank(rank(st, a), rank(st, b)))
    .slice(0, n);
}

export function freeToday(st: State, now: T): number {
  return freeMinutes(st, now, bedT(st, dateOf(now)));
}

export function freeSpans(st: State, date: string, now: T, minLen = 15) {
  const from = Math.max(now, at(date, st.settings.wake));
  return freeIntervals(st, from, bedT(st, date)).filter(([a, b]) => b - a >= minLen);
}

export function isSunday(date: string) { return weekday(date) === 0; }

/** Done study minutes per subject between two dates (inclusive from, exclusive to). */
export function studyBySubject(st: State, from: string, to: string): Record<string, number> {
  const names = new Set<string>([...st.settings.subjects.map(s => s.name), ...st.exams.map(e => e.subject)]);
  for (const e of st.events) if (e.subject) names.add(e.subject);
  const out: Record<string, number> = {};
  for (const n of names) {
    const m = studyDoneMinutes(st, n, from, to);
    if (m > 0) out[n] = m;
  }
  return out;
}

/** Bedtime that protects minimum sleep before tomorrow's wake-up. */
export function latestSafeBedtime(st: State, date: string): number {
  return at(addDays(date, 1), st.settings.wake) - Math.round(st.settings.minSleepH * 60);
}
