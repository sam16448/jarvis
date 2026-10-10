import { afterEach, describe, expect, it, vi } from 'vitest';
import { plan } from '../engine/plan';
import { applyOps } from '../engine/state';
import { base } from '../engine/testutil';
import type { State } from '../engine/types';
import { makeBriefing, morningFacts, nightFacts, systemPrompt, templateMorning } from './briefing';
import { replyFor } from './persona';
import { speechText } from './speak';
import { describeCode, fetchWeather, weatherLine } from './weather';

const MON7 = '2026-10-12T07:00';
afterEach(() => vi.unstubAllGlobals());

function withTask(): State {
  let st = base();
  const p = plan(st, { kind: 'addTask', title: 'History essay', type: 'assignment', due: '2026-10-13T23:59', estimateMin: 60 }, MON7);
  if (p.type === 'proposal') st = applyOps(st, p.ops);
  return st;
}

describe('speech text', () => {
  it('reads times, durations and units naturally', () => {
    expect(speechText('Gym 7:00-8:30 pm')).toBe('Gym 7 to 8:30 pm');
    expect(speechText('11:30 am-1:00 pm lunch')).toBe('11:30 am to 1 pm lunch');
    expect(speechText('2h 30m left, 1h planned')).toBe('2 hours 30 minutes left, 1 hour planned');
    expect(speechText('31°C, 60% rain')).toBe('31 degrees, 60 percent rain');
    expect(speechText('“Quoted” **bold**')).toBe('Quoted bold');
  });
});

describe('Jarvis replies', () => {
  it('acknowledges a proposal, addresses the user and asks to go ahead', () => {
    const st = base();
    const r = plan(st, { kind: 'addEvent', title: 'Gym', start: '2026-10-12T19:00', end: '2026-10-12T20:00' }, MON7);
    const line = replyFor(r, 'boss');
    expect(line).toMatch(/, boss\./);
    expect(line).toMatch(/Gym/);
    expect(line).toMatch(/Shall I go ahead\?$/);
  });
  it('explains a conflict and suggests an option', () => {
    const st = base();
    const r = plan(st, { kind: 'addTask', title: 'Huge report', type: 'assignment', due: '2026-10-12T23:00', estimateMin: 600 }, MON7);
    expect(replyFor(r, 'sir')).toMatch(/One snag/);
  });
  it('reads answers and asks questions', () => {
    const st = base();
    expect(replyFor(plan(st, { kind: 'query', q: 'next' }, '2026-10-12T09:30'), 'boss')).toMatch(/College/);
    expect(replyFor(plan(st, { kind: 'addTask', title: 'Essay', type: 'assignment' }, MON7), 'boss')).toMatch(/due, boss\?$/);
  });
});

describe('briefings', () => {
  it('morning facts come from the schedule only', () => {
    const f = morningFacts(withTask(), MON7);
    expect(f.day).toBe('Mon');
    expect(f.dueWithin48h.map(d => d.title)).toEqual(['History essay']);
    expect(f.exams[0].title).toBe('Lab quiz');
    expect(f.weather).toBeUndefined();
  });

  it('template brief mentions the essentials', () => {
    const t = templateMorning(morningFacts(withTask(), MON7), 'boss');
    expect(t).toMatch(/^Good morning, boss\. It's Mon, Mon 12 Oct\./);
    expect(t).toMatch(/History essay/);
    expect(t).toMatch(/Lab quiz is in 8 days/);
  });

  it('night facts list done and open items with a bedtime', () => {
    const f = nightFacts(withTask(), '2026-10-12T22:30');
    expect(f.notDone).toContain('History essay');
    expect(f.suggestedBedtime).toMatch(/pm|am/);
  });

  it('uses Gemini with a no-invention prompt when a key is set', async () => {
    const st = withTask();
    st.settings = { ...st.settings, llm: { provider: 'gemini', key: 'k', model: '' } };
    const f = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Good morning, boss. **Splendid** day.' }] } }] })));
    vi.stubGlobal('fetch', f);
    const b = await makeBriefing(st, morningFacts(st, MON7), true);
    expect(b).toEqual({ text: 'Good morning, boss. Splendid day.', source: 'ai' });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.generationConfig.responseMimeType).toBe('text/plain');
    expect(body.systemInstruction.parts[0].text).toMatch(/Use ONLY the facts/);
    expect(body.contents[0].parts[0].text).toContain('History essay');
  });

  it('falls back to the template when the AI fails or is off', async () => {
    const st = withTask();
    st.settings = { ...st.settings, llm: { provider: 'gemini', key: 'k', model: '' } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota', { status: 429 })));
    const b = await makeBriefing(st, morningFacts(st, MON7), true);
    expect(b.source).toBe('template');
    expect(b.note).toMatch(/AI unavailable/);
    const off = await makeBriefing(base(), morningFacts(base(), MON7), true);
    expect(off.source).toBe('template');
  });

  it('system prompt sets the persona and address', () => {
    expect(systemPrompt('morning', 'sir')).toMatch(/JARVIS/);
    expect(systemPrompt('morning', 'sir')).toMatch(/"sir"/);
    expect(systemPrompt('night', 'boss')).toMatch(/suggested bedtime/);
  });
});

describe('weather', () => {
  it('maps codes and formats a line', () => {
    expect(describeCode(0)).toBe('clear skies');
    expect(describeCode(63)).toBe('rain');
    expect(weatherLine({ place: 'London', desc: 'rain', nowC: 24, maxC: 28, minC: 21, rainPct: 70 })).toBe('London: rain, 24°C now, high 28°C, low 21°C, 70% chance of rain');
  });
  it('reads today from Open-Meteo with rounded coordinates', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({
      current: { temperature_2m: 24.4, weather_code: 2 },
      daily: { time: ['2026-10-12', '2026-10-13'], weather_code: [61, 0], temperature_2m_max: [28.2, 30], temperature_2m_min: [20.6, 21], precipitation_probability_max: [65, 5] },
    })));
    vi.stubGlobal('fetch', f);
    const w = await fetchWeather(18.52043, 73.85674, 'London', '2026-10-12');
    expect(w).toEqual({ place: 'London', desc: 'rain', nowC: 24, maxC: 28, minC: 21, rainPct: 65 });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toContain('latitude=18.52&longitude=73.86');
  });
});
