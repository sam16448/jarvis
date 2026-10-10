import Dexie, { type Table } from 'dexie';
import { applyOps, inverseOps } from '../engine/state';
import { defaultSettings, seedState } from '../engine/seed';
import type { Op, State, TableName } from '../engine/types';

export interface HistoryEntry { id?: number; at: string; label: string; ops: Op[]; inverse: Op[]; }
interface Meta { id: string; value: unknown; }
type Row = { id: string };

export const TABLES: Exclude<TableName, 'settings'>[] = ['tasks', 'events', 'series', 'exams', 'days', 'inbox', 'habits', 'sleep', 'templates'];
export const UNDO_LIMIT = 20;
export const SCHEMA_VERSION = 1;

class JarvisDB extends Dexie {
  tasks!: Table<Row, string>;
  events!: Table<Row, string>;
  series!: Table<Row, string>;
  exams!: Table<Row, string>;
  days!: Table<Row, string>;
  inbox!: Table<Row, string>;
  habits!: Table<Row, string>;
  sleep!: Table<Row, string>;
  templates!: Table<Row, string>;
  settings!: Table<Row, string>;
  history!: Table<HistoryEntry, number>;
  meta!: Table<Meta, string>;
  constructor(name = 'jarvis') {
    super(name);
    this.version(1).stores({
      tasks: 'id', events: 'id, start', series: 'id', exams: 'id', days: 'id', inbox: 'id',
      habits: 'id', sleep: 'id', templates: 'id', settings: 'id', history: '++id', meta: 'id',
    });
  }
}

export class Repo {
  db: JarvisDB;
  constructor(name?: string) { this.db = new JarvisDB(name); }

  private table(t: TableName): Table<Row, string> {
    return this.db[t] as Table<Row, string>;
  }

  /** Load everything; seed on first run. */
  async load(): Promise<State> {
    const seeded = await this.db.meta.get('seeded');
    if (!seeded) {
      await this.replaceAll(seedState());
      await this.db.meta.put({ id: 'seeded', value: true });
    }
    const st = {} as State;
    for (const t of TABLES) (st as unknown as Record<string, Row[]>)[t] = await this.table(t).toArray();
    st.habits.sort((a, b) => a.order - b.order);
    const s = await this.db.settings.get('settings');
    // merge so new settings fields get defaults after upgrades
    st.settings = { ...defaultSettings(), ...(s as Partial<State['settings']>) } as State['settings'];
    return st;
  }

  private async write(ops: Op[]) {
    for (const op of ops) {
      if (op.t === 'put') await this.table(op.table).put(op.row);
      else await this.table(op.table).delete(op.id);
    }
  }

  /** Persist ops and push an undo entry. Returns the new state. */
  async commit(st: State, ops: Op[], label: string, at: string, undoable = true): Promise<State> {
    const inverse = inverseOps(st, ops);
    const next = applyOps(st, ops);
    await this.db.transaction('rw', [...TABLES.map(t => this.table(t)), this.db.settings, this.db.history], async () => {
      await this.write(ops);
      if (undoable) {
        await this.db.history.add({ at, label, ops, inverse });
        const n = await this.db.history.count();
        if (n > UNDO_LIMIT) {
          const old = await this.db.history.orderBy('id').limit(n - UNDO_LIMIT).primaryKeys();
          await this.db.history.bulkDelete(old);
        }
      }
    });
    return next;
  }

  async history(): Promise<HistoryEntry[]> {
    return (await this.db.history.orderBy('id').toArray()).reverse();
  }

  /** Undo the most recent change. */
  async undo(st: State): Promise<{ state: State; label?: string }> {
    const last = await this.db.history.orderBy('id').last();
    if (!last) return { state: st };
    const next = applyOps(st, last.inverse);
    await this.db.transaction('rw', [...TABLES.map(t => this.table(t)), this.db.settings, this.db.history], async () => {
      await this.write(last.inverse);
      await this.db.history.delete(last.id!);
    });
    return { state: next, label: last.label };
  }

  async replaceAll(st: State) {
    await this.db.transaction('rw', [...TABLES.map(t => this.table(t)), this.db.settings, this.db.history], async () => {
      for (const t of TABLES) {
        await this.table(t).clear();
        await this.table(t).bulkPut((st[t] as Row[]) ?? []);
      }
      await this.db.settings.clear();
      await this.db.settings.put(st.settings);
      await this.db.history.clear();
    });
  }

  async getMeta<T>(id: string): Promise<T | undefined> {
    return (await this.db.meta.get(id))?.value as T | undefined;
  }
  async setMeta(id: string, value: unknown) {
    await this.db.meta.put({ id, value });
  }
}

// ---------- backup ----------

export interface Backup { app: 'jarvis'; version: number; exportedAt: string; data: State; }

export function exportJSON(st: State, at: string, includeKey = false): string {
  const data: State = includeKey ? st : { ...st, settings: { ...st.settings, llm: { ...st.settings.llm, key: '' } } };
  const b: Backup = { app: 'jarvis', version: SCHEMA_VERSION, exportedAt: at, data };
  return JSON.stringify(b, null, 1);
}

export function parseBackup(text: string): State {
  let b: Backup;
  try { b = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!b || b.app !== 'jarvis' || !b.data) throw new Error('That file is not a Jarvis backup.');
  if (b.version > SCHEMA_VERSION) throw new Error('This backup is from a newer version of Jarvis.');
  const st = b.data;
  for (const t of TABLES) {
    if (!Array.isArray(st[t])) (st as unknown as Record<string, unknown[]>)[t] = [];
    if ((st[t] as Row[]).some(r => !r || typeof r.id !== 'string')) throw new Error(`Backup table “${t}” has rows without ids.`);
  }
  st.settings = { ...defaultSettings(), ...(st.settings ?? {}), id: 'settings' };
  return st;
}
