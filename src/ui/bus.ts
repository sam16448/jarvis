// Small UI event bus: input bar text, add/edit sheets, interpreter round-trips.
import { useSyncExternalStore } from 'react';
import { interpret, mergeAnswer } from '../interpret';
import type { Command } from '../engine/types';
import { dismiss, getApp, nowStr, propose, resolveLast, showResult, toast, undo, type Pending } from '../store/store';

type Sheet =
  | { kind: 'add'; preset?: Partial<AddPreset> }
  | { kind: 'item'; ref: string }
  | { kind: 'brief' }
  | { kind: 'wrapup' }
  | null;

export interface AddPreset { mode: 'task' | 'event' | 'series' | 'block'; date: string; start: string; end: string; cmd?: Command; }

interface Bus { input: string; sheet: Sheet; thinking: boolean; focusSeq: number; }
let bus: Bus = { input: '', sheet: null, thinking: false, focusSeq: 0 };
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
    if (/^\s*undo\s*$/i.test(text)) { set({ input: '' }); await undo(); return; }
    const conflictOpen = !!getApp().lastConflict;
    const r = await interpret(text.trim(), st, nowStr(), conflictOpen);
    set({ input: '' });
    if (r.cmd.kind === 'resolve') {
      if (!conflictOpen) showResult({ type: 'answer', title: 'Nothing to resolve', lines: ['There is no open conflict right now.'] }, text);
      else if (!resolveLast(r.cmd.option)) toast(`Option ${r.cmd.option} isn't available here. Pick one of the options shown.`);
    } else propose(r.cmd, text.trim(), r.via);
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
  if (merged) { propose(merged, `${p.text ?? ''} / ${answer}`.replace(/^ \/ /, ''), p.via); return; }
  dismiss();
  await submitText(p.text ? `${p.text} ${answer}` : answer);
}

/** "Edit" on a confirmation card: put the words back in the bar, or reopen the form. */
export function requestEdit(p: Pending) {
  if (p.text && p.via !== 'ui') { set({ input: p.text, focusSeq: bus.focusSeq + 1 }); return; }
  if (p.cmd) set({ sheet: { kind: 'add', preset: { cmd: p.cmd } } });
}
