import { diffStates, diffWindow } from './diff';
import { canonicalSubject, findTarget, type Target } from './match';
import { compareRank, defaultPriority, estimateFor, inferEffort, placeTask, plannedMinutes, rank, remainingMinutes, unplannedMinutes } from './place';
import { answerQuery } from './queries';
import { applyOps, Draft, uid } from './state';
import { addDays, at, clock, DAY, dateOf, dateRange, dur, fromT, hm, nightAt, range, roundDown, roundUp, shortDate, timeOf, toT, type T } from './time';
import { bedT, freeIntervals, hardBedT, plannedSleepH, timeline, wakeT } from './timeline';
import type { Command, Conflict, ConflictOption, DiffLine, Ev, Occ, PlanResult, Priority, Proposal, Series, State, Task, TaskType, TimeOfDay } from './types';

// ---------- helpers ----------

function proposal(orig: State, dr: Draft, understood: string, now: T, extra: Partial<Proposal> = {}): Proposal {
  const ops = dr.result();
  const after = applyOps(orig, ops);
  const [a, b] = diffWindow(orig, after, dateOf(now));
  return { type: 'proposal', understood, ops, diff: diffStates(orig, after, a, b), warnings: [], conflicts: [], ...extra };
}

const isMovableChunk = (o: Occ) => o.source === 'event' && o.kind === 'chunk' && o.status === 'planned';

function taskOf(st: State, id?: string): Task | undefined {
  return id ? st.tasks.find(t => t.id === id) : undefined;
}

function setSeriesException(dr: Draft, seriesId: string, date: string, patch: Series['exceptions'][string] | null) {
  const s = dr.state.series.find(x => x.id === seriesId)!;
  const exceptions = { ...s.exceptions };
  if (patch === null) delete exceptions[date];
  else exceptions[date] = { ...exceptions[date], ...patch };
  dr.put('series', { ...s, exceptions });
}

function setTemplateSlot(dr: Draft, date: string, slotId: string, patch: { deleted?: boolean; start?: string; end?: string } | null) {
  const d = dr.day(date);
  const slots = { ...d.slots };
  if (patch === null) delete slots[slotId];
  else slots[slotId] = { ...slots[slotId], ...patch };
  dr.put('days', { ...d, slots });
}

function setBedtime(dr: Draft, date: string, bedtime: string | undefined) {
  const d = dr.day(date);
  dr.put('days', { ...d, bedtime });
}

function urgentWarnings(placed: Ev[], task: Task): string[] {
  if (!task.deadline || !placed.length) return [];
  const last = Math.max(...placed.map(p => toT(p.end)));
  const dl = toT(task.deadline);
  if (dl - last < DAY) return [`${task.title} is now tight: last part ends ${shortDate(dateOf(last))} ${clock(last)}, due ${shortDate(task.deadline.slice(0, 10))} ${clock(dl)}.`];
  return [];
}

// ---------- displacement ----------

interface Seed {
  occ: Occ;          // original occurrence
  task?: Task;       // for chunks
  minutes: number;
  reason: string;
}

/**
 * Clear [s,e): trims routine template slots, removes movable chunks and series occurrences
 * (returned as seeds to relocate), warns about fixed events/exams that stay.
 */
function clearSpan(dr: Draft, s: T, e: T, selfKeys: Set<string>): { seeds: Seed[]; warnings: string[] } {
  const seeds: Seed[] = [];
  const warnings: string[] = [];
  const occs = timeline(dr.state, dateOf(s), dateOf(e - 1))
    .filter(o => o.e > s && o.s < e && !selfKeys.has(o.key) && !o.hint && o.status === 'planned');
  for (const o of occs) {
    if (o.source === 'template') {
      if (o.s >= s && o.e <= e) setTemplateSlot(dr, o.date, o.id, { deleted: true });
      else if (o.s < s && (o.e <= e || s - o.s >= o.e - e)) setTemplateSlot(dr, o.date, o.id, { end: timeOf(s) });
      else setTemplateSlot(dr, o.date, o.id, { start: timeOf(e) });
    } else if (o.source === 'event' && o.kind === 'chunk') {
      const task = taskOf(dr.state, o.taskId);
      dr.del('events', o.id);
      if (task && task.status === 'open') seeds.push({ occ: o, task, minutes: o.e - Math.max(o.s, 0), reason: '' });
    } else if (o.source === 'series') {
      setSeriesException(dr, o.id, o.date, { deleted: true });
      seeds.push({ occ: o, minutes: o.e - o.s, reason: '' });
    } else if (o.source === 'exam') {
      warnings.push(`Overlaps your exam ${o.title} (${range(o.s, o.e)}). The exam stays.`);
    } else if (o.source === 'event' && o.kind === 'fixed') {
      warnings.push(`Overlaps ${o.title} (${range(o.s, o.e)}), which stays as is.`);
    }
  }
  return { seeds, warnings };
}

interface Ctx { now: T; after: T; block?: Ev; }

/** Try to move each seed into later free time; risky ones become conflicts. */
function relocate(orig: State, dr: Draft, seeds: Seed[], ctx: Ctx): { conflicts: Seed[]; warnings: string[] } {
  const conflicts: Seed[] = [];
  const warnings: string[] = [];
  const keyed = seeds.map(sd => ({ sd, r: sd.task ? rank(dr.state, sd.task) : [sd.occ.priority === 'critical' ? 0 : 2, sd.occ.s] as [number, number] }));
  keyed.sort((a, b) => compareRank(a.r, b.r));
  for (const { sd } of keyed) {
    if (sd.occ.priority === 'critical' || sd.task?.priority === 'critical') {
      conflicts.push({ ...sd, reason: `${sd.occ.title} is critical, so I won't move it without asking.` });
      continue;
    }
    if (sd.task) {
      const tmp = dr.clone();
      const res = placeTask(tmp, sd.task, sd.minutes, { from: Math.max(ctx.now, ctx.after) });
      if (res.unplaced > 0) {
        const dl = sd.task.deadline ? ` before it's due ${shortDate(sd.task.deadline.slice(0, 10))} ${clock(sd.task.deadline)}` : '';
        conflicts.push({ ...sd, reason: `No room for ${dur(res.unplaced)} of ${sd.task.title}${dl}.` });
        continue;
      }
      dr.adopt(tmp);
      warnings.push(...urgentWarnings(res.placed, sd.task));
    } else {
      // series occurrence: try later the same day, otherwise skip it today
      const len = sd.minutes;
      const free = freeIntervals(dr.state, Math.max(ctx.now, ctx.after), bedT(dr.state, sd.occ.date)).find(([a, b]) => b - a >= len);
      if (free) {
        const s = roundUp(free[0], 5);
        if (s + len <= free[1]) {
          setSeriesException(dr, sd.occ.id, sd.occ.date, { deleted: false, start: timeOf(s), end: timeOf(s + len) });
          continue;
        }
      }
      warnings.push(`Skipped ${sd.occ.title} on ${shortDate(sd.occ.date)}, no room later that day.`);
    }
  }
  void orig;
  return { conflicts, warnings };
}

// ---------- conflict options ----------

function optionDiff(base: Draft, opt: Draft, now: T): DiffLine[] {
  const [a, b] = diffWindow(base.state, opt.state, dateOf(now));
  return diffStates(base.state, opt.state, a, b);
}

function buildConflict(base: Draft, sd: Seed, ctx: Ctx, days: string[]): Conflict {
  const st = base.state;
  const options: ConflictOption[] = [];
  const title = sd.occ.title;
  const deadline = sd.task?.deadline ? toT(sd.task.deadline) : sd.task ? undefined : bedT(st, sd.occ.date);
  const from = Math.max(ctx.now, ctx.after);
  const synthetic: Task = sd.task ?? {
    id: '__series', title, type: 'study', priority: sd.occ.priority, estimateMin: sd.minutes, doneMin: 0,
    splittable: false, preferredTime: 'any', effort: 'normal', status: 'open', createdAt: fromT(ctx.now),
  };

  const commitPlacement = (dr: Draft, s: T, e: T) => {
    if (sd.task) {
      dr.put('events', { id: uid('c'), title, type: sd.task.type, subject: sd.task.subject, start: fromT(s), end: fromT(e), kind: 'chunk', taskId: sd.task.id, priority: sd.task.priority, status: 'planned' } satisfies Ev);
    } else {
      setSeriesException(dr, sd.occ.id, sd.occ.date, { deleted: false, start: timeOf(s), end: timeOf(e) });
    }
  };

  // (a) later today after the block, pushing bedtime if needed
  for (const day of days) {
    const dr = base.clone();
    const ext = nightAt(day, '03:00');
    const winFrom = Math.max(from, wakeT(st, day));
    const until = deadline !== undefined ? Math.min(deadline, ext) : ext;
    if (until <= winFrom) continue;
    const free = freeIntervals(dr.state, winFrom, until, { dayEnd: { [day]: ext } }).filter(([a]) => dateOf(a) === day || a < ext);
    const slot = free.find(([a, b]) => b - roundUp(a, 5) >= sd.minutes);
    if (!slot) continue;
    const s = roundUp(slot[0], 5), e = s + sd.minutes;
    commitPlacement(dr, s, e);
    const normal = bedT(st, day);
    const warnings: string[] = [];
    let detail = `${title} at ${range(s, e)}`;
    if (e > normal - st.settings.bufferMin) {
      const newBed = roundUp(e + st.settings.bufferMin, 5);
      setBedtime(dr, day, timeOf(newBed));
      const sleep = plannedSleepH(dr.state, day);
      detail += `. Bedtime moves to ${clock(newBed)}, giving ${sleep.toFixed(1)} h sleep.`;
      if (newBed > hardBedT(st, day)) warnings.push(`That's below your ${st.settings.minSleepH} h minimum sleep and adds ${(st.settings.minSleepH - sleep).toFixed(1)} h of sleep debt.`);
    } else detail += '. Bedtime unchanged.';
    options.push({
      key: 'a', label: day === dateOf(ctx.now) ? 'Do it later today' + (e > normal - st.settings.bufferMin ? ' and push bedtime' : '') : `Do it ${shortDate(day)}` + (e > normal - st.settings.bufferMin ? ', push bedtime' : ''),
      detail, ops: dr.since(base), diff: optionDiff(base, dr, ctx.now), warnings,
    });
    break;
  }

  // (b) shorten the block so the item keeps its original time
  if (ctx.block) {
    const bs = toT(ctx.block.start), be = toT(ctx.block.end), buf = st.settings.bufferMin;
    let nb: [T, T] | null = null;
    if (sd.occ.s - buf > bs && sd.occ.s - buf - bs >= 15) nb = [bs, sd.occ.s - buf];
    else if (sd.occ.e + buf < be && be - sd.occ.e - buf >= 15) nb = [sd.occ.e + buf, be];
    if (nb) {
      const dr = base.clone();
      dr.put('events', { ...ctx.block, start: fromT(nb[0]), end: fromT(nb[1]) });
      if (sd.task) {
        const ev = orig(base, sd.occ);
        if (ev) dr.put('events', ev);
      } else setSeriesException(dr, sd.occ.id, sd.occ.date, null);
      options.push({
        key: 'b', label: 'Shorten the block',
        detail: `${ctx.block.title} becomes ${range(nb[0], nb[1])}; ${title} stays at ${range(sd.occ.s, sd.occ.e)}.`,
        ops: dr.since(base), diff: optionDiff(base, dr, ctx.now), warnings: [],
      });
    }
  }

  // (c) swap with a lower-priority chunk before the deadline
  if (sd.task) {
    const myRank = rank(st, sd.task);
    const end = deadline ?? from + 3 * DAY;
    const cands = timeline(st, dateOf(from), dateOf(end))
      .filter(o => isMovableChunk(o) && o.s >= from && o.s + sd.minutes <= end && o.e - o.s >= sd.minutes && o.taskId !== sd.task!.id)
      .map(o => ({ o, t: taskOf(st, o.taskId)! }))
      .filter(x => x.t && compareRank(rank(st, x.t), myRank) > 0)
      .sort((x, y) => compareRank(rank(st, y.t), rank(st, x.t)) || x.o.s - y.o.s);
    const c = cands[0];
    if (c) {
      const dr = base.clone();
      dr.del('events', c.o.id);
      commitPlacement(dr, c.o.s, c.o.s + sd.minutes);
      const res = placeTask(dr, c.t, c.o.e - c.o.s, { from: c.o.s + sd.minutes });
      const moved = res.placed[0];
      const warnings = res.unplaced ? [`${dur(res.unplaced)} of ${c.t.title} has no slot left. It will show as unscheduled.`] : urgentWarnings(res.placed, c.t);
      options.push({
        key: 'c', label: `Swap with ${c.t.title}`,
        detail: `${title} takes ${shortDate(c.o.date)} ${range(c.o.s, c.o.s + sd.minutes)}; ${c.t.title} ${moved ? `moves to ${shortDate(dateOf(toT(moved.start)))} ${range(toT(moved.start), toT(moved.end))}` : 'becomes unscheduled'}.`,
        ops: dr.since(base), diff: optionDiff(base, dr, ctx.now), warnings,
      });
    }
  }

  // (d) drop a flexible item to make room
  {
    const end = deadline ?? from + 2 * DAY;
    const flex = timeline(st, dateOf(from), dateOf(end))
      .filter(o => o.priority === 'flexible' && o.s >= from && o.e <= end && !o.hint && o.status === 'planned' && o.key !== sd.occ.key && o.e - o.s >= Math.min(sd.minutes, 30));
    for (const f of flex) {
      const dr = base.clone();
      if (f.source === 'template') setTemplateSlot(dr, f.date, f.id, { deleted: true });
      else if (f.source === 'series') setSeriesException(dr, f.id, f.date, { deleted: true });
      else if (f.source === 'event') dr.del('events', f.id);
      const res = placeTask(dr, synthetic, sd.minutes, { from, until: end, noSplit: !sd.task });
      if (!res.placed.length || (res.unplaced && !sd.task)) continue;
      const usesSlot = res.placed.some(p => toT(p.start) < f.e + st.settings.bufferMin && toT(p.end) > f.s - st.settings.bufferMin);
      if (!usesSlot) continue;
      if (!sd.task) {
        // synthetic placement for a series occurrence -> convert to exception
        for (const p of res.placed) dr.del('events', p.id);
        commitPlacement(dr, toT(res.placed[0].start), toT(res.placed[0].end));
      }
      const p = res.placed[0];
      options.push({
        key: 'd', label: `Drop ${f.title}`,
        detail: `Skip ${f.title} (${shortDate(f.date)} ${range(f.s, f.e)}) and do ${title} at ${range(toT(p.start), toT(p.end))}.`,
        ops: dr.since(base), diff: optionDiff(base, dr, ctx.now),
        warnings: res.unplaced ? [`Still ${dur(res.unplaced)} short after this.`] : [],
      });
      break;
    }
  }

  return { id: uid('k'), title, reason: sd.reason, options };
}

/**
 * A displaced item in conflict stays where it was in the base plan ("leave it for now");
 * each option first removes it, then places it its own way.
 */
function keepInPlace(dr: Draft, sd: Seed, c: Conflict): Conflict {
  if (sd.occ.source === 'event' && sd.task) {
    const ev = orig(dr, sd.occ);
    if (!ev) return c;
    dr.put('events', ev);
    for (const o of c.options) if (o.key !== 'b') o.ops = [{ t: 'del', table: 'events', id: ev.id }, ...o.ops];
  } else if (sd.occ.source === 'series') {
    const before = dr.state.series.find(x => x.id === sd.occ.id);
    if (!before) return c;
    const ex = { ...before.exceptions };
    delete ex[sd.occ.date];
    dr.put('series', { ...before, exceptions: ex });
  }
  return c;
}

function orig(base: Draft, occ: Occ): Ev | undefined {
  // reconstruct a removed chunk event from its occurrence
  if (occ.source !== 'event') return undefined;
  const t = taskOf(base.state, occ.taskId);
  return {
    id: occ.id, title: occ.title, type: occ.type, subject: occ.subject, start: fromT(occ.s), end: fromT(occ.e),
    kind: 'chunk', taskId: occ.taskId, priority: t?.priority ?? occ.priority, status: 'planned',
  };
}

/** Clear a span for a new fixed item, relocate what was there, build conflicts. */
function insertFixed(orig0: State, dr: Draft, ev: Ev, now: T): { warnings: string[]; conflicts: Conflict[] } {
  dr.put('events', ev);
  const s = toT(ev.start), e = toT(ev.end);
  const { seeds, warnings } = clearSpan(dr, s, e, new Set([`ev:${ev.id}`]));
  const ctx: Ctx = { now, after: e, block: ev };
  const r = relocate(orig0, dr, seeds, ctx);
  warnings.push(...r.warnings);
  const day = dateOf(s);
  const conflicts = r.conflicts.map(sd => keepInPlace(dr, sd, buildConflict(dr, sd, ctx, [day])));
  if (e > bedT(dr.state, day)) warnings.push(`${ev.title} ends after your bedtime. Sleep that night: ${((at(addDays(day, 1), dr.state.settings.wake) - e) / 60).toFixed(1)} h.`);
  return { warnings, conflicts };
}

// ---------- command handlers ----------

function mkTask(st: State, c: Extract<Command, { kind: 'addTask' }>, now: T): Task {
  const type: TaskType = c.type ?? 'assignment';
  const est = c.estimateMin ?? estimateFor(st, type);
  return {
    id: uid('t'), title: c.title, subject: c.subject, type,
    priority: c.priority ?? defaultPriority(type), estimateMin: est, doneMin: 0,
    deadline: c.due, earliestStart: c.earliestStart,
    splittable: c.splittable ?? est > st.settings.chunkMaxMin,
    preferredTime: c.preferredTime ?? 'any', effort: inferEffort(st, c.title, type, c.subject),
    status: 'open', createdAt: fromT(now),
  };
}

function addTask(st: State, c: Extract<Command, { kind: 'addTask' }>, now: T): PlanResult {
  if (!c.due && c.type !== 'personal' && c.type !== 'club') return { type: 'question', question: `When is "${c.title}" due?`, partial: c };
  const dr = new Draft(st);
  const task = mkTask(st, c, now);
  if (task.deadline && toT(task.deadline) <= now) return { type: 'question', question: `That deadline (${shortDate(task.deadline.slice(0, 10))} ${clock(task.deadline)}) has passed. When is it due?`, partial: { ...c, due: undefined } };
  dr.put('tasks', task);
  const res = placeTask(dr, task, task.estimateMin, { from: now });
  const est = c.estimateMin ? dur(task.estimateMin) : `${dur(task.estimateMin)} (estimated)`;
  const understood = `Add ${task.type}: “${task.title}”${task.subject ? ` [${task.subject}]` : ''}, ${est}${task.deadline ? `, due ${shortDate(task.deadline.slice(0, 10))} ${clock(task.deadline)}` : ''}.`;
  const warnings = urgentWarnings(res.placed, task);
  const conflicts: Conflict[] = [];
  if (res.unplaced > 0) {
    const days = dateRange(dateOf(now), task.deadline ? dateOf(toT(task.deadline)) : addDays(dateOf(now), 2));
    const sd: Seed = {
      occ: { key: 'new', source: 'event', id: 'new', date: dateOf(now), s: now, e: now, title: task.title, type: task.type, priority: task.priority, busy: false, status: 'planned' },
      task: dr.state.tasks.find(t => t.id === task.id)!, minutes: res.unplaced,
      reason: `Only ${dur(task.estimateMin - res.unplaced)} of ${dur(task.estimateMin)} fits before the deadline.`,
    };
    const minutes = Math.min(sd.minutes, st.settings.chunkMaxMin * 2);
    conflicts.push(buildConflict(dr, { ...sd, minutes }, { now, after: now }, days));
  }
  return proposal(st, dr, understood, now, { warnings, conflicts });
}

function addEvent(st: State, c: Extract<Command, { kind: 'addEvent' }> | Extract<Command, { kind: 'blockTime' }>, now: T): PlanResult {
  const s = toT(c.start), e = toT(c.end);
  if (e <= s) return { type: 'question', question: 'What time does it end?', partial: c };
  const block = c.kind === 'blockTime';
  const dr = new Draft(st);
  if (c.kind === 'addEvent' && c.type === 'exam') {
    // exams live in their own table so they get countdowns and study targets
    const subject = c.subject ?? canonicalSubject(st, c.title) ?? c.title;
    const exam = { id: uid('x'), subject, title: c.title, start: c.start, end: c.end, targetHours: 0 };
    dr.put('exams', exam);
    const { seeds, warnings } = clearSpan(dr, s, e, new Set([`exam:${exam.id}`]));
    const ctx: Ctx = { now, after: e };
    const r = relocate(st, dr, seeds, ctx);
    const conflicts = r.conflicts.map(sd => keepInPlace(dr, sd, buildConflict(dr, sd, ctx, [dateOf(s)])));
    return proposal(st, dr, `Add exam “${c.title}” [${subject}] on ${shortDate(dateOf(s))} ${range(s, e)}.`, now, { warnings: [...warnings, ...r.warnings], conflicts, info: ['Set a study target for it on the Exams screen.'] });
  }
  const ev: Ev = {
    id: uid('e'), title: c.title, type: block ? 'block' : (c.type ?? 'event'),
    subject: c.kind === 'addEvent' ? c.subject : undefined,
    start: fromT(block ? Math.max(s, roundDown(now, 5)) : s), end: c.end, kind: block ? 'block' : 'fixed',
    priority: block ? 'critical' : (c.kind === 'addEvent' && c.priority) || 'normal', status: 'planned',
  };
  if (toT(ev.start) >= e) return { type: 'question', question: 'That time has already passed. Which time did you mean?', partial: c };
  const { warnings, conflicts } = insertFixed(st, dr, ev, now);
  const understood = block
    ? `Block ${shortDate(dateOf(s))} ${range(toT(ev.start), e)} for “${c.title}” and move what's there.`
    : `Add “${c.title}” on ${shortDate(dateOf(s))} ${range(s, e)}.`;
  return proposal(st, dr, understood, now, { warnings, conflicts });
}

function addSeries(st: State, c: Extract<Command, { kind: 'addSeries' }>, now: T): PlanResult {
  if (hm(c.endTime) === hm(c.startTime)) return { type: 'question', question: 'What time does it end?', partial: c };
  const dr = new Draft(st);
  const today = dateOf(now);
  const series: Series = {
    id: uid('s'), title: c.title, type: c.type ?? 'study', subject: c.subject,
    startTime: c.startTime, endTime: c.endTime, freq: c.freq, days: c.days,
    startDate: c.startDate ?? today, until: c.until, count: c.count,
    priority: 'normal', exceptions: {},
  };
  if (series.until && series.until < series.startDate) return { type: 'question', question: `The end date ${shortDate(series.until)} is before the start. Until when?`, partial: c };
  dr.put('series', series);
  const { warnings, conflicts } = settleSeries(st, dr, series, now);
  const n = timeline(dr.state, series.startDate, series.until ?? addDays(series.startDate, 60)).filter(o => o.key.startsWith(`ser:${series.id}:`)).length;
  const understood = `Add recurring “${c.title}” ${c.freq === 'weekdays' ? 'every weekday' : c.freq === 'daily' ? 'every day' : 'on selected days'} ${clock(c.startTime)}-${clock(c.endTime)}${c.until ? ` until ${shortDate(c.until)}` : c.count ? `, ${c.count} times` : ''} (${n}${!c.until && !c.count ? '+' : ''} sessions).`;
  return proposal(st, dr, understood, now, { warnings: dedupe(warnings), conflicts });
}

const dedupe = (a: string[]) => [...new Set(a)];

function applyTemplate(st: State, c: Extract<Command, { kind: 'applyTemplate' }>, now: T): PlanResult {
  const tpl = st.templates.find(t => t.id === c.templateId);
  if (!tpl) return { type: 'answer', title: 'Not found', lines: ['That template no longer exists.'] };
  const dr = new Draft(st);
  const warnings: string[] = [];
  const conflicts: Conflict[] = [];
  for (const it of [...tpl.items].sort((a, b) => (a.start < b.start ? -1 : 1))) {
    const start = `${c.date}T${it.start}`;
    let end = `${c.date}T${it.end}`;
    if (toT(end) <= toT(start)) end = `${addDays(c.date, 1)}T${it.end}`;
    if (toT(end) <= now) continue;
    const r = insertFixed(st, dr, { id: uid('e'), title: it.title, type: it.type, subject: it.subject, start, end, kind: 'fixed', priority: 'normal', status: 'planned' }, now);
    warnings.push(...r.warnings); conflicts.push(...r.conflicts);
  }
  return proposal(st, dr, `Apply template “${tpl.name}” to ${shortDate(c.date)} (${tpl.items.length} blocks).`, now, { warnings: dedupe(warnings), conflicts });
}

/** Make room for a series' upcoming occurrences (next 3 weeks). */
function settleSeries(st: State, dr: Draft, series: Series, now: T): { warnings: string[]; conflicts: Conflict[] } {
  const today = dateOf(now);
  const horizon = series.until && series.until < addDays(today, 21) ? series.until : addDays(today, 21);
  const warnings: string[] = [];
  const conflicts: Conflict[] = [];
  const from = series.startDate > today ? series.startDate : today;
  for (const o of timeline(dr.state, from, horizon).filter(o => o.key.startsWith(`ser:${series.id}:`))) {
    if (o.e <= now) continue;
    const { seeds, warnings: w } = clearSpan(dr, o.s, o.e, new Set([o.key]));
    warnings.push(...w);
    const r = relocate(st, dr, seeds, { now, after: o.e });
    warnings.push(...r.warnings);
    conflicts.push(...r.conflicts.map(sd => keepInPlace(dr, sd, buildConflict(dr, sd, { now, after: o.e }, [o.date]))));
  }
  return { warnings, conflicts };
}

function editTask(st: State, c: Extract<Command, { kind: 'editTask' }>, now: T): PlanResult {
  const t = st.tasks.find(x => x.id === c.taskId);
  if (!t) return { type: 'answer', title: 'Not found', lines: ['That task no longer exists.'] };
  const dr = new Draft(st);
  const next: Task = { ...t, ...c.patch };
  if (c.patch.priority || c.patch.type || c.patch.title) next.effort = inferEffort(st, next.title, next.type, next.subject);
  dr.put('tasks', next);
  const timing = (['deadline', 'estimateMin', 'earliestStart', 'splittable', 'preferredTime', 'type', 'priority', 'subject'] as const).some(k => k in c.patch && c.patch[k] !== t[k]);
  const warnings: string[] = [];
  for (const ev of dr.state.events.filter(e => e.taskId === t.id)) {
    if (timing && ev.status === 'planned' && toT(ev.start) >= now) dr.del('events', ev.id);
    else if (c.patch.title || c.patch.priority || c.patch.subject || c.patch.type) dr.put('events', { ...ev, title: next.title, priority: next.priority, subject: next.subject, type: next.type });
  }
  if (timing && next.status === 'open') {
    const need = unplannedMinutes(dr.state, next, now);
    if (need > 0) {
      const res = placeTask(dr, next, need, { from: now });
      warnings.push(...urgentWarnings(res.placed, next));
      if (res.unplaced) warnings.push(`${dur(res.unplaced)} of ${next.title} doesn't fit before it's due.`);
    }
  }
  return proposal(st, dr, `Update “${next.title}”.`, now, { warnings });
}

function editEvent(st: State, c: Extract<Command, { kind: 'editEvent' }>, now: T): PlanResult {
  const ev = st.events.find(x => x.id === c.eventId);
  if (!ev) return { type: 'answer', title: 'Not found', lines: ['That item no longer exists.'] };
  const dr = new Draft(st);
  dr.put('events', { ...ev, ...c.patch });
  return proposal(st, dr, `Update “${c.patch.title ?? ev.title}”.`, now);
}

function editSeries(st: State, c: Extract<Command, { kind: 'editSeries' }>, now: T): PlanResult {
  const s = st.series.find(x => x.id === c.seriesId);
  if (!s) return { type: 'answer', title: 'Not found', lines: ['That series no longer exists.'] };
  const dr = new Draft(st);
  const next: Series = { ...s, ...c.patch };
  // future time overrides no longer make sense if the base time changed
  if (c.patch.startTime || c.patch.endTime) {
    const ex: Series['exceptions'] = {};
    for (const [d, v] of Object.entries(s.exceptions)) { if (d < dateOf(now) || v.deleted || v.status) ex[d] = v.deleted || d < dateOf(now) ? v : { status: v.status }; }
    next.exceptions = ex;
  }
  dr.put('series', next);
  const { warnings, conflicts } = settleSeries(st, dr, next, now);
  return proposal(st, dr, `Update the whole “${next.title}” series.`, now, { warnings: dedupe(warnings), conflicts });
}

function notFound(target: string, cmd: Command): PlanResult {
  return { type: 'question', question: `I couldn't find “${target}”. Which item do you mean?`, partial: cmd };
}

/** Resolve an exact reference: 'ev:id', 'ser:id:date', 'tpl:slot:date', 'exam:id', 'task:id'. */
export function findByRef(st: State, ref: string): Target | undefined {
  const [kind, id, date] = ref.split(':');
  if (kind === 'task') { const t = st.tasks.find(x => x.id === id); return t && { kind: 'task', task: t }; }
  let d: string | undefined = date;
  if (kind === 'ev') d = st.events.find(e => e.id === id)?.start.slice(0, 10);
  if (kind === 'exam') d = st.exams.find(e => e.id === id)?.start.slice(0, 10);
  if (!d) return undefined;
  const occ = timeline(st, d, d).find(o => o.key === ref);
  if (!occ) return undefined;
  return { kind: 'occ', occ, task: taskOf(st, occ.taskId), series: occ.source === 'series' ? st.series.find(s => s.id === occ.id) : undefined };
}

function resolveTarget(st: State, target: string, now: T, cmd: Command, opts: { date?: string; includeRoutine?: boolean } = {}): Target | PlanResult {
  const ref = (cmd as { ref?: string }).ref;
  if (ref) { const t = findByRef(st, ref); if (t) return t; }
  const m = findTarget(st, target, now, opts);
  if (m.ambiguous) return { type: 'question', question: `Which one: ${m.ambiguous.join(' or ')}?`, partial: cmd };
  if (!m.best) return notFound(target, cmd);
  return m.best;
}
const isResult = (x: unknown): x is PlanResult => !!x && typeof x === 'object' && 'type' in (x as object) && ['proposal', 'answer', 'question'].includes((x as { type: string }).type);

function finishTask(dr: Draft, task: Task, now: T) {
  for (const ev of dr.state.events.filter(e => e.taskId === task.id && e.status === 'planned' && toT(e.start) >= now)) dr.del('events', ev.id);
  const doneChunks = dr.state.events.filter(e => e.taskId === task.id && e.status === 'done');
  const actual = doneChunks.reduce((a, e) => a + (e.actualMin ?? toT(e.end) - toT(e.start)), 0);
  const t = dr.state.tasks.find(x => x.id === task.id)!;
  dr.put('tasks', { ...t, status: 'done', doneAt: fromT(now), doneMin: Math.max(t.doneMin, actual), actualMin: t.actualMin ?? (actual || t.estimateMin) });
}

function markDone(st: State, c: Extract<Command, { kind: 'markDone' }>, now: T): PlanResult {
  const tg = resolveTarget(st, c.target, now, c, { date: c.date });
  if (isResult(tg)) return tg;
  const dr = new Draft(st);
  let understood = '';
  if (tg.kind === 'occ') {
    const o = tg.occ;
    if (o.source === 'event') {
      const ev = st.events.find(e => e.id === o.id)!;
      dr.put('events', { ...ev, status: 'done' });
      if (tg.task) {
        const len = o.e - o.s;
        const t = { ...tg.task, doneMin: tg.task.doneMin + len };
        dr.put('tasks', t);
        if (c.all || remainingMinutes(t) <= 0) finishTask(dr, t, now);
        understood = c.all || remainingMinutes(t) <= 0 ? `Mark “${t.title}” finished.` : `Mark ${o.title} (${range(o.s, o.e)}) done. ${dur(remainingMinutes(t))} left on this task.`;
      } else understood = `Mark ${o.title} (${range(o.s, o.e)}) done.`;
    } else if (o.source === 'series') {
      setSeriesException(dr, o.id, o.date, { status: 'done' });
      understood = `Mark ${o.title} on ${shortDate(o.date)} done.`;
    } else return { type: 'answer', title: 'Nothing to mark', lines: [`${o.title} isn't something you tick off.`] };
  } else if (tg.kind === 'task') {
    finishTask(dr, tg.task, now);
    understood = `Mark “${tg.task.title}” finished.`;
  } else return { type: 'answer', title: 'Exams', lines: [`${tg.exam.title} is an exam, so there's nothing to mark done.`] };
  return proposal(st, dr, understood, now);
}

function markNotDone(st: State, c: Extract<Command, { kind: 'markNotDone' }>, now: T): PlanResult {
  const tg = resolveTarget(st, c.target, now, c, { date: c.date ?? dateOf(now) });
  if (isResult(tg)) return tg;
  if (tg.kind !== 'occ') return { type: 'answer', title: 'Nothing scheduled', lines: [`${'task' in tg ? tg.task.title : tg.exam.title} has nothing scheduled today.`] };
  const dr = new Draft(st);
  const o = tg.occ;
  const warnings: string[] = [];
  const conflicts: Conflict[] = [];
  if (o.source === 'event') {
    const ev = st.events.find(e => e.id === o.id)!;
    dr.put('events', { ...ev, status: 'missed' });
    if (tg.task) {
      const from = Math.max(now, o.e);
      const res = placeTask(dr, tg.task, o.e - o.s, { from });
      warnings.push(...urgentWarnings(res.placed, tg.task));
      if (res.unplaced) {
        conflicts.push(buildConflict(dr, { occ: o, task: tg.task, minutes: res.unplaced, reason: `No room for ${dur(res.unplaced)} of ${tg.task.title} before it's due.` }, { now, after: from }, [dateOf(now)]));
      }
    }
  } else if (o.source === 'series') {
    setSeriesException(dr, o.id, o.date, { status: 'missed' });
    if (o.subject) warnings.push(`${o.subject} study hours are now ${dur(o.e - o.s)} behind. Say “plan study for ${o.subject}” to make it up.`);
  }
  return proposal(st, dr, `Mark ${o.title} (${range(o.s, o.e)}) not finished and roll it forward.`, now, { warnings, conflicts });
}

function logTime(st: State, c: Extract<Command, { kind: 'logTime' }>, now: T): PlanResult {
  const dr = new Draft(st);
  if (c.target) {
    const tg = resolveTarget(st, c.target, now, c, {});
    if (isResult(tg)) return tg;
    const task = tg.kind === 'task' ? tg.task : tg.kind === 'occ' ? tg.task : undefined;
    if (!task) return { type: 'answer', title: 'Logged', lines: ['Only tasks track real time.'] };
    if (task.status === 'open') {
      const t = { ...task, doneMin: task.doneMin + c.minutes };
      dr.put('tasks', t);
      return proposal(st, dr, `Log ${dur(c.minutes)} on “${task.title}” (${dur(remainingMinutes(t))} left).`, now);
    }
    dr.put('tasks', { ...task, actualMin: c.minutes });
    return proposal(st, dr, `Record that “${task.title}” took ${dur(c.minutes)}.`, now);
  }
  // most recently finished task or chunk
  const lastTask = [...st.tasks].filter(t => t.status === 'done' && t.doneAt).sort((a, b) => (a.doneAt! < b.doneAt! ? 1 : -1))[0];
  const lastChunk = [...st.events].filter(e => e.status === 'done' && e.taskId).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  if (lastChunk && (!lastTask || lastChunk.taskId !== lastTask.id) && taskOf(st, lastChunk.taskId)?.status === 'open') {
    dr.put('events', { ...lastChunk, actualMin: c.minutes });
    const t = taskOf(st, lastChunk.taskId)!;
    const planned = toT(lastChunk.end) - toT(lastChunk.start);
    dr.put('tasks', { ...t, doneMin: t.doneMin - planned + c.minutes });
    return proposal(st, dr, `Record that ${lastChunk.title} (${range(toT(lastChunk.start), toT(lastChunk.end))}) took ${dur(c.minutes)}.`, now);
  }
  if (!lastTask) return { type: 'question', question: 'Which task took that long?', partial: c };
  dr.put('tasks', { ...lastTask, actualMin: c.minutes });
  return proposal(st, dr, `Record that “${lastTask.title}” took ${dur(c.minutes)} (estimate was ${dur(lastTask.estimateMin)}).`, now);
}

function todWindow(st: State, date: string, tod: TimeOfDay | undefined): [T, T] {
  switch (tod) {
    case 'morning': return [wakeT(st, date), at(date, '12:00')];
    case 'afternoon': return [at(date, '12:00'), at(date, '17:00')];
    case 'evening': return [at(date, '17:00'), bedT(st, date)];
    default: return [wakeT(st, date), bedT(st, date)];
  }
}

function move(st: State, c: Extract<Command, { kind: 'move' }>, now: T): PlanResult {
  const tg = resolveTarget(st, c.target, now, c, { includeRoutine: true });
  if (isResult(tg)) return tg;
  const dr = new Draft(st);
  const date = c.date ?? (c.start ? c.start.slice(0, 10) : dateOf(now));
  const [w0, w1] = todWindow(st, date, c.timeOfDay);
  const warnings: string[] = [];
  let conflicts: Conflict[] = [];
  const placeFixedAt = (len: number, selfKey: string): [T, T] | null => {
    if (c.start) return [toT(c.start), toT(c.start) + len];
    const free = freeIntervals(dr.state, Math.max(now, w0), w1, { ignoreKeys: new Set([selfKey]) }).find(([a, b]) => b - roundUp(a, 5) >= len);
    if (!free) return null;
    const s = roundUp(free[0], 5);
    return [s, s + len];
  };
  const where = `${shortDate(date)}${c.timeOfDay && c.timeOfDay !== 'any' ? ' ' + c.timeOfDay : ''}`;
  if (tg.kind === 'occ') {
    const o = tg.occ;
    const len = c.start && c.end ? toT(c.end) - toT(c.start) : o.e - o.s;
    if (len < 5) return { type: 'answer', title: 'Too short', lines: ['The end time must be after the start.'] };
    if (o.source === 'event' && o.kind === 'chunk' && tg.task && !c.start) {
      dr.del('events', o.id);
      const res = placeTask(dr, tg.task, len, { from: Math.max(now, w0), preferWithin: [w0, w1], noSplit: true });
      if (res.unplaced) return { type: 'answer', title: 'No room', lines: [`There's no ${dur(len)} gap for ${o.title} before it's due.`] };
      const p = res.placed[0];
      if (toT(p.start) < w0 || toT(p.end) > w1) warnings.push(`${where} is full, so I picked the nearest free slot.`);
      return proposal(st, dr, `Move ${o.title} to ${where}.`, now, { warnings });
    }
    const span = placeFixedAt(len, o.key);
    if (!span) return { type: 'answer', title: 'No room', lines: [`There's no free ${dur(len)} slot ${where}.`] };
    const [s, e] = span;
    if (o.source === 'event') {
      const ev = st.events.find(x => x.id === o.id)!;
      const moved = { ...ev, start: fromT(s), end: fromT(e) };
      dr.del('events', ev.id);
      const r = insertFixed(st, dr, moved, now);
      warnings.push(...r.warnings); conflicts = r.conflicts;
    } else if (o.source === 'series') {
      if (dateOf(s) === o.date) setSeriesException(dr, o.id, o.date, { deleted: false, start: timeOf(s), end: timeOf(e) });
      else {
        setSeriesException(dr, o.id, o.date, { deleted: true });
        const r = insertFixed(st, dr, { id: uid('e'), title: o.title, type: o.type, subject: o.subject, start: fromT(s), end: fromT(e), kind: 'fixed', priority: o.priority, status: 'planned' }, now);
        warnings.push(...r.warnings); conflicts = r.conflicts;
      }
    } else if (o.source === 'template') {
      if (dateOf(s) !== o.date) return { type: 'answer', title: 'Routine', lines: ['Routine slots can only move within their day. Edit the weekly template in Settings for permanent changes.'] };
      setTemplateSlot(dr, o.date, o.id, { start: timeOf(s), end: timeOf(e) });
    } else if (o.source === 'exam') {
      const ex = st.exams.find(x => x.id === o.id)!;
      dr.put('exams', { ...ex, start: fromT(s), end: fromT(e) });
    }
    return proposal(st, dr, `Move ${o.title} to ${shortDate(dateOf(s))} ${range(s, e)}.`, now, { warnings, conflicts });
  }
  if (tg.kind === 'task') {
    const t = tg.task;
    for (const ev of st.events.filter(e => e.taskId === t.id && e.status === 'planned' && toT(e.start) >= now)) dr.del('events', ev.id);
    const res = placeTask(dr, t, unplannedMinutes(dr.state, t, now), { from: Math.max(now, w0), preferWithin: [w0, w1] });
    if (res.unplaced) warnings.push(`${dur(res.unplaced)} of ${t.title} couldn't be placed.`);
    return proposal(st, dr, `Move ${t.title} to ${where}.`, now, { warnings });
  }
  return { type: 'answer', title: 'Exam', lines: ['To change an exam time, say the exact new time, e.g. “move Maths exam to Oct 26 at 10 am”.'] };
}

function cancel(st: State, c: Extract<Command, { kind: 'cancel' }>, now: T): PlanResult {
  const tg = resolveTarget(st, c.target, now, c, { date: c.date, includeRoutine: true });
  if (isResult(tg)) return tg;
  const dr = new Draft(st);
  let understood = '';
  if (tg.kind === 'occ') {
    const o = tg.occ;
    if (o.source === 'series') {
      if (c.scope === 'series') { dr.del('series', o.id); understood = `Delete the whole “${o.title}” series.`; }
      else { setSeriesException(dr, o.id, o.date, { deleted: true }); understood = `Cancel ${o.title} on ${shortDate(o.date)} only.`; }
    } else if (o.source === 'template') {
      setTemplateSlot(dr, o.date, o.id, { deleted: true });
      understood = `Skip ${o.title} on ${shortDate(o.date)}.`;
    } else if (o.source === 'event') {
      if (tg.task && c.scope === 'series') {
        for (const ev of st.events.filter(e => e.taskId === tg.task!.id && e.status === 'planned')) dr.del('events', ev.id);
        dr.put('tasks', { ...tg.task, status: 'dropped' });
        understood = `Drop the task “${tg.task.title}” and all its sessions.`;
      } else {
        dr.del('events', o.id);
        understood = `Cancel ${o.title} on ${shortDate(o.date)} ${range(o.s, o.e)}.`;
        if (tg.task) return proposal(st, dr, understood, now, { warnings: [`${tg.task.title} still needs ${dur(unplannedMinutes(dr.state, tg.task, now))}. It shows as unscheduled until you replan.`] });
      }
    } else if (o.source === 'exam') {
      dr.del('exams', o.id);
      understood = `Delete the exam ${o.title}.`;
    }
  } else if (tg.kind === 'task') {
    dr.put('tasks', { ...tg.task, status: 'dropped' });
    understood = `Drop the task “${tg.task.title}”.`;
  } else {
    dr.del('exams', tg.exam.id);
    understood = `Delete the exam ${tg.exam.title}.`;
  }
  return proposal(st, dr, understood, now);
}

function setPriority(st: State, c: Extract<Command, { kind: 'setPriority' }>, now: T): PlanResult {
  const tg = resolveTarget(st, c.target, now, c, {});
  if (isResult(tg)) {
    if (tg.type === 'question') return { ...tg, question: `I couldn't find “${c.target}”. Add it first, e.g. “${c.target} on Friday 10 to 11 am”.` };
    return tg;
  }
  const dr = new Draft(st);
  const p: Priority = c.priority;
  const applyTask = (t: Task) => {
    dr.put('tasks', { ...t, priority: p });
    for (const ev of dr.state.events.filter(e => e.taskId === t.id)) dr.put('events', { ...ev, priority: p });
  };
  let title = '';
  if (tg.kind === 'task') { applyTask(tg.task); title = tg.task.title; }
  else if (tg.kind === 'exam') return { type: 'answer', title: 'Already critical', lines: [`Exams are always critical.`] };
  else if (tg.task) { applyTask(tg.task); title = tg.task.title; }
  else if (tg.occ.source === 'series') { const s = st.series.find(x => x.id === tg.occ.id)!; dr.put('series', { ...s, priority: p }); title = s.title; }
  else if (tg.occ.source === 'event') { const ev = st.events.find(x => x.id === tg.occ.id)!; dr.put('events', { ...ev, priority: p }); title = ev.title; }
  else return { type: 'answer', title: 'Routine', lines: ['Routine slots have no priority. Edit them in Settings.'] };
  return proposal(st, dr, `Make “${title}” ${p}.`, now);
}

function shiftAll(st: State, c: Extract<Command, { kind: 'shiftAll' }>, now: T): PlanResult {
  const date = c.date ?? dateOf(now);
  const dr = new Draft(st);
  const occs = timeline(st, date, date).filter(o => o.date === date && o.e > now && o.status === 'planned' && !o.hint &&
    (isMovableChunk(o) || o.source === 'series' || (o.source === 'event' && o.kind === 'fixed' && o.priority !== 'critical')));
  if (!occs.length) return { type: 'answer', title: 'Nothing to push', lines: ['Nothing movable is left today.'] };
  const shift = c.minutes;
  const keys = new Set(occs.map(o => o.key));
  // move series & fixed first (they stay put relative to each other)
  const reflow: { task: Task; minutes: number }[] = [];
  for (const o of occs) {
    const s = o.s + shift, e = o.e + shift;
    if (o.source === 'series') setSeriesException(dr, o.id, o.date, { start: timeOf(s), end: timeOf(e) });
    else {
      const ev = st.events.find(x => x.id === o.id)!;
      dr.put('events', { ...ev, start: fromT(s), end: fromT(e) });
    }
  }
  const warnings: string[] = [];
  // any shifted chunk that now collides with something unshifted, or runs past bedtime, gets re-placed
  const after = timeline(dr.state, date, addDays(date, 1));
  for (const o of occs) {
    const nk = o.key;
    const cur = after.find(x => x.key === nk);
    if (!cur) continue;
    const clash = after.some(x => x.busy && !keys.has(x.key) && x.key !== nk && x.s < cur.e && x.e > cur.s);
    const late = cur.e > bedT(dr.state, date);
    if (!clash && !late) continue;
    if (isMovableChunk(o)) {
      dr.del('events', o.id);
      const t = taskOf(st, o.taskId);
      if (t) reflow.push({ task: t, minutes: o.e - o.s });
    } else warnings.push(`${o.title} now ${clash ? 'overlaps another item' : 'runs past bedtime'} (${range(cur.s, cur.e)}).`);
  }
  for (const r of reflow) {
    const res = placeTask(dr, r.task, r.minutes, { from: now });
    if (res.unplaced) warnings.push(`${dur(res.unplaced)} of ${r.task.title} has no room before it's due.`);
  }
  return proposal(st, dr, `Push the rest of ${date === dateOf(now) ? 'today' : shortDate(date)} by ${dur(Math.abs(shift))}${shift < 0 ? ' earlier' : ''}.`, now, { warnings });
}

function panic(st: State, now: T): PlanResult {
  const today = dateOf(now);
  const dr = new Draft(st);
  const occs = timeline(st, today, today).filter(o => o.date === today && o.s >= now - 5 && o.status === 'planned' && !o.hint);
  const later: { task: Task; minutes: number }[] = [];
  for (const o of occs) {
    if (o.priority === 'critical') continue;
    if (isMovableChunk(o)) {
      const t = taskOf(st, o.taskId);
      if (t?.priority === 'critical') continue;
      dr.del('events', o.id);
      if (t) later.push({ task: t, minutes: o.e - o.s });
    } else if (o.source === 'series') setSeriesException(dr, o.id, o.date, { deleted: true });
    else if (o.source === 'template' && o.role === 'club') setTemplateSlot(dr, o.date, o.id, { deleted: true });
  }
  // pull critical unplanned work into today
  const warnings: string[] = [];
  const crit = st.tasks.filter(t => t.status === 'open' && t.priority === 'critical').sort((a, b) => compareRank(rank(st, a), rank(st, b)));
  for (const t of crit) {
    const need = unplannedMinutes(dr.state, t, now);
    if (need > 0) placeTask(dr, t, need, { from: now, until: bedT(dr.state, today) });
  }
  const tomorrow = wakeT(st, addDays(today, 1));
  for (const l of later) {
    const res = placeTask(dr, l.task, l.minutes, { from: tomorrow });
    if (res.unplaced) warnings.push(`${dur(res.unplaced)} of ${l.task.title} has no room before it's due.`);
  }
  const kept = timeline(dr.state, today, today).filter(o => o.s >= now && o.priority === 'critical');
  return proposal(st, dr, `Panic mode: keep only critical items for the rest of today (${kept.length ? kept.map(k => k.title).join(', ') : 'none left'}). Everything else moves to tomorrow or later.`, now, { warnings: dedupe(warnings) });
}

export function studyDoneMinutes(st: State, subject: string, from?: string, to?: string): number {
  const s = subject.toLowerCase();
  let m = 0;
  for (const ev of st.events) {
    if (ev.status !== 'done' || ev.subject?.toLowerCase() !== s) continue;
    if (from && ev.start < from) continue;
    if (to && ev.start >= to) continue;
    m += ev.actualMin ?? toT(ev.end) - toT(ev.start);
  }
  for (const se of st.series) {
    if (se.subject?.toLowerCase() !== s) continue;
    for (const [d, ex] of Object.entries(se.exceptions)) {
      if (ex.status !== 'done' || ex.deleted) continue;
      if (from && d < from.slice(0, 10)) continue;
      if (to && d >= to.slice(0, 10)) continue;
      m += ex.actualMin ?? (hm(ex.end ?? se.endTime) - hm(ex.start ?? se.startTime) + DAY) % DAY;
    }
  }
  return m;
}

export function studyPlannedMinutes(st: State, subject: string, from: T, to: T): number {
  const s = subject.toLowerCase();
  return timeline(st, dateOf(from), dateOf(to))
    .filter(o => o.subject?.toLowerCase() === s && o.type !== 'exam' && o.status === 'planned' && o.s >= from && o.e <= to && (o.source === 'series' || o.kind === 'chunk'))
    .reduce((a, o) => a + o.e - o.s, 0);
}

function planStudy(st: State, c: Extract<Command, { kind: 'planStudy' }>, now: T): PlanResult {
  const exams = st.exams.filter(e => toT(e.start) > now && (!c.subject || e.subject.toLowerCase() === c.subject.toLowerCase()))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  if (!exams.length) return { type: 'answer', title: 'No upcoming exams', lines: [c.subject ? `No upcoming ${c.subject} exam.` : 'No upcoming exams.'] };
  const dr = new Draft(st);
  const warnings: string[] = [];
  const lines: string[] = [];
  for (const ex of exams) {
    if (!ex.targetHours) continue;
    const done = studyDoneMinutes(dr.state, ex.subject);
    const planned = studyPlannedMinutes(dr.state, ex.subject, now, toT(ex.start));
    const need = Math.round(ex.targetHours * 60 - done - planned);
    if (need <= 0) { lines.push(`${ex.subject}: already planned`); continue; }
    let task = dr.state.tasks.find(t => t.status === 'open' && t.type === 'examprep' && t.subject === ex.subject);
    if (task) task = { ...task, estimateMin: task.doneMin + plannedMinutes(dr.state, task.id, now) + need };
    else task = {
      id: uid('t'), title: `${ex.subject} study`, subject: ex.subject, type: 'examprep', priority: 'high',
      estimateMin: need, doneMin: 0, deadline: ex.start, splittable: true, preferredTime: 'any',
      effort: inferEffort(st, ex.subject, 'examprep', ex.subject), status: 'open', createdAt: fromT(now),
    };
    dr.put('tasks', task);
    const res = placeTask(dr, task, need, { from: now, until: toT(ex.start) - 30 });
    lines.push(`${ex.subject}: +${dur(need - res.unplaced)} planned`);
    if (res.unplaced) warnings.push(`${ex.subject}: only ${dur(need - res.unplaced)} of ${dur(need)} fits before the exam. Free up time or lower the target.`);
  }
  return proposal(st, dr, `Plan study hours toward exam targets. ${lines.join('; ')}`, now, { warnings });
}

function capture(st: State, c: Extract<Command, { kind: 'capture' }>, now: T): PlanResult {
  const dr = new Draft(st);
  dr.put('inbox', { id: uid('i'), text: c.text, createdAt: fromT(now) });
  return proposal(st, dr, `Save to Inbox: “${c.text}”.`, now);
}

/** Missed planned chunks before `now`: mark missed and reschedule their time. */
export function rollForward(st: State, nowS: string): Proposal | null {
  const now = toT(nowS);
  const missed = st.events.filter(e => e.kind === 'chunk' && e.status === 'planned' && toT(e.end) <= now);
  if (!missed.length) return null;
  const dr = new Draft(st);
  const warnings: string[] = [];
  const conflicts: Conflict[] = [];
  const per = new Map<string, number>();
  for (const ev of missed) {
    dr.put('events', { ...ev, status: 'missed' });
    if (ev.taskId) per.set(ev.taskId, (per.get(ev.taskId) ?? 0) + toT(ev.end) - toT(ev.start));
  }
  const tasks = [...per.keys()].map(id => taskOf(st, id)!).filter(t => t && t.status === 'open').sort((a, b) => compareRank(rank(st, a), rank(st, b)));
  for (const t of tasks) {
    const need = Math.min(per.get(t.id)!, unplannedMinutes(dr.state, t, now));
    if (need <= 0) continue;
    const res = placeTask(dr, t, need, { from: now });
    warnings.push(...urgentWarnings(res.placed, t));
    if (res.unplaced) conflicts.push(buildConflict(dr, { occ: { key: 'roll:' + t.id, source: 'event', id: t.id, date: dateOf(now), s: now, e: now, title: t.title, type: t.type, priority: t.priority, busy: false, status: 'planned' }, task: t, minutes: res.unplaced, reason: `${dur(res.unplaced)} of ${t.title} no longer fits before it's due.` }, { now, after: now }, dateRange(dateOf(now), t.deadline ? t.deadline.slice(0, 10) : addDays(dateOf(now), 1))));
  }
  return proposal(st, dr, `Roll forward ${missed.length} unfinished session${missed.length > 1 ? 's' : ''}.`, now, { warnings: dedupe(warnings), conflicts });
}

/** Ops to apply for a proposal with the user's chosen conflict options. */
export function opsWithChoices(p: Proposal, choices: Record<string, ConflictOption['key']>): Op2[] {
  const extra = p.conflicts.flatMap(c => c.options.find(o => o.key === choices[c.id])?.ops ?? []);
  return [...p.ops, ...extra];
}
type Op2 = Proposal['ops'][number];

/** Interpret nothing; turn a structured command into a proposal, answer, or question. */
export function plan(st: State, cmd: Command, nowS: string): PlanResult {
  const now = toT(nowS);
  switch (cmd.kind) {
    case 'addTask': return addTask(st, cmd, now);
    case 'addEvent': return addEvent(st, cmd, now);
    case 'blockTime': return addEvent(st, cmd, now);
    case 'addSeries': return addSeries(st, cmd, now);
    case 'markDone': return markDone(st, cmd, now);
    case 'markNotDone': return markNotDone(st, cmd, now);
    case 'logTime': return logTime(st, cmd, now);
    case 'move': return move(st, cmd, now);
    case 'cancel': return cancel(st, cmd, now);
    case 'setPriority': return setPriority(st, cmd, now);
    case 'shiftAll': return shiftAll(st, cmd, now);
    case 'panic': return panic(st, now);
    case 'planStudy': return planStudy(st, cmd, now);
    case 'capture': return capture(st, cmd, now);
    case 'query': return answerQuery(st, cmd, now);
    case 'editTask': return editTask(st, cmd, now);
    case 'editEvent': return editEvent(st, cmd, now);
    case 'editSeries': return editSeries(st, cmd, now);
    case 'applyTemplate': return applyTemplate(st, cmd, now);
    case 'clarify': return { type: 'question', question: cmd.question };
    case 'resolve': return { type: 'answer', title: 'Nothing to resolve', lines: ['There is no open conflict to answer.'] };
  }
}


/**
 * Night wrap-up: mark the checked items done, then roll forward everything from today
 * that started and wasn't done.
 */
export function wrapUp(st: State, nowS: string, doneKeys: string[]): Proposal {
  const now = toT(nowS);
  const dr = new Draft(st);
  for (const key of doneKeys) {
    const tg = findByRef(dr.state, key);
    if (!tg || tg.kind !== 'occ' || tg.occ.status === 'done') continue;
    const o = tg.occ;
    if (o.source === 'event') {
      const ev = dr.state.events.find(e => e.id === o.id)!;
      dr.put('events', { ...ev, status: 'done' });
      const t = taskOf(dr.state, ev.taskId);
      if (t) {
        const next = { ...t, doneMin: t.doneMin + (o.e - o.s) };
        dr.put('tasks', next);
        if (remainingMinutes(next) <= 0) finishTask(dr, next, now);
      }
    } else if (o.source === 'series') setSeriesException(dr, o.id, o.date, { status: 'done' });
  }
  // unchecked series occurrences that already started today -> missed
  const today = dateOf(now);
  for (const o of timeline(dr.state, today, today)) {
    if (o.source === 'series' && o.date === today && o.status === 'planned' && o.s < now && !doneKeys.includes(o.key)) setSeriesException(dr, o.id, o.date, { status: 'missed' });
  }
  // treat unchecked chunks that started as finished-without-doing
  const started = dr.state.events.filter(e => e.kind === 'chunk' && e.status === 'planned' && toT(e.start) < now && toT(e.end) > now);
  for (const e of started) dr.put('events', { ...e, end: fromT(Math.max(toT(e.start) + 5, now)) });
  const roll = rollForward(dr.state, nowS);
  const ops = [...dr.result(), ...(roll?.ops ?? [])];
  const after = applyOps(st, ops);
  const [a, b] = diffWindow(st, after, today);
  const n = doneKeys.length;
  return {
    type: 'proposal',
    understood: `Wrap up today: ${n} done${roll ? `, ${roll.understood.replace('Roll forward ', '').replace(/\.$/, '')} rescheduled` : ''}.`,
    ops, diff: diffStates(st, after, a, b), warnings: roll?.warnings ?? [], conflicts: roll?.conflicts ?? [],
  };
}
