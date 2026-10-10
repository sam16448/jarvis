import { Microphone, Stop } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { ConflictOption, DiffLine } from '../engine/types';
import { applyPending, dismiss, toast, useApp } from '../store/store';
import { Sheet } from './common';
import { requestEdit, answerQuestion, isNo, isYes, replyToCard, useBus } from './bus';
import { listenOnce, micAvailable } from '../voice/listen';
import { address, say, stopSpeaking } from '../voice';
import { cancelLine, doneLine } from '../voice/persona';

const SYM: Record<DiffLine['change'], string> = { add: '+', remove: '-', move: '→', update: '•' };

export function DiffList({ diff }: { diff: DiffLine[] }) {
  if (!diff.length) return <p className="muted small">No schedule changes.</p>;
  return (
    <div className="diff" aria-label="Changes">
      {diff.slice(0, 30).map((d, i) => (
        <div key={i} className={`d ${d.change}`}>
          <span className="sym" aria-hidden="true">{SYM[d.change]}</span>
          <span>
            <b>{d.title}</b>
            {d.before && d.after ? <> <span className="was">{d.before}</span> {d.after}</>
              : d.after ? <> {d.after}</> : d.before ? <> <span className="was">{d.before}</span></> : null}
          </span>
        </div>
      ))}
      {diff.length > 30 && <p className="muted tiny">…and {diff.length - 30} more</p>}
    </div>
  );
}

export function ConfirmSheet() {
  const { pending } = useApp();
  const [choices, setChoices] = useState<Record<string, ConflictOption['key'] | 'keep'>>({});
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [reply, setReply] = useState('');
  useEffect(() => { setChoices(pending?.choices ?? {}); setReply(''); }, [pending]);

  // voice answers: tap the mic, or Jarvis opens it after asking (auto-listen)
  const { listenSeq } = useBus();
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const finalRef = useRef<(t: string) => void>(() => {});
  const textRef = useRef<(t: string) => void>(() => {});
  const listen = (auto: boolean) => {
    if (listening) { stopRef.current?.(); return; }
    stopSpeaking();
    setListening(true);
    stopRef.current = listenOnce({
      onText: t => textRef.current(t),
      onDone: t => { setListening(false); if (t) finalRef.current(t); else if (!auto) toast('Didn’t catch that. Tap the mic and try again.'); },
      onError: code => {
        setListening(false);
        if (!auto && code !== 'aborted') toast(code === 'no-speech' ? 'Didn’t hear anything. Tap the mic and speak right away.' : `Mic unavailable (${code}). Type your answer or use the keyboard mic.`);
      },
    });
  };
  useEffect(() => { if (listenSeq && pending) listen(true); }, [listenSeq]); // eslint-disable-line
  useEffect(() => () => { stopRef.current?.(); }, [pending]);
  const mic = micAvailable() ? (
    <button type="button" className={`mic${listening ? ' on' : ''}`} style={{ width: 44, height: 44 }} aria-label={listening ? 'Stop listening' : 'Answer by voice'} aria-pressed={listening} onClick={() => listen(false)}>
      {listening ? <Stop size={20} weight="fill" aria-hidden="true" /> : <Microphone size={22} aria-hidden="true" />}
    </button>
  ) : null;

  if (!pending) return null;
  const r = pending.result;
  const close = () => { setChoices({}); setAnswer(''); stopSpeaking(); dismiss(); };

  if (r.type === 'answer') {
    return (
      <Sheet onClose={close} label={r.title}>
        {pending.text && <p className="said">“{pending.text}”</p>}
        <h2>{r.title}</h2>
        <div className="list">
          {r.lines.map((l, i) => <div key={i} className="li small num">{l}</div>)}
        </div>
        <button className="btn big block" onClick={close}>Close</button>
      </Sheet>
    );
  }

  if (r.type === 'question') {
    const submit = () => { if (answer.trim()) { answerQuestion(pending, answer.trim()); setAnswer(''); } };
    textRef.current = setAnswer;
    finalRef.current = t => { setAnswer(''); void answerQuestion(pending, t); };
    return (
      <Sheet onClose={close} label="Question">
        {pending.text && <p className="said">“{pending.text}”</p>}
        <h2>{r.question}</h2>
        <form className="stack" onSubmit={e => { e.preventDefault(); submit(); }}>
          <div className="row">
            <label className="field grow">
              <span className="sr-only">Your answer</span>
              <input name="answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder={listening ? 'Listening…' : 'e.g. Thursday 5 pm…'} autoComplete="off" enterKeyHint="send" />
            </label>
            {mic}
          </div>
          <div className="row">
            <button type="button" className="btn ghost grow" onClick={close}>Cancel</button>
            <button type="submit" className="btn primary grow" disabled={!answer.trim()}>Answer</button>
          </div>
        </form>
      </Sheet>
    );
  }

  const unresolved = r.conflicts.filter(c => !choices[c.id]);
  const extraDiff = r.conflicts.flatMap(c => c.options.find(o => o.key === choices[c.id])?.diff ?? []);
  const extraWarn = r.conflicts.flatMap(c => c.options.find(o => o.key === choices[c.id])?.warnings ?? []);
  const apply = async () => {
    setBusy(true);
    const real = Object.fromEntries(Object.entries(choices).filter(([, v]) => v !== 'keep')) as Record<string, ConflictOption['key']>;
    await applyPending(real);
    setBusy(false);
    setChoices({});
    void say(doneLine(address()));
  };
  const onReply = (t: string) => {
    if (isYes(t)) {
      if (unresolved.length) void say(`Which option for ${unresolved[0].title}, ${address()}? Say a, b, c or d.`);
      else void apply();
    } else if (isNo(t)) { close(); void say(cancelLine()); }
    else void replyToCard(t);
  };
  textRef.current = setReply;
  finalRef.current = t => { setReply(''); onReply(t); };

  return (
    <Sheet onClose={close} label="Confirm change">
      {pending.text && <p className="said">“{pending.text}”{pending.via === 'ai' ? ' (AI)' : ''}</p>}
      <h2>{r.understood}</h2>
      {r.info?.map((x, i) => <p key={i} className="muted small">{x}</p>)}

      {r.conflicts.map(c => (
        <section key={c.id} className="stack" aria-label={`Conflict: ${c.title}`}>
          <div className="banner bad"><p><b>At risk:</b> {c.reason}</p></div>
          {c.options.map(o => (
            <button key={o.key} className="opt" aria-pressed={choices[c.id] === o.key} onClick={() => setChoices({ ...choices, [c.id]: o.key })}>
              <span className="key">{o.key}</span>
              <span className="grow">
                <b>{o.label}</b>
                <span className="muted small" style={{ display: 'block' }}>{o.detail}</span>
                {o.warnings.map((w, i) => <span key={i} className="small" style={{ display: 'block', color: 'var(--warn)' }}>{w}</span>)}
              </span>
            </button>
          ))}
          <button className="opt" aria-pressed={choices[c.id] === 'keep'} onClick={() => setChoices({ ...choices, [c.id]: 'keep' })}>
            <span className="key">0</span>
            <span className="grow"><b>Leave it for now</b><span className="muted small" style={{ display: 'block' }}>Nothing moves for {c.title}. It shows as at risk.</span></span>
          </button>
        </section>
      ))}

      <form className="row" onSubmit={e => { e.preventDefault(); if (reply.trim()) { const t = reply; setReply(''); onReply(t); } }}>
        <label htmlFor="reply" className="sr-only">Reply</label>
        <input id="reply" className="grow" name="reply" value={reply} onChange={e => setReply(e.target.value)} placeholder={listening ? 'Listening… say yes, no or a change' : r.conflicts.length ? 'Say an option, e.g. “push my sleep”…' : 'Say “yes”, “no”, or a change…'} autoComplete="off" enterKeyHint="send"
          style={{ minHeight: 44, padding: '0 14px', borderRadius: 22, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 17 }} />
        {reply.trim() || !mic ? <button className="btn" disabled={!reply.trim()}>Send</button> : mic}
      </form>

      <section className="stack">
        <h3>What will change</h3>
        <DiffList diff={[...r.diff, ...extraDiff]} />
      </section>
      {[...r.warnings, ...extraWarn].length > 0 && (
        <div className="warnings" role="status">{[...r.warnings, ...extraWarn].map((w, i) => <p key={i}>{w}</p>)}</div>
      )}
      <div className="actions">
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn" onClick={() => { requestEdit(pending); close(); }}>Edit</button>
        <button className="btn primary" onClick={apply} disabled={busy || unresolved.length > 0}>
          {unresolved.length ? 'Pick an option' : busy ? 'Saving…' : 'Apply'}
        </button>
      </div>
    </Sheet>
  );
}
