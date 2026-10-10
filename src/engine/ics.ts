// iCalendar export for the next N days so iPhone Calendar can alert when Jarvis is closed.
import { addDays, dateOf, toT } from './time';
import { timeline } from './timeline';
import type { Occ, State } from './types';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const stamp = (t: string) => t.replace(/[-:]/g, '') + '00'; // floating local time
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,74}/g)!.join('\r\n ');

export function icsEvents(st: State, from: string, days: number): Occ[] {
  return timeline(st, from, addDays(from, days - 1))
    .filter(o => o.date >= from && !o.hint && o.status === 'planned' && (o.source !== 'template' || o.role === 'club'));
}

export function buildICS(st: State, nowS: string, days = 7, alertMin = 10): string {
  const from = dateOf(toT(nowS));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jarvis//Scheduler//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Jarvis'];
  const fromT = (t: number) => { const d = dateOf(t); const m = t - toT(d); return `${d}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  for (const o of icsEvents(st, from, days)) {
    const isExam = o.type === 'exam';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${o.key.replace(/:/g, '-')}@jarvis.local`,
      `DTSTAMP:${stamp(nowS)}`,
      `DTSTART:${stamp(fromT(o.s))}`,
      `DTEND:${stamp(fromT(o.e))}`,
      fold(`SUMMARY:${esc(o.title)}`),
      ...(o.subject ? [fold(`DESCRIPTION:${esc(`${o.subject}${o.priority === 'critical' ? ' (critical)' : ''}`)}`)] : []),
      `CATEGORIES:${esc(o.type)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${esc(o.title)}`), `TRIGGER:-PT${isExam ? 60 : alertMin}M`, 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
