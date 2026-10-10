// Small UI event bus: input bar text, add/edit sheets, interpreter round-trips.
import { useSyncExternalStore } from 'react';
import { interpret, mergeAnswer } from '../interpret';
import type { Command } from '../engine/types';
import { applyPending, dismiss, getApp, nowStr, propose, resolveLast, showResult, toast, undo, type Pending } from '../store/store';
import { address, say, sayReply, stopSpeaking } from '../voice';
import { cancelLine, doneLine, undoLine } from '../voice/persona';
import { isNo, isYes, micAvailable } from '../voice/listen';
export { isNo, isYes };

type Sheet =
  | { kind: 'add'; preset?: Partial<AddPreset> }
  | { kind: 'item'; ref: string }
  | { kind: 'brief' }
  | { kind: 'wrapup' }
  | null;

export interface AddPreset { mode: 'task' | 'event' | 'series' | 'block'; date: string; start: string; end: string; cmd?: Command; }

interface Bus { input: string; sheet: Sheet; thinking: boolean; focusSeq: number; listenSeq: number; }
let bus: Bus = { input: '', sheet: null, thinking: false, focusSeq: 0, listenSeq: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<Bus>) => { bus = { ...bus, ...p }; subs.forEach(f => f()); };
export const useBus = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => bus);

export const setInput = (input: string) => set({ input });
export const openSheet = (sheet: Sheet) => set({ sheet });
export const closeSheet = () => set({ sheet: null });

/** Interpret text and show the confirmation card. */
export async function submitText(text: string) {
  const st = getApp().st;
  if (!st || !text.trim()) return;
  set({ thinking: true });
  try {
    if (/^\s*undo\s*$/i.test(text)) { set({ input: '' }); const lbl = await undo(); void say(undoLine(lbl)); return; }
    const conflictOpen = !!getApp().lastConflict;
    const r = await interpret(text.trim(), st, nowStr(), conflictOpen);
    set({ input: '' });
    if (r.cmd.kind === 'resolve') {
      if (!conflictOpen) showResult({ type: 'answer', title: 'Nothing to resolve', lines: ['There is no open conflict right now.'] }, text);
      else if (!resolveLast(r.cmd.option)) { toast(`Option ${r.cmd.option} isn't available here. Pick one of the options shown.`); void say(`Option ${r.cmd.option} isn't on the table, ${address()}. Pick one of the others.`); }
      else void say(`Option ${r.cmd.option} it is. Say yes and I'll make it so.`);
    } else { propose(r.cmd, text.trim(), r.via); speakThenListen(); }
    if (r.note) toast(r.note);
  } finally {
    set({ thinking: false });
  }
}

/** Answer to a clarifying question: merge into the partial command, or re-interpret. */
export async function answerQuestion(p: Pending, answer: string) {
  const st = getApp().st;
  if (!st) return;
  const q = p.result.type === 'question' ? p.result : null;
  const merged = q?.partial ? mergeAnswer(q.partial, answer, st, nowStr()) : null;
  if (merged) { propose(merged, `${p.text ?? ''} / ${answer}`.replace(/^ \/ /, ''), p.via); speakThenListen(); return; }
  dismiss();
  await submitText(p.text ? `${p.text} ${answer}` : answer);
}

/** "Edit" on a confirmation card: put the words back in the bar, or reopen the form. */
export function requestEdit(p: Pending) {
  if (p.text && p.via !== 'ui') { set({ input: p.text, focusSeq: bus.focusSeq + 1 }); return; }
  if (p.cmd) set({ sheet: { kind: 'add', preset: { cmd: p.cmd } } });
}

/**
 * Spoken/typed reply while a confirmation card is open: "yes" applies, "no" cancels,
 * a conflict answer picks an option, anything else is a new command.
 */
export async function replyToCard(text: string) {
  const app = getApp();
  const p = app.pending;
  const t = text.trim();
  if (!t) return;
  if (p && isYes(t)) {
    if (p.result.type === 'proposal') {
      const unresolved = p.result.conflicts.filter(c => !p.choices?.[c.id]);
      if (unresolved.length) { void say(`Which option for ${unresolved[0].title}, ${address()}?`); return; }
      await applyPending(p.choices ?? {});
      void say(doneLine(address()));
    } else dismiss();
    return;
  }
  if (p && isNo(t)) { dismiss(); stopSpeaking(); void say(cancelLine()); return; }
  if (p?.result.type === 'question') { await answerQuestion(p, t); return; }
  await submitText(t);
}

/**
 * Speak Jarvis's reply; if it asked something (a confirmation card or a question) and
 * auto-listen is on, open the mic for the answer.
 */
export async function speakThenListen() {
  const p = getApp().pending;
  if (!p) return;
  await sayReply(p.result);
  const st = getApp().st;
  const still = getApp().pending === p;
  const asks = p.result.type === 'question' || p.result.type === 'proposal';
  if (still && asks && st?.settings.voice.enabled && st.settings.voice.autoListen && micAvailable()) set({ listenSeq: bus.listenSeq + 1 });
}
