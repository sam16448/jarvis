import { useState } from 'react';
import { taskRisk } from '../engine/metrics';
import { plannedMinutes, remainingMinutes } from '../engine/place';
import { findByRef } from '../engine/plan';
import { clock, dur, fmtHM, minOfDay, range, shortDate, toT } from '../engine/time';
import { TYPE_LABEL } from '../engine/types';
import { nowStr, propose, useApp } from '../store/store';
import { Pill, Sheet } from './common';

export function ItemSheet({ refKey, onClose }: { refKey: string; onClose: () => void }) {
  const { st } = useApp();
  const tg = findByRef(st!, refKey);
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!tg) return <Sheet onClose={onClose} label="Item"><p className="muted">This item no longer exists.</p></Sheet>;

  const occ = tg.kind === 'occ' ? tg.occ : undefined;
  const task = tg.kind === 'task' ? tg.task : tg.kind === 'occ' ? tg.task : undefined;
  const exam = tg.kind === 'exam' ? tg.exam : undefined;
  const title = occ?.title ?? task?.title ?? exam?.title ?? '';
  const now = toT(nowStr());
  const act = (cmd: Parameters<typeof propose>[0]) => { onClose(); propose(cmd, undefined, 'ui'); };
  const isSeries = occ?.source === 'series';
  const isTemplate = occ?.source === 'template';
  const canDone = occ && (occ.source === 'event' || isSeries) && occ.kind !== 'block';

  return (
    <Sheet onClose={onClose} label={title}>
      <div className="stack" style={{ gap: 4 }}>
        <h2>{title}</h2>
        <p className="muted small num">
          {occ ? `${shortDate(occ.date)}, ${range(occ.s, occ.e)}` : ''}
          {occ && `, ${TYPE_LABEL[occ.type]}`}{isSeries ? ', repeats' : ''}{occ?.status && occ.status !== 'planned' ? `, ${occ.status}` : ''}
        </p>
        {task && (
          <p className="small row wrap">
            <span className="muted">{task.deadline ? `Due ${shortDate(task.deadline.slice(0, 10))} ${clock(task.deadline)}.` : 'No deadline.'} {dur(remainingMinutes(task))} left, {dur(plannedMinutes(st!, task.id, now))} planned.</span>
            <Pill risk={taskRisk(st!, task, now)} />
          </p>
        )}
        {(occ?.priority === 'critical' || task?.priority === 'critical') && <p className="small" style={{ color: 'var(--bad)' }}>Critical</p>}
      </div>

      {moving && occ ? <MoveForm occ={{ date: occ.date, s: occ.s, e: occ.e }} onCancel={() => setMoving(false)} onMove={(start, end) => act({ kind: 'move', target: title, ref: refKey, start, end })} />
        : editing ? <EditForm refKey={refKey} onDone={onClose} onCancel={() => setEditing(false)} />
        : (
          <div className="stack">
            {canDone && occ!.status !== 'done' && <button className="btn primary big" onClick={() => act({ kind: 'markDone', target: title, ref: refKey })}>Mark done</button>}
            {task && !occ && task.status === 'open' && <button className="btn primary big" onClick={() => act({ kind: 'markDone', target: title, ref: refKey, all: true })}>Mark finished</button>}
            {task && occ && <button className="btn" onClick={() => act({ kind: 'markDone', target: title, ref: refKey, all: true })}>Finish whole task</button>}
            {canDone && occ!.status === 'planned' && occ!.s < now && <button className="btn" onClick={() => act({ kind: 'markNotDone', target: title, ref: refKey })}>Didn't finish, roll forward</button>}
            {occ && occ.source !== 'exam' && <button className="btn" onClick={() => setMoving(true)}>Move or change time</button>}
            {task && !occ && <button className="btn" onClick={() => act({ kind: 'move', target: title, ref: refKey })}>Reschedule</button>}
            {!isTemplate && !exam && (
              occ?.priority === 'critical' || task?.priority === 'critical'
                ? <button className="btn" onClick={() => act({ kind: 'setPriority', target: title, ref: refKey, priority: task?.type === 'club' || task?.type === 'personal' ? 'flexible' : 'normal' })}>Remove critical</button>
                : <button className="btn" onClick={() => act({ kind: 'setPriority', target: title, ref: refKey, priority: 'critical' })}>Make critical</button>
            )}
            {(task || occ?.source === 'event' || isSeries) && <button className="btn" onClick={() => setEditing(true)}>Edit details</button>}
            {isSeries ? (
              <div className="row">
                <button className="btn danger grow" onClick={() => act({ kind: 'cancel', target: title, ref: refKey, scope: 'one' })}>Delete this one</button>
                <button className="btn danger grow" onClick={() => act({ kind: 'cancel', target: title, ref: refKey, scope: 'series' })}>Delete series</button>
              </div>
            ) : (
              <button className="btn danger" onClick={() => act({ kind: 'cancel', target: title, ref: refKey, scope: task ? 'series' : 'one' })}>
                {isTemplate ? 'Skip today' : task ? 'Drop task' : exam || occ?.source === 'exam' ? 'Delete exam' : 'Delete'}
              </button>
            )}
          </div>
        )}
    </Sheet>
  );
}

function MoveForm({ occ, onMove, onCancel }: { occ: { date: string; s: number; e: number }; onMove: (s: string, e: string) => void; onCancel: () => void }) {
  const [date, setDate] = useState(occ.date);
  const [s, setS] = useState(fmtHM(minOfDay(occ.s)));
  const [e, setE] = useState(fmtHM(minOfDay(occ.e)));
  return (
    <form className="stack" onSubmit={ev => { ev.preventDefault(); const st = `${date}T${s}`; let en = `${date}T${e}`; if (toT(en) <= toT(st)) en = `${date}T${fmtHM(minOfDay(toT(st)) + (occ.e - occ.s))}`; onMove(st, en); }}>
      <label className="field">Date<input type="date" name="date" value={date} onChange={x => setDate(x.target.value)} /></label>
      <div className="row">
        <label className="field grow">From<input type="time" name="start" value={s} onChange={x => setS(x.target.value)} /></label>
        <label className="field grow">To<input type="time" name="end" value={e} onChange={x => setE(x.target.value)} /></label>
      </div>
      <div className="row"><button type="button" className="btn ghost grow" onClick={onCancel}>Back</button><button className="btn primary grow">Review</button></div>
    </form>
  );
}

function EditForm({ refKey, onDone, onCancel }: { refKey: string; onDone: () => void; onCancel: () => void }) {
  const { st } = useApp();
  const tg = findByRef(st!, refKey)!;
  const task = tg.kind === 'task' ? tg.task : tg.kind === 'occ' ? tg.task : undefined;
  const series = tg.kind === 'occ' ? tg.series : undefined;
  const ev = tg.kind === 'occ' && tg.occ.source === 'event' && !task ? st!.events.find(x => x.id === tg.occ.id) : undefined;
  const [title, setTitle] = useState(task?.title ?? series?.title ?? ev?.title ?? '');
  const [due, setDue] = useState(task?.deadline ?? '');
  const [est, setEst] = useState(String(task?.estimateMin ?? ''));
  const [startT, setStartT] = useState(series?.startTime ?? '');
  const [endT, setEndT] = useState(series?.endTime ?? '');
  const [until, setUntil] = useState(series?.until ?? '');
  const submit = () => {
    onDone();
    if (task) propose({ kind: 'editTask', taskId: task.id, patch: { title, deadline: due || undefined, estimateMin: Number(est) || task.estimateMin } }, undefined, 'ui');
    else if (series) propose({ kind: 'editSeries', seriesId: series.id, patch: { title, startTime: startT, endTime: endT, until: until || undefined } }, undefined, 'ui');
    else if (ev) propose({ kind: 'editEvent', eventId: ev.id, patch: { title } }, undefined, 'ui');
  };
  return (
    <form className="stack" onSubmit={e => { e.preventDefault(); submit(); }}>
      <label className="field">Title<input name="title" value={title} onChange={e => setTitle(e.target.value)} autoComplete="off" /></label>
      {task && (
        <>
          <label className="field">Due<input type="datetime-local" name="due" value={due} onChange={e => setDue(e.target.value)} /></label>
          <label className="field">Total minutes<input type="number" inputMode="numeric" name="estimate" min={5} step={5} value={est} onChange={e => setEst(e.target.value)} /></label>
        </>
      )}
      {series && (
        <>
          <p className="small muted">These changes apply to the whole series.</p>
          <div className="row">
            <label className="field grow">From<input type="time" name="start" value={startT} onChange={e => setStartT(e.target.value)} /></label>
            <label className="field grow">To<input type="time" name="end" value={endT} onChange={e => setEndT(e.target.value)} /></label>
          </div>
          <label className="field">Until<input type="date" name="until" value={until} onChange={e => setUntil(e.target.value)} /></label>
        </>
      )}
      <div className="row"><button type="button" className="btn ghost grow" onClick={onCancel}>Back</button><button className="btn primary grow">Review</button></div>
    </form>
  );
}
