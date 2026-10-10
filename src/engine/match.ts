import { addDays, dateOf, toT, type T } from './time';
import { timeline } from './timeline';
import type { Exam, Occ, Series, State, Task } from './types';

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOP = new Set(['the', 'my', 'a', 'an', 'with', 'for', 'of', 'to', 'today', 'tomorrow', 'session', 'block', 'study', 'class']);

/** Expand a query with subject aliases ("chem" -> "Chemistry"). */
export function canonicalSubject(st: State, text: string): string | undefined {
  const q = ` ${norm(text)} `;
  for (const s of st.settings.subjects) {
    for (const a of [s.name, ...s.aliases]) {
      if (q.includes(` ${norm(a)} `)) return s.name;
    }
  }
  return undefined;
}

function textScore(query: string, title: string, subject: string | undefined, st: State): number {
  const q = norm(query), t = norm(title);
  if (!q) return 0;
  if (t === q) return 100;
  let sc = 0;
  if (t.includes(q)) sc = Math.max(sc, 80);
  const qs = canonicalSubject(st, query);
  const ts = subject ?? canonicalSubject(st, title);
  if (qs && ts && qs === ts) sc = Math.max(sc, 70);
  const words = q.split(' ').filter(w => w.length > 1 && !STOP.has(w));
  if (words.length) {
    const tw = new Set(t.split(' '));
    const hit = words.filter(w => tw.has(w) || [...tw].some(x => x.startsWith(w) && w.length >= 3)).length;
    sc = Math.max(sc, Math.round((hit / words.length) * 60));
  }
  return sc;
}

export type Target =
  | { kind: 'occ'; occ: Occ; task?: Task; series?: Series }
  | { kind: 'task'; task: Task }
  | { kind: 'exam'; exam: Exam };

export interface MatchResult {
  best?: Target;
  ambiguous?: string[];
  label?: string;
}

/**
 * Find what the user means. Prefers occurrences on `date` (default today, nearest to now),
 * then open tasks, then exams.
 */
export function findTarget(st: State, query: string, now: T, opts: { date?: string; preferDone?: boolean; includeRoutine?: boolean } = {}): MatchResult {
  const today = dateOf(now);
  const date = opts.date ?? today;
  const occs = timeline(st, date, opts.date ? date : addDays(today, 7))
    .filter(o => !o.hint && (opts.includeRoutine || o.source !== 'template' || o.role === 'club'));
  type C = { t: Target; sc: number; label: string; dist: number };
  const cands: C[] = [];
  for (const o of occs) {
    const sc = textScore(query, o.title, o.subject, st);
    if (sc < 50) continue;
    const task = o.taskId ? st.tasks.find(t => t.id === o.taskId) : undefined;
    const series = o.source === 'series' ? st.series.find(s => s.id === o.id) : undefined;
    const onDate = o.date === date ? 0 : 1;
    // closeness to now: current > upcoming today > earlier today > later days
    const dist = onDate * 1e6 + (o.s <= now && o.e > now ? 0 : o.s > now ? o.s - now : (now - o.e) * 1.5);
    cands.push({ t: { kind: 'occ', occ: o, task, series }, sc, label: o.title, dist });
  }
  for (const t of st.tasks) {
    if (t.status !== 'open') continue;
    const sc = textScore(query, t.title, t.subject, st);
    if (sc < 50) continue;
    if (cands.some(c => c.t.kind === 'occ' && c.t.task?.id === t.id)) continue;
    cands.push({ t: { kind: 'task', task: t }, sc, label: t.title, dist: 2e6 });
  }
  for (const e of st.exams) {
    const sc = textScore(query, e.title, e.subject, st);
    if (sc < 50 || toT(e.end) < now) continue;
    cands.push({ t: { kind: 'exam', exam: e }, sc: sc - 5, label: e.title, dist: 3e6 });
  }
  if (!cands.length) return {};
  cands.sort((a, b) => b.sc - a.sc || a.dist - b.dist);
  const top = cands[0];
  const rivals = cands.filter(c => c.sc === top.sc && c.dist === top.dist && c.label !== top.label);
  if (rivals.length) return { ambiguous: [top.label, ...rivals.map(r => r.label)].slice(0, 3) };
  return { best: top.t, label: top.label };
}
