import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedState } from '../engine/seed';
import { interpret } from './index';
import { systemPrompt, validateCommand } from './llm';

const now = '2026-10-12T07:00';
const withKey = () => { const st = seedState(); st.settings = { ...st.settings, llm: { provider: 'gemini', key: 'k', model: '' } }; return st; };
const gemini = (obj: unknown) => vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 }));

afterEach(() => vi.unstubAllGlobals());

describe('LLM interpreter', () => {
  it('validates commands strictly', () => {
    expect(validateCommand({ kind: 'addEvent', title: 'Gym', start: '2026-10-12T19:00', end: '2026-10-12T20:00' })).toBeTruthy();
    expect(validateCommand({ kind: 'addEvent', title: 'Gym', start: 'tonight', end: 'later' })).toBeNull();
    expect(validateCommand({ kind: 'deleteEverything' })).toBeNull();
    expect(validateCommand({ kind: 'addTask', title: 'X', type: 'nonsense', due: '2026-10-12T19:00' })).toBeNull();
  });

  it('never calls the AI when the rules are confident', async () => {
    const f = gemini({ kind: 'panic' });
    vi.stubGlobal('fetch', f);
    const r = await interpret('Add gym at 7 pm today', withKey(), now);
    expect(r.via).toBe('rules');
    expect(f).not.toHaveBeenCalled();
  });

  it('uses the AI for unclear text and returns its validated command', async () => {
    const f = gemini({ kind: 'addTask', title: 'Robotics kit', type: 'club', due: '2026-10-16T18:00' });
    vi.stubGlobal('fetch', f);
    const r = await interpret('robotics kit thing needs sorting, ideally around the club session', withKey(), now);
    expect(r.via).toBe('ai');
    expect(r.cmd).toMatchObject({ kind: 'addTask', title: 'Robotics kit' });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
  });

  it('falls back to the rule parser when the AI fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota', { status: 429 })));
    const r = await interpret('buy a new calculator', withKey(), now);
    expect(r.via).toBe('rules');
    expect(r.cmd).toMatchObject({ kind: 'capture' });
    expect(r.note).toMatch(/AI unavailable/);
  });

  it('works with no key at all', async () => {
    const r = await interpret('buy a new calculator', seedState(), now);
    expect(r).toMatchObject({ via: 'rules', cmd: { kind: 'capture' } });
  });

  it('prompt contains dates and only titles, not the schedule', () => {
    const p = systemPrompt(seedState(), now, true);
    expect(p).toContain('Mon 2026-10-12');
    expect(p).toContain('resolve');
    expect(p).not.toContain('settings');
  });
});
