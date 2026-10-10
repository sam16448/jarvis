import type { DayOverride, Op, State, TableName } from './types';

let counter = 0;
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1e6;
  return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}

type Row = { id: string };

export function getTable(st: State, table: TableName): Row[] {
  return table === 'settings' ? [st.settings] : (st[table] as Row[]);
}

/** Pure: returns a new State with ops applied. */
export function applyOps(st: State, ops: Op[]): State {
  const next: State = { ...st };
  const touched = new Set<TableName>();
  for (const op of ops) {
    if (op.table === 'settings') {
      if (op.t === 'put') next.settings = op.row as State['settings'];
      continue;
    }
    if (!touched.has(op.table)) {
      (next as unknown as Record<string, Row[]>)[op.table] = [...(next[op.table] as Row[])];
      touched.add(op.table);
    }
    const arr = next[op.table] as Row[];
    const i = arr.findIndex(r => r.id === (op.t === 'put' ? op.row.id : op.id));
    if (op.t === 'put') {
      if (i >= 0) arr[i] = op.row;
      else arr.push(op.row);
    } else if (i >= 0) arr.splice(i, 1);
  }
  return next;
}

/** Ops that undo `ops` when applied to the state that results from them. */
export function inverseOps(before: State, ops: Op[]): Op[] {
  const seen = new Set<string>();
  const inv: Op[] = [];
  for (const op of ops) {
    const id = op.t === 'put' ? op.row.id : op.id;
    const k = op.table + ':' + id;
    if (seen.has(k)) continue;
    seen.add(k);
    const prev = getTable(before, op.table).find(r => r.id === id);
    inv.push(prev ? { t: 'put', table: op.table, row: prev } : { t: 'del', table: op.table, id });
  }
  return inv.reverse();
}

/** Collapse ops so each row appears once (last write wins). */
export function compactOps(ops: Op[]): Op[] {
  const last = new Map<string, number>();
  ops.forEach((op, i) => last.set(op.table + ':' + (op.t === 'put' ? op.row.id : op.id), i));
  return ops.filter((op, i) => last.get(op.table + ':' + (op.t === 'put' ? op.row.id : op.id)) === i);
}

/** Mutable working copy used by the planner; records ops as it goes. */
export class Draft {
  state: State;
  ops: Op[] = [];
  constructor(st: State) { this.state = st; }
  put<R extends Row>(table: TableName, row: R) {
    const op: Op = { t: 'put', table, row };
    this.ops.push(op);
    this.state = applyOps(this.state, [op]);
  }
  del(table: TableName, id: string) {
    const op: Op = { t: 'del', table, id };
    this.ops.push(op);
    this.state = applyOps(this.state, [op]);
  }
  clone(): Draft {
    const d = new Draft(this.state);
    d.ops = [...this.ops];
    return d;
  }
  adopt(other: Draft) { this.state = other.state; this.ops = other.ops; }
  /** Ops added since `base` was cloned. */
  since(base: Draft): Op[] { return compactOps(this.ops.slice(base.ops.length)); }
  day(date: string): DayOverride {
    return this.state.days.find(d => d.id === date) ?? { id: date, slots: {} };
  }
  result(): Op[] { return compactOps(this.ops); }
}

export const putOp = <R extends Row>(table: TableName, row: R): Op => ({ t: 'put', table, row });
