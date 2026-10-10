import { describe, expect, it } from 'vitest';
import { buildICS } from './ics';
import { plan } from './plan';
import { applyOps } from './state';
import { base } from './testutil';

describe('ics export', () => {
  it('exports the next 7 days with alerts, skipping routine', () => {
    let st = base();
    const p = plan(st, { kind: 'addEvent', title: 'Gym, legs', start: '2026-10-12T19:00', end: '2026-10-12T20:00' }, '2026-10-12T07:00');
    if (p.type === 'proposal') st = applyOps(st, p.ops);
    const ics = buildICS(st, '2026-10-12T07:00', 7);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Gym\\, legs');
    expect(ics).toContain('DTSTART:20261012T190000');
    expect(ics).toContain('TRIGGER:-PT10M');
    expect(ics).not.toContain('SUMMARY:College');
    expect(ics).toContain('SUMMARY:Club');
    expect(ics).not.toContain('Maths exam'); // Oct 28 is beyond 7 days
    expect(buildICS(st, '2026-10-20T07:00', 7)).toContain('TRIGGER:-PT60M'); // exam alerts 1h before
  });
});
