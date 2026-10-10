import { useState } from 'react';
import { estimateFor } from '../engine/place';
import { addDays, hm, fmtHM, WEEKDAYS } from '../engine/time';
import { TASK_TYPES, TYPE_LABEL, type Command, type ItemType, type Priority, type TaskType, type TimeOfDay } from '../engine/types';
import { getApp, propose, today } from '../store/store';
import type { AddPreset } from './bus';
import { Sheet } from './common';

type Mode = 'task' | 'event' | 'series' | 'block';

export function AddSheet({ preset, onClose }: { preset?: Partial<AddPreset>; onClose: () => void }) {
  const st = getApp().st!;
  const c = preset?.cmd;
  const initMode: Mode = c?.kind === 'addTask' ? 'task' : c?.kind === 'addSeries' ? 'series' : c?.kind === 'blockTime' ? 'block' : c?.kind === 'addEvent' ? 'event' : preset?.mode ?? (preset?.start ? 'event' : 'task');
  const [mode, setMode] = useState<Mode>(initMode);
  const date0 = preset?.date ?? (c && 'start' in c && c.start ? c.start.slice(0, 10) : today());
  const [title, setTitle] = useState(c && 'title' in c ? c.title : '');
  const [type, setType] = useState<ItemType>(c && 'type' in c && c.type ? c.type : 'assignment');
  const [subject, setSubject] = useState(c && 'subject' in c && c.subject ? c.subject : '');
  const [date, setDate] = useState(date0);
  const [start, setStart] = useState(preset?.start ?? (c && 'start' in c && c.start ? c.start.slice(11) : c?.kind === 'addSeries' ? c.startTime : '19:00'));
  const [end, setEnd] = useState(preset?.end ?? (c && 'end' in c && c.end ? c.end.slice(11) : c?.kind === 'addSeries' ? c.endTime : '20:00'));
  const [due, setDue] = useState(c?.kind === 'addTask' && c.due ? c.due.slice(0, 10) : addDays(today(), 3));
  const [dueTime, setDueTime] = useState(c?.kind === 'addTask' && c.due ? c.due.slice(11) : '23:59');
  const [est, setEst] = useState(c?.kind === 'addTask' && c.estimateMin ? String(c.estimateMin) : '');
  const [critical, setCritical] = useState(c && 'priority' in c ? c.priority === 'critical' : false);
  const [pref, setPref] = useState<TimeOfDay>(c?.kind === 'addTask' && c.preferredTime ? c.preferredTime : 'any');
  const [freq, setFreq] = useState<'daily' | 'weekdays' | 'days' | 'weekly'>(c?.kind === 'addSeries' ? c.freq : 'daily');
  const [days, setDays] = useState<number[]>(c?.kind === 'addSeries' && c.days ? c.days : [1, 3, 5]);
  const [endKind, setEndKind] = useState<'until' | 'count' | 'none'>(c?.kind === 'addSeries' ? (c.count ? 'count' : c.until ? 'until' : 'none') : 'until');
  const [until, setUntil] = useState(c?.kind === 'addSeries' && c.until ? c.until : addDays(today(), 14));
  const [count, setCount] = useState(c?.kind === 'addSeries' && c.count ? String(c.count) : '10');
  const [err, setErr] = useState('');

  const taskType = (TASK_TYPES as string[]).includes(type) ? (type as TaskType) : 'assignment';
  const submit = () => {
    if (!title.trim()) { setErr('Add a title.'); return; }
    if (mode !== 'task' && hm(end) <= hm(start) && mode !== 'series') { setErr('End must be after start.'); return; }
    const pr: Priority | undefined = critical ? 'critical' : undefined;
    let cmd: Command;
    if (mode === 'task') cmd = { kind: 'addTask', title: title.trim(), type: taskType, subject: subject || undefined, due: `${due}T${dueTime}`, estimateMin: est ? Number(est) : undefined, priority: pr, preferredTime: pref };
    else if (mode === 'event') cmd = { kind: 'addEvent', title: title.trim(), type, subject: subject || undefined, start: `${date}T${start}`, end: `${date}T${end}`, priority: pr };
    else if (mode === 'block') cmd = { kind: 'blockTime', title: title.trim(), start: `${date}T${start}`, end: `${date}T${end}` };
    else cmd = { kind: 'addSeries', title: title.trim(), type, subject: subject || undefined, startTime: start, endTime: end, freq, days: freq === 'days' || freq === 'weekly' ? days : undefined, startDate: date, until: endKind === 'until' ? until : undefined, count: endKind === 'count' ? Number(count) : undefined };
    onClose();
    propose(cmd, undefined, 'ui');
  };

  const types: ItemType[] = mode === 'task' ? TASK_TYPES : ['event', ...TASK_TYPES, 'exam'];
  return (
    <Sheet onClose={onClose} label="Add">
      <h2>Add</h2>
      <div className="seg" role="group" aria-label="What to add">
        {([['task', 'Task'], ['event', 'Event'], ['series', 'Repeat'], ['block', 'Block']] as [Mode, string][]).map(([m, l]) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{l}</button>
        ))}
      </div>
      <form className="stack" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label className="field">Title
          <input name="title" value={title} onChange={e => { setTitle(e.target.value); setErr(''); }} autoComplete="off" placeholder={mode === 'block' ? 'Hackathon work…' : mode === 'task' ? 'History essay…' : 'Gym…'} />
        </label>
        {mode !== 'block' && (
          <div className="row">
            <label className="field grow">Type
              <select name="type" value={type} onChange={e => setType(e.target.value as ItemType)}>
                {types.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="field grow">Subject
              <select name="subject" value={subject} onChange={e => setSubject(e.target.value)}>
                <option value="">None</option>
                {st.settings.subjects.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </label>
          </div>
        )}
        {mode === 'task' ? (
          <>
            <div className="row">
              <label className="field grow">Due date<input type="date" name="due" value={due} onChange={e => setDue(e.target.value)} /></label>
              <label className="field grow">Time<input type="time" name="dueTime" value={dueTime} onChange={e => setDueTime(e.target.value)} /></label>
            </div>
            <div className="row">
              <label className="field grow">Minutes
                <input type="number" inputMode="numeric" name="estimate" min={5} step={5} value={est} onChange={e => setEst(e.target.value)} placeholder={`${estimateFor(st, taskType)} (estimate)`} />
              </label>
              <label className="field grow">Best time
                <select name="pref" value={pref} onChange={e => setPref(e.target.value as TimeOfDay)}>
                  <option value="any">Any</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <div className="row">
            <label className="field grow">{mode === 'series' ? 'Starts' : 'Date'}<input type="date" name="date" value={date} onChange={e => setDate(e.target.value)} /></label>
            <label className="field">From<input type="time" name="start" value={start} onChange={e => { setStart(e.target.value); if (hm(end) <= hm(e.target.value)) setEnd(fmtHM(hm(e.target.value) + 60)); }} /></label>
            <label className="field">To<input type="time" name="end" value={end} onChange={e => setEnd(e.target.value)} /></label>
          </div>
        )}
        {mode === 'series' && (
          <>
            <label className="field">Repeats
              <select name="freq" value={freq} onChange={e => setFreq(e.target.value as typeof freq)}>
                <option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="days">Specific days</option><option value="weekly">Weekly</option>
              </select>
            </label>
            {(freq === 'days' || freq === 'weekly') && (
              <div className="row wrap" role="group" aria-label="Days">
                {WEEKDAYS.map((w, i) => (
                  <button key={w} type="button" className="habit" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter(x => x !== i) : [...days, i].sort())}>{w}</button>
                ))}
              </div>
            )}
            <div className="row">
              <label className="field grow">Ends
                <select name="endKind" value={endKind} onChange={e => setEndKind(e.target.value as typeof endKind)}>
                  <option value="until">On date</option><option value="count">After N times</option><option value="none">Never</option>
                </select>
              </label>
              {endKind === 'until' && <label className="field grow">Until<input type="date" name="until" value={until} onChange={e => setUntil(e.target.value)} /></label>}
              {endKind === 'count' && <label className="field grow">Times<input type="number" inputMode="numeric" min={1} name="count" value={count} onChange={e => setCount(e.target.value)} /></label>}
            </div>
          </>
        )}
        {mode !== 'block' && (
          <label className="check"><input type="checkbox" name="critical" checked={critical} onChange={e => setCritical(e.target.checked)} />Critical (never moved without asking)</label>
        )}
        {err && <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
        <div className="row">
          <button type="button" className="btn ghost grow" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary grow big">Review</button>
        </div>
      </form>
    </Sheet>
  );
}
