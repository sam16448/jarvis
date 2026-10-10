import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { plan } from '../engine/plan';
import type { Proposal } from '../engine/types';
import { exportJSON, parseBackup, Repo, UNDO_LIMIT } from './db';

let n = 0;
const fresh = () => new Repo('test-' + n++);

describe('storage', () => {
  it('seeds on first run and reloads the same data', async () => {
    const r = fresh();
    const st = await r.load();
    expect(st.exams).toHaveLength(0);
    expect(st.habits.map(h => h.name)).toEqual(['Water', 'Gym', 'Meal prep']);
    const again = await r.load();
    expect(again.habits).toHaveLength(3);
  });

  it('commits a proposal and undoes it', async () => {
    const r = fresh();
    let st = await r.load();
    const p = plan(st, { kind: 'addEvent', title: 'Gym', start: '2026-10-12T19:00', end: '2026-10-12T20:00' }, '2026-10-12T07:00') as Proposal;
    st = await r.commit(st, p.ops, 'Add gym', '2026-10-12T07:00');
    expect((await r.load()).events.map(e => e.id)).toEqual(st.events.map(e => e.id));
    const u = await r.undo(st);
    expect(u.label).toBe('Add gym');
    expect(u.state.events).toHaveLength(0);
    expect((await r.load()).events).toHaveLength(0);
  });

  it(`keeps only the last ${UNDO_LIMIT} changes`, async () => {
    const r = fresh();
    let st = await r.load();
    for (let i = 0; i < UNDO_LIMIT + 5; i++) {
      st = await r.commit(st, [{ t: 'put', table: 'inbox', row: { id: 'i' + i, text: 'x', createdAt: '' } as never }], 'i' + i, '');
    }
    const h = await r.history();
    expect(h).toHaveLength(UNDO_LIMIT);
    expect(h[0].label).toBe('i' + (UNDO_LIMIT + 4));
  });

  it('exports and imports JSON, without the API key by default', async () => {
    const r = fresh();
    let st = await r.load();
    st = { ...st, settings: { ...st.settings, llm: { provider: 'gemini', key: 'secret', model: 'm' } } };
    const json = exportJSON(st, '2026-10-12T07:00');
    expect(json).not.toContain('secret');
    const back = parseBackup(json);
    expect(back.habits).toHaveLength(3);
    const r2 = fresh();
    await r2.load();
    await r2.replaceAll(back);
    expect((await r2.load()).habits).toHaveLength(3);
    expect(() => parseBackup('{"foo":1}')).toThrow(/not a Jarvis backup/);
  });
});
