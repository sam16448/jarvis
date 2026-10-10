import { canonicalSubject } from './match';
import { examStats, freeSpans, taskRisk } from './metrics';
import { plannedMinutes, remainingMinutes } from './place';
import { addDays, clock, dateOf, dayLabel, dur, range, shortDate, toT, type T } from './time';
import { timeline } from './timeline';
import type { Answer, Command, Occ, State } from './types';

const occLine = (o: Occ) => `${range(o.s, o.e)}  ${o.title}${o.status === 'done' ? ' ✓' : o.status === 'missed' ? ' (missed)' : ''}`;

function dayItems(st: State, date: string): Occ[] {
  return timeline(st, date, date).filter(o => o.date === date && !o.hint && o.role !== 'meal' && o.role !== 'commute' && o.status !== 'skipped');
}

export function answerQuery(st: State, c: Extract<Command, { kind: 'query' }>, now: T): Answer {
  const today = dateOf(now);
  switch (c.q) {
    case 'today':
    case 'day': {
      const date = c.date ?? today;
      const items = dayItems(st, date);
      return { type: 'answer', title: `${dayLabel(date, today)}, ${shortDate(date)}`, lines: items.length ? items.map(occLine) : ['Nothing planned.'] };
    }
    case 'next': {
      const items = timeline(st, today, addDays(today, 1)).filter(o => !o.hint && o.e > now && o.role !== 'meal' && o.role !== 'commute' && o.status === 'planned');
      const cur = items.find(o => o.s <= now);
      const next = items.find(o => o.s > now);
      const lines = [];
      if (cur) lines.push(`Now: ${cur.title} until ${clock(cur.e)}`);
      if (next) lines.push(`Next: ${next.title} at ${clock(next.s)}${next.date !== today ? ' tomorrow' : ''} (in ${dur(next.s - now)})`);
      return { type: 'answer', title: "What's next", lines: lines.length ? lines : ['Nothing else planned.'] };
    }
    case 'dueWeek': {
      const end = now + 7 * 1440;
      const rows: { t: number; line: string }[] = [];
      for (const t of st.tasks) {
        if (t.status !== 'open' || !t.deadline) continue;
        const dl = toT(t.deadline);
        if (dl > end) continue;
        rows.push({ t: dl, line: `${shortDate(t.deadline.slice(0, 10))} ${clock(dl)}  ${t.title} (${taskRisk(st, t, now)}, ${dur(remainingMinutes(t))} left)` });
      }
      for (const e of st.exams) {
        const s = toT(e.start);
        if (s < now || s > end) continue;
        rows.push({ t: s, line: `${shortDate(e.start.slice(0, 10))} ${clock(s)}  ${e.title} (exam)` });
      }
      rows.sort((a, b) => a.t - b.t);
      return { type: 'answer', title: 'Due in the next 7 days', lines: rows.length ? rows.map(r => r.line) : ['Nothing due this week.'] };
    }
    case 'studyLeft': {
      const subj = c.subject ? canonicalSubject(st, c.subject) ?? c.subject : undefined;
      const stats = examStats(st, now).filter(s => !subj || s.exam.subject.toLowerCase() === subj.toLowerCase());
      if (!stats.length) return { type: 'answer', title: 'Study hours', lines: [subj ? `No upcoming exam for ${subj}.` : 'No upcoming exams.'] };
      return {
        type: 'answer', title: 'Study hours left',
        lines: stats.map(s => `${s.exam.subject}: ${dur(Math.max(0, s.targetMin - s.doneMin))} left of ${s.exam.targetHours} h (${dur(s.plannedMin)} planned, ${s.daysLeft} days to go, ${s.status})`),
      };
    }
    case 'onTrack': {
      const stats = examStats(st, now);
      const risky = st.tasks.filter(t => t.status === 'open' && t.deadline).map(t => ({ t, r: taskRisk(st, t, now) })).filter(x => x.r !== 'on track');
      const lines = stats.map(s => `${s.exam.subject} exam: ${s.status} (${dur(s.doneMin)} done + ${dur(s.plannedMin)} planned of ${s.exam.targetHours} h)`);
      lines.push(...risky.map(x => `${x.t.title}: ${x.r}`));
      const bad = stats.filter(s => s.status === 'at risk').length + risky.filter(x => x.r === 'at risk').length;
      return { type: 'answer', title: bad ? `${bad} thing${bad > 1 ? 's' : ''} at risk` : 'You are on track', lines: lines.length ? lines : ['Nothing pending.'] };
    }
    case 'free': {
      const date = c.date ?? today;
      const spans = freeSpans(st, date, now, 20);
      const total = spans.reduce((a, [s, e]) => a + e - s, 0);
      return {
        type: 'answer', title: `Free ${dayLabel(date, today).toLowerCase()}: ${dur(total)}`,
        lines: spans.length ? spans.map(([s, e]) => `${range(s, e)}  (${dur(e - s)})`) : ['No free time left.'],
      };
    }
  }
}

export function taskSummary(st: State, id: string, now: T): string {
  const t = st.tasks.find(x => x.id === id);
  if (!t) return '';
  return `${dur(remainingMinutes(t))} left, ${dur(plannedMinutes(st, id, now))} planned`;
}
