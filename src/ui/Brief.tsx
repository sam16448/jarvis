import { CheckCircle, Circle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { dayLoad, examStats, freeToday, latestSafeBedtime, overload, sleepWeek, studyBySubject, taskRisk, topPriorities } from '../engine/metrics';
import { wrapUp } from '../engine/plan';
import { addDays, at, clock, dur, range, shortDate, toT, weekday } from '../engine/time';
import { bedT, hardBedT, normalSleepH, timeline } from '../engine/timeline';
import type { Occ, State } from '../engine/types';
import { putOp } from '../engine/state';
import { commitQuiet, nowStr, showResult, today, useApp } from '../store/store';
import { isRoutine, Pill, Sheet } from './common';

const agenda = (st: State, d: string) => timeline(st, d, d).filter(o => o.date === d && !o.hint && o.status !== 'skipped' && !isRoutine(o));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="stack" style={{ gap: 6 }}><h3>{title}</h3>{children}</section>;
}

export function BriefSheet({ onClose }: { onClose: () => void }) {
  const { st, now } = useApp();
  const s = st!;
  const d = today();
  const nowT = toT(now);
  const items = agenda(s, d);
  const top = topPriorities(s, nowT, 3);
  const due = s.tasks.filter(t => t.status === 'open' && t.deadline && toT(t.deadline) > nowT && toT(t.deadline) - nowT <= 48 * 60);
  const exams = examStats(s, nowT);
  const sleep = sleepWeek(s, nowT);
  const load = dayLoad(s, d);
  const ov = overload(s, nowT);
  const neededToday = exams.filter(e => e.daysLeft > 0 && e.targetMin > e.doneMin).slice(0, 4);
  const warning = load.workMin > s.settings.dailyWorkCapH * 60
    ? `Today has ${dur(load.workMin)} of planned work, more than your ${s.settings.dailyWorkCapH} h limit. Consider moving something.`
    : ov.week ? `This week needs ${dur(ov.week.demandMin)} of work but has ${dur(ov.week.supplyMin)} free. Cut or move: ${ov.week.cut.slice(0, 3).map(c => c.title).join(', ') || 'flexible items'}.`
    : freeToday(s, nowT) < 30 && nowT < bedT(s, d) - 120 ? 'Almost no free time left today.' : null;

  return (
    <Sheet onClose={onClose} label="Morning brief">
      <h2>Good morning. {shortDate(d)}</h2>
      {warning && <div className="banner warn" role="status"><p className="small">{warning}</p></div>}
      <Section title="Today at a glance">
        {items.length ? (
          <div className="list">
            {items.map(o => <div key={o.key} className="li compact small num"><span className="muted" style={{ width: 120, flex: 'none' }}>{range(o.s, o.e)}</span><span className="t grow">{o.title}</span></div>)}
          </div>
        ) : <p className="muted small">Nothing scheduled beyond your routine.</p>}
      </Section>
      <Section title="Top priorities">
        {top.length ? <ol style={{ margin: 0, paddingLeft: 20 }}>{top.map(t => <li key={t.id}>{t.title} <span className="muted small">{t.deadline ? `due ${shortDate(t.deadline.slice(0, 10))}` : ''}</span></li>)}</ol>
          : <p className="muted small">No open tasks.</p>}
      </Section>
      {due.length > 0 && (
        <Section title="Due within 48 hours">
          {due.map(t => <p key={t.id} className="row small"><span className="grow">{t.title}, {shortDate(t.deadline!.slice(0, 10))} {clock(t.deadline!)}</span><Pill risk={taskRisk(s, t, nowT)} /></p>)}
        </Section>
      )}
      <Section title="Exams">
        <div className="list">
          {exams.map(e => (
            <div key={e.exam.id} className="li compact small num">
              <span className="t grow">{e.exam.title}</span>
              <span className="muted">{e.daysLeft === 0 ? 'today' : `${e.daysLeft} d`}</span>
            </div>
          ))}
        </div>
      </Section>
      {neededToday.length > 0 && (
        <Section title="Study today to stay on track">
          <p className="small">{neededToday.map(e => `${e.exam.subject} ${dur(e.perDayNeededMin)}`).join(', ')}</p>
        </Section>
      )}
      <Section title="Sleep">
        <p className="small">Last night: <b className="num">{sleep.lastNightH?.toFixed(1)} h</b>{sleep.debtH > 0.25 ? <>, sleep debt this week <b className="num">{sleep.debtH.toFixed(1)} h</b></> : null}.</p>
        <SleepLog />
      </Section>
      <button className="btn primary big block" onClick={onClose}>Start the day</button>
    </Sheet>
  );
}

function SleepLog() {
  const { st } = useApp();
  const s = st!;
  const night = addDays(today(), -1);
  const log = s.sleep.find(x => x.id === night);
  const [bed, setBed] = useState(log?.bedtime.slice(11) ?? (s.days.find(x => x.id === night)?.bedtime ?? s.settings.bedtime));
  const [wake, setWake] = useState(log?.wake.slice(11) ?? s.settings.wake);
  const [saved, setSaved] = useState(!!log);
  const save = () => {
    const bedDate = bed < '12:00' ? today() : night;
    commitQuiet([putOp('sleep', { id: night, bedtime: `${bedDate}T${bed}`, wake: `${today()}T${wake}` })]);
    setSaved(true);
  };
  return (
    <form className="row" onSubmit={e => { e.preventDefault(); save(); }} aria-label="Log last night's sleep">
      <label className="field grow">Went to bed<input type="time" name="bed" value={bed} onChange={e => { setBed(e.target.value); setSaved(false); }} /></label>
      <label className="field grow">Woke up<input type="time" name="wake" value={wake} onChange={e => { setWake(e.target.value); setSaved(false); }} /></label>
      <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={saved}>{saved ? 'Saved' : 'Save'}</button>
    </form>
  );
}

export function WrapupSheet({ onClose }: { onClose: () => void }) {
  const { st, now } = useApp();
  const s = st!;
  const d = today();
  const nowT = toT(now);
  const items = useMemo(() => agenda(s, d).filter(o => o.source !== 'exam' && o.source !== 'template' && o.kind !== 'block' && o.s < nowT), [s, d, nowT]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(items.filter(o => o.status === 'done').map(o => o.key)));
  const toggle = (o: Occ) => { const n = new Set(checked); if (n.has(o.key)) n.delete(o.key); else n.add(o.key); setChecked(n); };
  const weekStart = addDays(d, -((weekday(d) + 6) % 7));
  const todayStudy = studyBySubject(s, d, addDays(d, 1));
  const weekStudy = studyBySubject(s, weekStart, addDays(d, 1));
  const tomorrow = agenda(s, addDays(d, 1)).slice(0, 6);
  const safe = Math.min(latestSafeBedtime(s, d), hardBedT(s, d));
  const planned = bedT(s, d);
  const lastToday = Math.max(...timeline(s, d, d).filter(o => o.date === d && !o.hint && !isRoutine(o) && o.status === 'planned').map(o => o.e), 0);
  const suggest = Math.max(nowT + 15, Math.min(planned, Math.max(lastToday + 15, at(d, '21:30'))));
  const finish = () => {
    const doneKeys = items.filter(o => checked.has(o.key) && o.status !== 'done').map(o => o.key);
    const p = wrapUp(s, nowStr(), doneKeys);
    onClose();
    showResult(p, 'Night wrap-up', undefined, 'ui');
  };
  const studyLine = (m: Record<string, number>) => Object.entries(m).length ? Object.entries(m).map(([k, v]) => `${k} ${dur(v)}`).join(', ') : 'none logged';

  return (
    <Sheet onClose={onClose} label="Night wrap-up">
      <h2>Night wrap-up</h2>
      <Section title="What got done?">
        {items.length ? (
          <div className="list">
            {items.map(o => (
              <label key={o.key} className="li" style={{ cursor: 'pointer' }}>
                <input type="checkbox" className="sr-only" checked={checked.has(o.key)} onChange={() => toggle(o)} />
                {checked.has(o.key) ? <CheckCircle size={26} weight="fill" color="var(--ok)" aria-hidden="true" /> : <Circle size={26} color="var(--faint)" aria-hidden="true" />}
                <span className="grow" style={{ minWidth: 0 }}><span className="t" style={{ display: 'block' }}>{o.title}</span><span className="s num">{range(o.s, o.e)}</span></span>
              </label>
            ))}
          </div>
        ) : <p className="muted small">Nothing to check off today.</p>}
        <p className="tiny muted">Anything left unticked gets rescheduled automatically.</p>
      </Section>
      <Section title="Study hours">
        <p className="small">Today: {studyLine(todayStudy)}</p>
        <p className="small">This week: {studyLine(weekStudy)}</p>
      </Section>
      <Section title="Tomorrow">
        {tomorrow.length ? tomorrow.map(o => <p key={o.key} className="small num"><span className="muted">{clock(o.s)}</span> {o.title}</p>) : <p className="muted small">Only your routine.</p>}
      </Section>
      <Section title="Bedtime">
        <p className="small">Aim for <b>{clock(suggest)}</b> ({((at(addDays(d, 1), s.settings.wake) - suggest) / 60).toFixed(1)} h sleep). Latest that still protects {s.settings.minSleepH} h: {clock(safe)}. Normal sleep is {normalSleepH(s).toFixed(1)} h.</p>
      </Section>
      <button className="btn primary big block" onClick={finish}>Finish and reschedule</button>
    </Sheet>
  );
}
