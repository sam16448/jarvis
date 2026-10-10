import { describe, expect, it } from 'vitest';
import { seedState } from '../engine/seed';
import { mergeAnswerRules, parseRules } from './rules';

const st = seedState();
const MON7 = '2026-10-12T07:00'; // Monday morning
const p = (s: string, now = MON7) => parseRules(s, st, now)!.cmd;

describe('rule parser: add task', () => {
  it('History essay due Thursday', () => {
    expect(p('I need to do my History essay, due Thursday.')).toMatchObject({ kind: 'addTask', title: 'History essay', type: 'assignment', due: '2026-10-15T23:59', subject: 'History' });
  });
  it('lab write-up with time and duration', () => {
    expect(p('Physics lab write-up due Wednesday 9 am, takes 90 min')).toMatchObject({ kind: 'addTask', type: 'lab', due: '2026-10-14T09:00', estimateMin: 90, subject: 'Physics' });
  });
  it('critical graded work', () => {
    expect(p('Submit chem tutorial by Friday 5 pm, it is graded')).toMatchObject({ kind: 'addTask', priority: 'critical', due: '2026-10-16T17:00', subject: 'Chemistry' });
  });
  it('date formats', () => {
    expect(p('Maths sheet due 20 Oct')).toMatchObject({ due: '2026-10-20T23:59' });
    expect(p('Maths sheet due Oct 20')).toMatchObject({ due: '2026-10-20T23:59' });
    expect(p('Maths sheet due 20/10')).toMatchObject({ due: '2026-10-20T23:59' });
    expect(p('Chem assignment due tomorrow')).toMatchObject({ due: '2026-10-13T23:59', subject: 'Chemistry' });
    expect(p('Chem assignment due next Monday')).toMatchObject({ due: '2026-10-19T23:59' });
  });
  it('task without date asks via engine (no due set)', () => {
    const c = p('I need to do my History essay');
    expect(c).toMatchObject({ kind: 'addTask', title: 'History essay' });
    expect((c as { due?: string }).due).toBeUndefined();
  });
});

describe('rule parser: events', () => {
  it('gym at 7 pm today', () => {
    expect(p('Add gym at 7 pm today.')).toMatchObject({ kind: 'addEvent', title: 'Gym', type: 'personal', start: '2026-10-12T19:00', end: '2026-10-12T20:00' });
  });
  it('Robotics meeting Friday 5 to 8 (pm inferred)', () => {
    expect(p('Robotics meeting Friday 5 to 8')).toMatchObject({ kind: 'addEvent', title: 'Robotics meeting', type: 'club', start: '2026-10-16T17:00', end: '2026-10-16T20:00' });
  });
  it('11 to 1 pm spans noon', () => {
    expect(p('Workshop tomorrow 11 to 1 pm')).toMatchObject({ start: '2026-10-13T11:00', end: '2026-10-13T13:00' });
  });
  it('“I am” is not a.m.; ordinal dates; skip club is a cancel', () => {
    expect(p('I am busy from 4 to 6 today')).toMatchObject({ kind: 'blockTime', start: '2026-10-12T16:00', end: '2026-10-12T18:00' });
    expect(p('C test on 22nd 2 to 4 pm')).toMatchObject({ kind: 'addEvent', title: 'C test', start: '2026-10-22T14:00', end: '2026-10-22T16:00', priority: 'critical' });
    expect(p('skip club today')).toMatchObject({ kind: 'cancel', target: 'Club', date: '2026-10-12' });
  });
  it('morning context keeps am', () => {
    expect(p('Doctor tomorrow morning at 8')).toMatchObject({ start: '2026-10-13T08:00' });
  });
});

describe('rule parser: recurring', () => {
  it('C practice every day 10:15 to 11 pm till Oct 23', () => {
    expect(p('Add coding practice every day 10:15 to 11 pm till Oct 23.')).toMatchObject({ kind: 'addSeries', title: 'Coding practice', freq: 'daily', startTime: '22:15', endTime: '23:00', until: '2026-10-23', subject: 'Programming' });
  });
  it('Maths every weekday 6:45 to 7:45 am until Oct 30', () => {
    expect(p('Maths every weekday 6:45 to 7:45 am until Oct 30.')).toMatchObject({ kind: 'addSeries', title: 'Maths', freq: 'weekdays', startTime: '06:45', endTime: '07:45', until: '2026-10-30', subject: 'Maths' });
  });
  it('specific days and count', () => {
    expect(p('Gym every Monday and Thursday at 6 pm for 8 times')).toMatchObject({ kind: 'addSeries', freq: 'days', days: [1, 4], startTime: '18:00', endTime: '19:00', count: 8 });
  });
  it('weekly', () => {
    expect(p('Club meeting weekly on Saturday 4 to 6 pm')).toMatchObject({ kind: 'addSeries', freq: 'weekly', days: [6], startTime: '16:00', endTime: '18:00' });
  });
});

describe('rule parser: block time & conflicts', () => {
  it('Clear my time till 10 today, I have hackathon work', () => {
    expect(p('Clear my time till 10 today, I have hackathon work.')).toMatchObject({ kind: 'blockTime', title: 'Hackathon work', start: '2026-10-12T07:00', end: '2026-10-12T10:00' });
  });
  it('block from 2 to 5', () => {
    expect(p('Block 2 to 5 tomorrow for hackathon')).toMatchObject({ kind: 'blockTime', title: 'Hackathon', start: '2026-10-13T14:00', end: '2026-10-13T17:00' });
  });
  it('conflict follow-up picks option a', () => {
    expect(p('okay add it today after I come home and push my sleep')).toEqual({ kind: 'resolve', option: 'a' });
    expect(p('option c')).toEqual({ kind: 'resolve', option: 'c' });
    expect(p('shorten the block')).toEqual({ kind: 'resolve', option: 'b' });
  });
});

describe('rule parser: progress', () => {
  it('done / not done / took', () => {
    expect(p('Done with chem.')).toMatchObject({ kind: 'markDone', target: 'Chem' });
    expect(p('Finished maths')).toMatchObject({ kind: 'markDone', target: 'Maths' });
    expect(p("Didn't finish Maths.")).toMatchObject({ kind: 'markNotDone', target: 'Maths' });
    expect(p('That took 2 hours.')).toMatchObject({ kind: 'logTime', minutes: 120 });
    expect(p('took me 1 hour 30 minutes')).toMatchObject({ kind: 'logTime', minutes: 90 });
  });
});

describe('rule parser: questions', () => {
  it.each([
    ["What's today?", 'today'], ["What's next?", 'next'], ["What's due this week?", 'dueWeek'],
    ['How many study hours left before Maths?', 'studyLeft'], ['Am I on track?', 'onTrack'], ['When am I free tomorrow?', 'free'],
  ])('%s', (s, q) => {
    expect(p(s)).toMatchObject({ kind: 'query', q });
  });
  it('subject and date are extracted', () => {
    expect(p('How many study hours left before Maths?')).toMatchObject({ subject: 'Maths' });
    expect(p('When am I free tomorrow?')).toMatchObject({ date: '2026-10-13' });
  });
});

describe('rule parser: edits', () => {
  it('Move Physics to tomorrow morning', () => {
    expect(p('Move Physics to tomorrow morning.')).toMatchObject({ kind: 'move', target: 'Physics', date: '2026-10-13', timeOfDay: 'morning' });
  });
  it('Cancel gym today', () => {
    expect(p('Cancel gym today.')).toMatchObject({ kind: 'cancel', target: 'Gym', date: '2026-10-12', scope: 'one' });
    expect(p('Delete all C practice sessions')).toMatchObject({ kind: 'cancel', target: 'C practice', scope: 'series' });
  });
  it('Make the optics quiz critical', () => {
    expect(p('Make the optics quiz critical.')).toMatchObject({ kind: 'setPriority', target: 'Optics quiz', priority: 'critical' });
  });
  it('Push everything by 30 minutes', () => {
    expect(p('Push everything by 30 minutes.')).toEqual({ kind: 'shiftAll', minutes: 30 });
    expect(p("I'm running 20 min late")).toEqual({ kind: 'shiftAll', minutes: 20 });
  });
  it('panic and plan study', () => {
    expect(p('panic')).toEqual({ kind: 'panic' });
    expect(p('plan study for maths')).toEqual({ kind: 'planStudy', subject: 'Maths' });
  });
});

describe('fallbacks', () => {
  it('captures timeless notes to the inbox with low confidence', () => {
    const r = parseRules('buy a new calculator', st, MON7)!;
    expect(r.cmd).toMatchObject({ kind: 'capture', text: 'buy a new calculator' });
    expect(r.confidence).toBe('low');
  });
  it('merges answers into partial commands', () => {
    const merged = mergeAnswerRules({ kind: 'addTask', title: 'History essay', type: 'assignment' }, 'Thursday 5 pm', st, MON7);
    expect(merged).toMatchObject({ due: '2026-10-15T17:00' });
  });
});
