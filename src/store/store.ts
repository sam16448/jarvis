import { useSyncExternalStore } from 'react';
import { opsWithChoices, plan } from '../engine/plan';
import { applyOps } from '../engine/state';
import { dateOf, localNow, toT, fromT } from '../engine/time';
import type { Command, ConflictOption, Op, PlanResult, Proposal, State } from '../engine/types';
import { Repo } from './db';

export interface Pending {
  result: PlanResult;
  text?: string;          // what the user said/typed
  cmd?: Command;
  via?: 'rules' | 'ai' | 'ui';
  choices?: Record<string, ConflictOption['key']>;
}

export interface AppState {
  st: State | null;
  now: string;
  pending: Pending | null;
  toast: { text: string; undo?: boolean } | null;
  undoCount: number;
  error: string | null;
  lastConflict: Pending | null;   // kept so a spoken follow-up can answer it later
}

const repo = new Repo();
let state: AppState = { st: null, now: localNow(), pending: null, toast: null, undoCount: 0, error: null, lastConflict: null };
const subs = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  subs.forEach(f => f());
}

export function getApp(): AppState { return state; }
export function useApp(): AppState {
  return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => state);
}

// ---------- clock (supports ?now=YYYY-MM-DDTHH:mm for testing) ----------
let offsetMin = 0;
function readNowOverride() {
  try {
    const q = new URLSearchParams(location.search).get('now');
    if (q && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(q)) sessionStorage.setItem('jarvis-now', q + '|' + Date.now());
    const saved = sessionStorage.getItem('jarvis-now');
    if (saved) {
      const [n, at] = saved.split('|');
      offsetMin = toT(n) - toT(localNow(new Date(Number(at))));
    }
  } catch { /* storage unavailable */ }
}
export function nowStr(): string {
  return fromT(toT(localNow()) + offsetMin);
}

// ---------- lifecycle ----------
export async function init() {
  readNowOverride();
  try {
    const st = await repo.load();
    const h = await repo.history();
    set({ st, now: nowStr(), undoCount: h.length });
  } catch (e) {
    set({ error: 'Could not open on-device storage. If Private Browsing is on, turn it off and reload. ' + String(e) });
  }
  setInterval(() => {
    const n = nowStr();
    if (n !== state.now) set({ now: n });
  }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) set({ now: nowStr() }); });
}

export const today = () => dateOf(toT(state.now));

// ---------- proposals ----------
export function propose(cmd: Command, text?: string, via: Pending['via'] = 'ui') {
  if (!state.st) return;
  const result = plan(state.st, cmd, nowStr());
  showResult(result, text, cmd, via);
}

export function showResult(result: PlanResult, text?: string, cmd?: Command, via?: Pending['via'], choices?: Pending['choices']) {
  const pending: Pending = { result, text, cmd, via, choices };
  set({ pending, lastConflict: result.type === 'proposal' && result.conflicts.length ? pending : state.lastConflict });
}

/** Re-open the last conflict with an option chosen (from a spoken/typed follow-up). */
export function resolveLast(option: ConflictOption['key']): boolean {
  const p = state.lastConflict;
  if (!p || p.result.type !== 'proposal') return false;
  const choices: Record<string, ConflictOption['key']> = { ...(state.pending === p ? p.choices : {}) };
  let any = false;
  for (const c of p.result.conflicts) if (c.options.some(o => o.key === option)) { choices[c.id] = option; any = true; }
  set({ pending: { ...p, choices } });
  return any;
}

export function dismiss() { set({ pending: null }); }

export async function applyPending(choices: Record<string, ConflictOption['key']> = {}) {
  const p = state.pending;
  if (!p || p.result.type !== 'proposal' || !state.st) return;
  const ops = opsWithChoices(p.result, choices);
  await commit(ops, (p.result as Proposal).understood);
  set({ pending: null, lastConflict: p.result.conflicts.length ? null : state.lastConflict });
}

export async function commit(ops: Op[], label: string, toast = true) {
  if (!state.st || !ops.length) return;
  const st = await repo.commit(state.st, ops, label, nowStr());
  const h = await repo.history();
  set({ st, undoCount: h.length, toast: toast ? { text: 'Saved', undo: true } : state.toast });
}

/** Changes that are not undoable (settings field edits, sleep log). */
export async function commitQuiet(ops: Op[]) {
  if (!state.st || !ops.length) return;
  const st = await repo.commit(state.st, ops, 'settings', nowStr(), false);
  set({ st });
}

export async function undo() {
  if (!state.st) return;
  const r = await repo.undo(state.st);
  const h = await repo.history();
  set({ st: r.state, undoCount: h.length, toast: { text: r.label ? `Undid: ${r.label}` : 'Nothing to undo' } });
}

export async function history() { return repo.history(); }

export function toast(text: string) { set({ toast: { text } }); }
export function clearToast() { set({ toast: null }); }

export async function replaceAll(st: State) {
  await repo.replaceAll(st);
  set({ st, undoCount: 0 });
}

export async function meta<T>(id: string) { return repo.getMeta<T>(id); }
export async function setMeta(id: string, v: unknown) { return repo.setMeta(id, v); }

/** Preview a state with ops applied (for drag previews). */
export function previewState(ops: Op[]): State | null {
  return state.st ? applyOps(state.st, ops) : null;
}
