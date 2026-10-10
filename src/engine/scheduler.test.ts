import { describe, expect, it } from 'vitest';
import { diffStates } from './diff';
import { findTarget } from './match';
import { examStats, overload, sleepWeek, taskRisk } from './metrics';
import { estimateFor, placeTask, rank } from './place';
import { opsWithChoices, plan, rollForward } from './plan';
import { applyOps, Draft, inverseOps } from './state';
import { at, dateOf, endAt, fromT, hm, nightAt, toT, weekday } from './time';
import { bedT, freeIntervals, hardBedT, seriesOccursOn, timeline } from './timeline';
import { apply, asProposal, base, chunk, chunksOf, invariantViolations, task } from './testutil';
import type { State } from './types';

const MON = '2026-10-12';
const TUE = '2026-10-13';
const WED = '2026-10-14';
const THU = '2026-10-15';
const SAT = '2026-10-17';

describe('time', () => {
  it('round-trips floating times', () => {
    expect(fromT(toT('2026-10-12T19:45'))).toBe('2026-10-12T19:45');
    expect(weekday('2026-10-11')).toBe(0);
    expect(weekday(MON)).toBe(1);
  });
  it('handles night times and wrapping ends', () => {
    expect(nightAt(MON, '00:30') - at(MON, '00:00')).toBe(24 * 60 + 30);
    expect(nightAt(MON, '23:15')).toBe(at(MON, '23:15'));
    expect(endAt(MON, '22:15', '01:00') - at(MON, '22:15')).toBe(165);
  });
});

describe('timeline & free time', () => {
  it('expands the weekly template: college busy, study slot is a hint', () => {
    const st = base();
    const t = timeline(st, MON, MON).filter(o => o.date === MON);
    const college = t.find(o => o.title === 'College')!;
    expect(college.busy).toBe(true);
    expect(college.s).toBe(at(MON, '09:00'));
    const hint = t.find(o => o.title === 'Morning study')!;
    expect(hint.busy).toBe(false);
    expect(hint.hint).toBe('study');
    expect(t.find(o => o.title === 'College' && o.date === SAT)).toBeUndefined();
  });

  it('free intervals stay inside wake..bedtime and keep a buffer around busy items', () => {
    const st = base();
    const free = freeIntervals(st, at(MON, '00:00'), at(TUE, '00:00'));
    for (const [s, e] of free) {
      expect(s).toBeGreaterThanOrEqual(at(MON, '06:30'));
      expect(e).toBeLessThanOrEqual(at(MON, '23:15'));
    }
    // club ends 18:30 -> free from 18:40 (10 min buffer) until dinner 20:00 - 10
    expect(free).toContainEqual([at(MON, '18:40'), at(MON, '19:50')]);
  });

  it('hard bedtime is the earlier of latest bedtime and wake minus minimum sleep', () => {
    const st = base();
    expect(hardBedT(st, MON)).toBe(nightAt(MON, '00:00'));
    st.settings = { ...st.settings, minSleepH: 7 };
    expect(hardBedT(st, MON)).toBe(nightAt(MON, '23:30'));
  });

  it('expands series: daily until, weekdays, specific days, count', () => {
    const s = { id: 's', title: 'C practice', type: 'study' as const, startTime: '22:15', endTime: '23:00', freq: 'daily' as const, startDate: MON, until: '2026-10-23', priority: 'normal' as const, exceptions: {} };
    expect(seriesOccursOn(s, '2026-10-23')).toBe(true);
    expect(seriesOccursOn(s, '2026-10-24')).toBe(false);
    expect(seriesOccursOn({ ...s, freq: 'weekdays' }, SAT)).toBe(false);
    expect(seriesOccursOn({ ...s, freq: 'days', days: [2, 4] }, TUE)).toBe(true);
    expect(seriesOccursOn({ ...s, freq: 'days', days: [2, 4] }, WED)).toBe(false);
    expect(seriesOccursOn({ ...s, until: undefined, count: 3 }, WED)).toBe(true);
    expect(seriesOccursOn({ ...s, until: undefined, count: 3 }, THU)).toBe(false);
  });
});

describe('add task with deadline', () => {
  const now = `${MON}T07:00`;

  it('places before the deadline with a one-day buffer, in chunks of at most 90 minutes', () => {
    const st = base();
    const p = asProposal(plan(st, { kind: 'addTask', title: 'History essay', subject: 'History', type: 'assignment', due: `${THU}T23:59` }, now));
    expect(p.conflicts).toHaveLength(0);
    const after = applyOps(st, p.ops);
    const t = after.tasks[0];
    expect(t.estimateMin).toBe(120);
    const cs = chunksOf(after, t.id);
    expect(cs.reduce((a, c) => a + toT(c.end) - toT(c.start), 0)).toBe(120);
    for (const c of cs) {
      expect(toT(c.end) - toT(c.start)).toBeLessThanOrEqual(90);
      expect(toT(c.end)).toBeLessThanOrEqual(toT(`${WED}T23:59`)); // one-day buffer
    }
    expect(invariantViolations(after, MON, THU)).toEqual([]);
    expect(p.diff.some(d => d.change === 'add' && d.title === 'History essay')).toBe(true);
  });

  it('prefers the evening assignment slot for assignments', () => {
    const st = base();
    const after = apply(st, plan(st, { kind: 'addTask', title: 'History essay', type: 'assignment', due: `${THU}T23:59`, estimateMin: 60 }, now));
    const c = chunksOf(after, after.tasks[0].id)[0];
    expect(c.start.slice(11)).toBe('21:00');
  });

  it('puts hard work in focus hours and light work in low-energy slots', () => {
    const st = base();
    const after = apply(st, plan(st, { kind: 'addTask', title: 'Maths numericals', subject: 'Maths', type: 'study', due: `${THU}T23:59`, estimateMin: 60 }, now));
    const c = chunksOf(after, after.tasks[0].id)[0];
    const m = hm(c.start.slice(11));
    const inFocus = st.settings.focusHours.some(r => m >= hm(r.start) && m + 60 <= hm(r.end));
    expect(inFocus).toBe(true);
    const after2 = apply(st, plan(st, { kind: 'addTask', title: 'Physics lab write-up', type: 'lab', due: `${THU}T23:59`, estimateMin: 60 }, now));
    const c2 = chunksOf(after2, after2.tasks[0].id)[0];
    const m2 = hm(c2.start.slice(11));
    expect(st.settings.lowEnergy.some(r => m2 >= hm(r.start) && m2 + 60 <= hm(r.end))).toBe(true);
  });

  it('asks when no due date is given', () => {
    const r = plan(base(), { kind: 'addTask', title: 'History essay', type: 'assignment' }, now);
    expect(r.type).toBe('question');
  });

  it('learns durations from past tasks of the same type', () => {
    const st = base();
    expect(estimateFor(st, 'assignment')).toBe(120);
    st.tasks = [1, 2, 3].map(i => task({ title: `A${i}`, status: 'done', actualMin: 180, estimateMin: 120 }));
    const est = estimateFor(st, 'assignment');
    expect(est).toBeGreaterThan(120);
    expect(est).toBeLessThanOrEqual(180);
  });

  it('raises a conflict when the work cannot fit before the deadline', () => {
    const st = base();
    const p = asProposal(plan(st, { kind: 'addTask', title: 'Huge report', type: 'assignment', due: `${MON}T23:00`, estimateMin: 600 }, now));
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].options.length).toBeGreaterThan(0);
  });

  it('never places anything past bedtime or overlapping busy time across many tasks', () => {
    let st: State = base();
    const types = ['assignment', 'lab', 'study', 'examprep', 'course', 'personal'] as const;
    for (let i = 0; i < 14; i++) {
      const r = plan(st, { kind: 'addTask', title: `Task ${i}`, type: types[i % types.length], due: `2026-10-${16 + (i % 5)}T20:00`, estimateMin: 45 + (i * 37) % 150 }, now);
      st = applyOps(st, asProposal(r).ops);
    }
    expect(invariantViolations(st, MON, '2026-10-22')).toEqual([]);
  });
});

describe('fixed events and recurring series', () => {
  const now = `${MON}T07:00`;

  it('adds a fixed event and moves a displaced flexible chunk', () => {
    const st = base();
    const t = task({ title: 'Physics problems', subject: 'Physics', deadline: `${'2026-10-16'}T20:00` });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T19:00`, `${MON}T20:00`)];
    const p = asProposal(plan(st, { kind: 'addEvent', title: 'Gym', type: 'personal', start: `${MON}T19:00`, end: `${MON}T20:00` }, now));
    const after = applyOps(st, p.ops);
    expect(chunksOf(after, t.id)).toHaveLength(1);
    expect(chunksOf(after, t.id)[0].start).not.toBe(`${MON}T19:00`);
    expect(invariantViolations(after, MON, '2026-10-16')).toEqual([]);
    expect(p.diff.some(d => d.change === 'move' && d.title === 'Physics problems')).toBe(true);
  });

  it('trims overlapped routine for a fixed event (meeting over club)', () => {
    const st = base();
    const after = apply(st, plan(st, { kind: 'addEvent', title: 'Robotics meeting', type: 'club', start: '2026-10-16T17:00', end: '2026-10-16T20:00' }, now));
    const club = timeline(after, '2026-10-16', '2026-10-16').find(o => o.title === 'Club' && o.date === '2026-10-16');
    expect(club?.e).toBe(at('2026-10-16', '17:00'));
  });

  it('adds a daily series with an end date and counts occurrences', () => {
    const st = base();
    const p = asProposal(plan(st, { kind: 'addSeries', title: 'C practice', subject: 'Programming', startTime: '22:15', endTime: '23:00', freq: 'daily', until: '2026-10-23' }, now));
    expect(p.understood).toContain('12 sessions');
    const after = applyOps(st, p.ops);
    const occ = timeline(after, MON, '2026-10-25').filter(o => o.title === 'C practice');
    expect(occ).toHaveLength(12);
    expect(p.diff[0]).toMatchObject({ change: 'add', title: 'C practice' });
  });

  it('adds a weekday morning series', () => {
    const st = base();
    const after = apply(st, plan(st, { kind: 'addSeries', title: 'Maths', subject: 'Maths', startTime: '06:45', endTime: '07:45', freq: 'weekdays', until: '2026-10-30' }, now));
    const occ = timeline(after, MON, '2026-11-01').filter(o => o.title === 'Maths');
    expect(occ).toHaveLength(15);
    expect(occ.every(o => weekday(o.date) >= 1 && weekday(o.date) <= 5)).toBe(true);
  });

  it('edits one occurrence or deletes the whole series', () => {
    let st = base();
    st = apply(st, plan(st, { kind: 'addSeries', title: 'C practice', startTime: '22:15', endTime: '23:00', freq: 'daily', until: '2026-10-23' }, now));
    const one = apply(st, plan(st, { kind: 'cancel', target: 'C practice', date: TUE }, now));
    expect(timeline(one, TUE, TUE).some(o => o.title === 'C practice' && o.date === TUE)).toBe(false);
    expect(timeline(one, WED, WED).some(o => o.title === 'C practice' && o.date === WED)).toBe(true);
    const all = apply(st, plan(st, { kind: 'cancel', target: 'C practice', scope: 'series' }, now));
    expect(all.series).toHaveLength(0);
    const moved = apply(st, plan(st, { kind: 'move', target: 'C practice', start: `${MON}T21:30` }, now));
    const o = timeline(moved, MON, MON).find(x => x.title === 'C practice' && x.date === MON)!;
    expect(o.s).toBe(at(MON, '21:30'));
    expect(o.e - o.s).toBe(45);
  });
});

describe('block time and replanning', () => {
  it('clears time, trims routine, and moves displaced work later', () => {
    const st = base();
    const t = task({ title: 'Chemistry notes', subject: 'Chemistry', deadline: '2026-10-16T20:00', type: 'study' });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T07:00`, `${MON}T07:40`)];
    const now = `${MON}T07:00`;
    const p = asProposal(plan(st, { kind: 'blockTime', title: 'Hackathon work', start: now, end: `${MON}T10:00` }, now));
    expect(p.conflicts).toHaveLength(0);
    const after = applyOps(st, p.ops);
    const cs = chunksOf(after, t.id);
    expect(cs).toHaveLength(1);
    expect(toT(cs[0].start)).toBeGreaterThanOrEqual(at(MON, '10:00'));
    const day = timeline(after, MON, MON).filter(o => o.date === MON);
    expect(day.find(o => o.title === 'College')!.s).toBe(at(MON, '10:00'));
    expect(day.some(o => o.title === 'Breakfast')).toBe(false);
    expect(invariantViolations(after, MON, '2026-10-16')).toEqual([]);
    // minimal change: unrelated items untouched
    expect(p.diff.filter(d => d.title === 'Dinner')).toHaveLength(0);
  });

  it('moves a displaced series occurrence later the same day', () => {
    let st = base();
    const now = `${MON}T06:30`;
    st = apply(st, plan(st, { kind: 'addSeries', title: 'Maths', subject: 'Maths', startTime: '06:45', endTime: '07:45', freq: 'weekdays', until: '2026-10-25' }, now));
    const after = apply(st, plan(st, { kind: 'blockTime', title: 'Hackathon work', start: now, end: `${MON}T10:00` }, now));
    const o = timeline(after, MON, MON).find(x => x.title === 'Maths' && x.date === MON)!;
    expect(o.s).toBeGreaterThanOrEqual(at(MON, '10:00'));
    expect(o.e - o.s).toBe(60);
  });

  it('does not silently move a critical item: offers options a-d', () => {
    const st = base();
    const t = task({ title: 'Optics quiz prep', subject: 'Physics', priority: 'critical', deadline: `${MON}T23:59`, type: 'study' });
    const low = task({ title: 'Club poster', type: 'club', priority: 'flexible', deadline: '2026-10-16T20:00' });
    st.tasks = [t, low];
    st.events = [chunk(t, `${MON}T19:00`, `${MON}T20:00`), chunk(low, `${MON}T21:00`, `${MON}T22:00`)];
    const now = `${MON}T18:00`;
    const p = asProposal(plan(st, { kind: 'blockTime', title: 'Hackathon work', start: now, end: `${MON}T20:00` }, now));
    expect(p.conflicts).toHaveLength(1);
    const c = p.conflicts[0];
    expect(c.title).toBe('Optics quiz prep');
    const keys = c.options.map(o => o.key);
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(keys).toContain('c');
    // base ops alone ("leave it for now") keep the critical item where it was
    expect(chunksOf(applyOps(st, p.ops), t.id).map(e => e.start)).toEqual([`${MON}T19:00`]);
    // choose (a): later today
    const a = applyOps(st, opsWithChoices(p, { [c.id]: 'a' }));
    expect(chunksOf(a, t.id)).toHaveLength(1);
    expect(toT(chunksOf(a, t.id)[0].start)).toBeGreaterThanOrEqual(at(MON, '20:00'));
    // choose (b): shorten block, item keeps 19:00
    const b = applyOps(st, opsWithChoices(p, { [c.id]: 'b' }));
    expect(chunksOf(b, t.id)[0].start).toBe(`${MON}T19:00`);
    const blk = b.events.find(e => e.kind === 'block')!;
    expect(toT(blk.end)).toBeLessThanOrEqual(at(MON, '18:50'));
    // choose (c): swap with the club poster slot
    const cc = applyOps(st, opsWithChoices(p, { [c.id]: 'c' }));
    expect(chunksOf(cc, t.id)[0].start).toBe(`${MON}T21:00`);
    expect(chunksOf(cc, low.id)[0].start).not.toBe(`${MON}T21:00`);
  });

  it('option (a) pushes bedtime and reports sleep when the evening is full', () => {
    const st = base();
    const t = task({ title: 'Lab record', priority: 'critical', deadline: `${TUE}T09:00`, estimateMin: 90 });
    st.tasks = [t];
    st.events = [
      chunk(t, `${MON}T18:40`, `${MON}T19:50`),
      { id: 'f1', title: 'Family dinner', type: 'personal', start: `${MON}T20:30`, end: `${MON}T23:00`, kind: 'fixed', priority: 'normal', status: 'planned' },
    ];
    const now = `${MON}T18:30`;
    const p = asProposal(plan(st, { kind: 'blockTime', title: 'Hackathon work', start: now, end: `${MON}T20:00` }, now));
    const c = p.conflicts[0];
    const a = c.options.find(o => o.key === 'a')!;
    expect(a.label).toMatch(/push bedtime/);
    expect(a.detail).toMatch(/h sleep/);
    const after = applyOps(st, opsWithChoices(p, { [c.id]: 'a' }));
    expect(bedT(after, MON)).toBeGreaterThan(at(MON, '23:15'));
    const placed = chunksOf(after, t.id)[0];
    expect(toT(placed.start)).toBeGreaterThanOrEqual(at(MON, '23:00'));
    expect(a.warnings.join(' ')).toMatch(/minimum sleep/);
  });

  it('option (d) drops a flexible item (club) to make room', () => {
    const st = base();
    // fill Monday evening completely so only the club slot could help
    st.events = [{ id: 'f', title: 'Family', type: 'personal', start: `${MON}T18:30`, end: `${MON}T23:15`, kind: 'fixed', priority: 'normal', status: 'planned' }];
    const p = asProposal(plan(st, { kind: 'addTask', title: 'Urgent sheet', type: 'assignment', due: `${MON}T19:00`, estimateMin: 60, priority: 'critical' }, `${MON}T16:00`));
    expect(p.conflicts).toHaveLength(1);
    const d = p.conflicts[0].options.find(o => o.key === 'd');
    expect(d?.label).toBe('Drop Club');
    const after = applyOps(st, opsWithChoices(p, { [p.conflicts[0].id]: 'd' }));
    expect(timeline(after, MON, MON).some(o => o.title === 'Club' && o.date === MON)).toBe(false);
    expect(chunksOf(after, after.tasks[0].id)).toHaveLength(1);
  });

  it('push everything by 30 minutes', () => {
    const st = base();
    const t = task({ title: 'Maths practice', subject: 'Maths', deadline: '2026-10-16T20:00' });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T21:00`, `${MON}T22:00`)];
    const after = apply(st, plan(st, { kind: 'shiftAll', minutes: 30 }, `${MON}T20:40`));
    expect(chunksOf(after, t.id)[0].start).toBe(`${MON}T21:30`);
  });

  it('panic button keeps only critical items today', () => {
    const st = base();
    const crit = task({ title: 'Viva prep', priority: 'critical', deadline: `${TUE}T09:00` });
    const norm = task({ title: 'Essay', deadline: '2026-10-16T20:00' });
    st.tasks = [crit, norm];
    st.events = [chunk(crit, `${MON}T19:00`, `${MON}T20:00`), chunk(norm, `${MON}T21:00`, `${MON}T22:00`)];
    const after = apply(st, plan(st, { kind: 'panic' }, `${MON}T16:00`));
    expect(chunksOf(after, crit.id)[0].start).toBe(`${MON}T19:00`);
    expect(dateOf(toT(chunksOf(after, norm.id)[0].start)) > MON).toBe(true);
    expect(timeline(after, MON, MON).some(o => o.title === 'Club' && o.date === MON)).toBe(false);
  });
});

describe('exams and edits', () => {
  it('adding an event of type exam creates an exam record', () => {
    const st = base();
    const after = apply(st, plan(st, { kind: 'addEvent', title: 'Physics viva', type: 'exam', subject: 'Physics', start: '2026-10-20T10:00', end: '2026-10-20T11:00' }, `${MON}T07:00`));
    expect(after.exams.find(e => e.title === 'Physics viva')).toMatchObject({ subject: 'Physics', targetHours: 0 });
    expect(after.events).toHaveLength(0);
  });
  it('editing a task deadline replans its future chunks', () => {
    const st = base();
    const t = task({ title: 'Essay', deadline: '2026-10-20T20:00', estimateMin: 60 });
    st.tasks = [t];
    st.events = [chunk(t, '2026-10-19T19:00', '2026-10-19T20:00')];
    const after = apply(st, plan(st, { kind: 'editTask', taskId: t.id, patch: { deadline: `${TUE}T09:00` } }, `${MON}T07:00`));
    const cs = chunksOf(after, t.id);
    expect(cs).toHaveLength(1);
    expect(cs[0].end <= `${TUE}T09:00`).toBe(true);
  });
  it('editing a series changes every future occurrence', () => {
    let st = base();
    st = apply(st, plan(st, { kind: 'addSeries', title: 'C practice', startTime: '22:15', endTime: '23:00', freq: 'daily', until: '2026-10-23' }, `${MON}T07:00`));
    const after = apply(st, plan(st, { kind: 'editSeries', seriesId: st.series[0].id, patch: { startTime: '21:30', endTime: '22:15' } }, `${MON}T07:00`));
    expect(timeline(after, WED, WED).find(o => o.title === 'C practice')!.s).toBe(at(WED, '21:30'));
  });
});

describe('progress', () => {
  it('marks the current session done and finishes the task when nothing is left', () => {
    const st = base();
    const t = task({ title: 'Chem problems', subject: 'Chemistry', estimateMin: 60, deadline: '2026-10-16T20:00' });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T19:00`, `${MON}T20:00`)];
    const after = apply(st, plan(st, { kind: 'markDone', target: 'chem' }, `${MON}T20:05`));
    expect(after.tasks[0].status).toBe('done');
    expect(after.events[0].status).toBe('done');
  });

  it("didn't finish: marks missed and rolls the time forward", () => {
    const st = base();
    const t = task({ title: 'Maths practice', subject: 'Maths', estimateMin: 60, deadline: '2026-10-16T20:00', type: 'study' });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T19:00`, `${MON}T20:00`)];
    const after = apply(st, plan(st, { kind: 'markNotDone', target: 'maths' }, `${MON}T20:05`));
    expect(after.events.find(e => e.start === `${MON}T19:00`)!.status).toBe('missed');
    const next = chunksOf(after, t.id);
    expect(next).toHaveLength(1);
    expect(toT(next[0].start)).toBeGreaterThan(at(MON, '20:05'));
  });

  it('warns when rolled-forward work becomes urgent', () => {
    const st = base();
    const t = task({ title: 'Lab record', estimateMin: 60, deadline: `${TUE}T09:00`, type: 'lab' });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T19:00`, `${MON}T20:00`)];
    const p = asProposal(plan(st, { kind: 'markNotDone', target: 'lab record' }, `${MON}T20:05`));
    expect(p.warnings.join(' ')).toMatch(/tight/);
  });

  it('records actual time and learns from it', () => {
    let st = base();
    const t = task({ title: 'History essay', estimateMin: 120, deadline: '2026-10-16T20:00' });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T21:00`, `${MON}T23:00`)];
    st = apply(st, plan(st, { kind: 'markDone', target: 'History' }, `${MON}T23:00`));
    st = apply(st, plan(st, { kind: 'logTime', minutes: 150 }, `${MON}T23:01`));
    expect(st.tasks[0].actualMin).toBe(150);
    expect(estimateFor(st, 'assignment')).toBeGreaterThan(120);
  });

  it('rolls forward missed sessions from earlier days', () => {
    const st = base();
    const t = task({ title: 'Essay', estimateMin: 60, deadline: '2026-10-16T20:00' });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T21:00`, `${MON}T22:00`)];
    const p = rollForward(st, `${TUE}T07:00`)!;
    const after = applyOps(st, p.ops);
    expect(after.events.find(e => e.start === `${MON}T21:00`)!.status).toBe('missed');
    expect(chunksOf(after, t.id)[0].start >= `${TUE}T07:00`).toBe(true);
    expect(rollForward(after, `${TUE}T07:00`)).toBeNull();
  });
});

describe('edits', () => {
  it('moves Physics to tomorrow morning', () => {
    const st = base();
    const t = task({ title: 'Physics revision', subject: 'Physics', estimateMin: 60, deadline: '2026-10-20T20:00', type: 'study' });
    st.tasks = [t];
    st.events = [chunk(t, '2026-10-16T19:00', '2026-10-16T20:00')];
    const after = apply(st, plan(st, { kind: 'move', target: 'Physics', date: SAT, timeOfDay: 'morning' }, '2026-10-16T18:00'));
    const c = chunksOf(after, t.id)[0];
    expect(c.start.slice(0, 10)).toBe(SAT);
    expect(hm(c.end.slice(11))).toBeLessThanOrEqual(12 * 60);
  });

  it('makes an item critical (and it then ranks first)', () => {
    const st = base();
    const t = task({ title: 'Optics quiz', subject: 'Physics', deadline: '2026-10-16T10:00' });
    st.tasks = [t];
    const after = apply(st, plan(st, { kind: 'setPriority', target: 'Optics quiz', priority: 'critical' }, `${MON}T07:00`));
    expect(after.tasks[0].priority).toBe('critical');
    expect(rank(after, after.tasks[0])[0]).toBe(0);
  });

  it('cancels gym today only', () => {
    let st = base();
    st = apply(st, plan(st, { kind: 'addSeries', title: 'Gym', type: 'personal', startTime: '18:40', endTime: '19:40', freq: 'weekdays' }, `${MON}T07:00`));
    const after = apply(st, plan(st, { kind: 'cancel', target: 'gym', date: MON }, `${MON}T07:00`));
    expect(timeline(after, MON, TUE).filter(o => o.title === 'Gym').map(o => o.date)).toEqual([TUE]);
  });

  it('asks when the target is unknown or ambiguous', () => {
    const st = base();
    expect(plan(st, { kind: 'markDone', target: 'quantum' }, `${MON}T07:00`).type).toBe('question');
    st.tasks = [task({ title: 'Maths sheet 1', deadline: '2026-10-16T20:00' }), task({ title: 'Maths sheet 2', deadline: '2026-10-16T20:00' })];
    const m = findTarget(st, 'maths sheet', toT(`${MON}T07:00`));
    expect(m.ambiguous?.length).toBe(2);
  });
});

describe('undo, diff and metrics', () => {
  it('inverse ops restore the previous state exactly', () => {
    const st = base();
    const p = asProposal(plan(st, { kind: 'blockTime', title: 'Hackathon', start: `${MON}T07:00`, end: `${MON}T10:00` }, `${MON}T07:00`));
    const after = applyOps(st, p.ops);
    const undone = applyOps(after, inverseOps(st, p.ops));
    expect(undone.days).toEqual(st.days);
    expect(undone.events).toEqual(st.events);
  });

  it('diff shows before/after for moved items', () => {
    const st = base();
    const t = task({ title: 'Essay' });
    st.tasks = [t];
    st.events = [chunk(t, `${MON}T19:00`, `${MON}T20:00`)];
    const after = { ...st, events: [{ ...st.events[0], id: 'x', start: `${MON}T21:00`, end: `${MON}T22:00` }] };
    const d = diffStates(st, after, MON, MON);
    expect(d).toEqual([{ change: 'move', title: 'Essay', before: 'Mon 12 Oct 7:00-8:00 pm', after: 'Mon 12 Oct 9:00-10:00 pm' }]);
  });

  it('exam stats track target, done and planned study hours', () => {
    let st = base();
    const now = `${MON}T07:00`;
    st = apply(st, plan(st, { kind: 'planStudy', subject: 'Maths' }, now));
    const s = examStats(st, toT(now)).find(x => x.exam.subject === 'Maths')!;
    expect(s.plannedMin).toBe(20 * 60);
    expect(s.status).toBe('on track');
    expect(invariantViolations(st, MON, '2026-10-28')).toEqual([]);
    const chunks = st.events.filter(e => e.subject === 'Maths');
    expect(chunks.every(e => e.end <= '2026-10-28T09:30')).toBe(true);
  });

  it('task risk: on track, tight, at risk', () => {
    const st = base();
    const now = toT(`${MON}T07:00`);
    const ok = task({ title: 'A', deadline: '2026-10-16T20:00' });
    const tight = task({ title: 'B', deadline: `${MON}T23:00` });
    const bad = task({ title: 'C', deadline: `${MON}T08:00`, estimateMin: 300 });
    st.tasks = [ok, tight, bad];
    st.events = [chunk(ok, `${MON}T19:00`, `${MON}T20:00`), chunk(tight, `${MON}T21:00`, `${MON}T22:00`)];
    expect(taskRisk(st, ok, now)).toBe('on track');
    expect(taskRisk(st, tight, now)).toBe('tight');
    expect(taskRisk(st, bad, now)).toBe('at risk');
  });

  it('sleep debt counts short nights', () => {
    const st = base();
    st.days = [{ id: '2026-10-11', bedtime: '01:00', slots: {} }];
    const s = sleepWeek(st, toT(`${MON}T07:00`));
    expect(s.lastNightH).toBeCloseTo(5.5);
    expect(s.debtH).toBeCloseTo(1.75);
  });

  it('detects week overload and proposes cuts', () => {
    const st = base();
    st.tasks = [task({ title: 'Mega project', deadline: '2026-10-16T20:00', estimateMin: 60 * 60 })];
    const o = overload(st, toT(`${MON}T07:00`));
    expect(o.week).toBeDefined();
    expect(o.week!.cut.some(c => c.title === 'Club')).toBe(true);
  });

  it('placement is deterministic', () => {
    const run = () => {
      const d = new Draft(base());
      const t = task({ title: 'X', deadline: '2026-10-16T20:00', estimateMin: 200, splittable: true });
      d.put('tasks', t);
      return placeTask(d, t, 200, { from: toT(`${MON}T07:00`) }).placed.map(p => p.start + p.end);
    };
    expect(run()).toEqual(run());
  });
});

describe('queries', () => {
  it('answers free time, next and due this week', () => {
    const st = base();
    st.tasks = [task({ title: 'History essay', deadline: `${THU}T23:59` })];
    const free = plan(st, { kind: 'query', q: 'free', date: TUE }, `${MON}T07:00`);
    expect(free.type).toBe('answer');
    const next = plan(st, { kind: 'query', q: 'next' }, `${MON}T09:30`);
    expect(next.type === 'answer' && next.lines[0]).toMatch(/Now: College/);
    const due = plan(st, { kind: 'query', q: 'dueWeek' }, `${MON}T07:00`);
    expect(due.type === 'answer' && due.lines.join('\n')).toMatch(/History essay/);
    const left = plan(st, { kind: 'query', q: 'studyLeft', subject: 'maths' }, `${MON}T07:00`);
    expect(left.type === 'answer' && left.lines[0]).toMatch(/Maths: 20h left/);
  });
});
