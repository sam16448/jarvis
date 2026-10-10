// Spoken morning brief and night wrap-up. Facts come only from the scheduler; Gemini (if set)
// just phrases them in a JARVIS voice, otherwise a template does.
import { dayLoad, examStats, latestSafeBedtime, overload, sleepWeek, studyBySubject, topPriorities } from '../engine/metrics';
import { addDays, at, clock, dateOf, dur, shortDate, toT, WEEKDAYS, weekday } from '../engine/time';
import { bedT, hardBedT, timeline } from '../engine/timeline';
import type { State } from '../engine/types';
import { llmText } from '../interpret/llm';
import type { Weather } from './weather';

const isRoutine = (o: { source: string; role?: string }) => o.source === 'template' && o.role !== 'club';

export interface MorningFacts {
  kind: 'morning';
  day: string; date: string; now: string;
  weather?: { place: string; summary: string; nowC?: number; highC: number; lowC: number; rainChancePct?: number };
  schedule: { time: string; title: string; critical?: boolean }[];
  topPriorities: { title: string; due?: string }[];
  dueWithin48h: { title: string; due: string }[];
  exams: { title: string; daysLeft: number }[];
  studyNeededToday: { subject: string; amount: string }[];
  lastNightSleep?: string;
  sleepDebtThisWeek?: string;
  warning?: string;
}

export interface NightFacts {
  kind: 'night';
  day: string;
  doneToday: string[];
  notDone: string[];
  studiedToday: { subject: string; amount: string }[];
  tomorrowFirst?: { time: string; title: string };
  tomorrowCount: number;
  suggestedBedtime: string;
  sleepIfSo: string;
  latestBedtimeForMinimumSleep: string;
}

export function morningFacts(st: State, nowS: string, w?: Weather): MorningFacts {
  const now = toT(nowS);
  const d = dateOf(now);
  const items = timeline(st, d, d).filter(o => o.date === d && !o.hint && o.status !== 'skipped' && !isRoutine(o));
  const exams = examStats(st, now);
  const sleep = sleepWeek(st, now);
  const load = dayLoad(st, d);
  const ov = overload(st, now);
  const warning = load.workMin > st.settings.dailyWorkCapH * 60
    ? `Today has ${dur(load.workMin)} of planned work, over the ${st.settings.dailyWorkCapH} hour limit.`
    : ov.week ? `This week needs ${dur(ov.week.demandMin)} of work but only ${dur(ov.week.supplyMin)} is free.` : undefined;
  return {
    kind: 'morning', day: WEEKDAYS[weekday(d)], date: shortDate(d), now: clock(now),
    weather: w && { place: w.place, summary: w.desc, nowC: w.nowC, highC: w.maxC, lowC: w.minC, rainChancePct: w.rainPct },
    schedule: items.slice(0, 8).map(o => ({ time: clock(o.s), title: o.title, critical: o.priority === 'critical' || undefined })),
    topPriorities: topPriorities(st, now, 3).map(t => ({ title: t.title, due: t.deadline ? `${shortDate(t.deadline.slice(0, 10))} ${clock(t.deadline)}` : undefined })),
    dueWithin48h: st.tasks.filter(t => t.status === 'open' && t.deadline && toT(t.deadline) > now && toT(t.deadline) - now <= 48 * 60)
      .map(t => ({ title: t.title, due: `${shortDate(t.deadline!.slice(0, 10))} ${clock(t.deadline!)}` })),
    exams: exams.slice(0, 4).map(e => ({ title: e.exam.title, daysLeft: e.daysLeft })),
    studyNeededToday: exams.filter(e => e.daysLeft > 0 && e.targetMin > e.doneMin).slice(0, 3).map(e => ({ subject: e.exam.subject, amount: dur(e.perDayNeededMin) })),
    lastNightSleep: sleep.lastNightH !== undefined ? `${sleep.lastNightH.toFixed(1)} hours` : undefined,
    sleepDebtThisWeek: sleep.debtH > 0.5 ? `${sleep.debtH.toFixed(1)} hours` : undefined,
    warning,
  };
}

export function nightFacts(st: State, nowS: string): NightFacts {
  const now = toT(nowS);
  const d = dateOf(now);
  const items = timeline(st, d, d).filter(o => o.date === d && !o.hint && !isRoutine(o) && o.source !== 'exam' && o.kind !== 'block' && o.s < now);
  const tomorrow = timeline(st, addDays(d, 1), addDays(d, 1)).filter(o => o.date === addDays(d, 1) && !o.hint && !isRoutine(o));
  const lastToday = Math.max(...timeline(st, d, d).filter(o => o.date === d && !o.hint && !isRoutine(o) && o.status === 'planned').map(o => o.e), 0);
  const suggest = Math.max(now + 15, Math.min(bedT(st, d), Math.max(lastToday + 15, at(d, '21:30'))));
  return {
    kind: 'night', day: WEEKDAYS[weekday(d)],
    doneToday: items.filter(o => o.status === 'done').map(o => o.title),
    notDone: items.filter(o => o.status !== 'done').map(o => o.title),
    studiedToday: Object.entries(studyBySubject(st, d, addDays(d, 1))).map(([subject, m]) => ({ subject, amount: dur(m) })),
    tomorrowFirst: tomorrow[0] && { time: clock(tomorrow[0].s), title: tomorrow[0].title },
    tomorrowCount: tomorrow.length,
    suggestedBedtime: clock(suggest),
    sleepIfSo: `${((at(addDays(d, 1), st.settings.wake) - suggest) / 60).toFixed(1)} hours`,
    latestBedtimeForMinimumSleep: clock(Math.min(latestSafeBedtime(st, d), hardBedT(st, d))),
  };
}

const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function templateMorning(f: MorningFacts, address: string): string {
  const out: string[] = [];
  out.push(`Good morning, ${address}. It's ${f.day}, ${f.date}.`);
  if (f.weather) out.push(`In ${f.weather.place} it's ${f.weather.summary}, ${f.weather.nowC !== undefined ? `${f.weather.nowC} degrees now, ` : ''}with a high of ${f.weather.highC}${f.weather.rainChancePct && f.weather.rainChancePct >= 40 ? ` and a ${f.weather.rainChancePct} percent chance of rain, so take an umbrella` : ''}.`);
  if (f.schedule.length) out.push(`You have ${f.schedule.length} thing${f.schedule.length > 1 ? 's' : ''} today, starting with ${f.schedule[0].title} at ${f.schedule[0].time}.`);
  else out.push('Nothing on the schedule beyond your routine.');
  if (f.topPriorities.length) out.push(`Top priority: ${f.topPriorities[0].title}.`);
  if (f.dueWithin48h.length) out.push(`Due within two days: ${list(f.dueWithin48h.map(x => x.title))}.`);
  const ex = f.exams[0];
  if (ex) out.push(`${ex.title} is ${ex.daysLeft === 0 ? 'today' : `in ${ex.daysLeft} day${ex.daysLeft > 1 ? 's' : ''}`}.`);
  if (f.studyNeededToday.length) out.push(`To stay on track, study ${list(f.studyNeededToday.map(s => `${s.subject} for ${s.amount}`))} today.`);
  if (f.lastNightSleep) out.push(`You slept ${f.lastNightSleep}${f.sleepDebtThisWeek ? `, and you're ${f.sleepDebtThisWeek} short this week` : ''}.`);
  if (f.warning) out.push(`One warning: ${f.warning}`);
  out.push("Let's make it count.");
  return out.join(' ');
}

export function templateNight(f: NightFacts, address: string): string {
  const out: string[] = [`Evening, ${address}.`];
  out.push(f.doneToday.length ? `You finished ${f.doneToday.length} thing${f.doneToday.length > 1 ? 's' : ''} today${f.doneToday.length <= 3 ? `: ${list(f.doneToday)}` : ''}.` : "Nothing's ticked off yet today.");
  if (f.notDone.length) out.push(`${list(f.notDone.slice(0, 3))} still open. Tick what you finished and I'll reschedule the rest.`);
  if (f.studiedToday.length) out.push(`Study today: ${list(f.studiedToday.map(s => `${s.subject} ${s.amount}`))}.`);
  if (f.tomorrowFirst) out.push(`Tomorrow starts with ${f.tomorrowFirst.title} at ${f.tomorrowFirst.time}.`);
  out.push(`I'd suggest bed by ${f.suggestedBedtime}, which gives you ${f.sleepIfSo} of sleep. Goodnight.`);
  return out.join(' ');
}

export function systemPrompt(kind: 'morning' | 'night', address: string): string {
  return `You are JARVIS, the calm, dry-witted British AI butler from Iron Man, speaking a ${kind === 'morning' ? 'morning briefing' : 'night wrap-up'} aloud to the user, whom you address as "${address}".
Rules:
- Use ONLY the facts in the JSON. Never invent events, times, numbers, names, weather or deadlines. If a field is missing, skip that topic.
- Start with ONE short, clever, varied opening line in the style of a witty radio host or butler (it may play on the day, the weather or the city; e.g. "Good morning, ${address}. The sun is up, the coffee should be, and that exam is not getting any further away."). Do not reuse the example.
- ${kind === 'morning'
    ? 'Then cover, in order and briefly: weather, today\'s schedule highlights in time order (at most five), the top priority, anything due within 48 hours, the nearest exam countdown and study needed today, last night\'s sleep, and the warning if there is one.'
    : 'Then cover briefly: what got done, what is still open (it will be rescheduled), study done today, tomorrow\'s first item, and the suggested bedtime with hours of sleep.'}
- Under 130 words. Plain spoken sentences only: no lists, headings, markdown, emoji or symbols. Say times naturally ("seven p.m.", "half past six").
- Use "${address}" once or twice. End with a brief, encouraging sign-off line.`;
}

export interface Briefing { text: string; source: 'ai' | 'template'; note?: string; }

export async function makeBriefing(st: State, facts: MorningFacts | NightFacts, useAI: boolean): Promise<Briefing> {
  const address = st.settings.voice.address || 'boss';
  const template = facts.kind === 'morning' ? templateMorning(facts, address) : templateNight(facts, address);
  const canAI = useAI && st.settings.voice.aiBriefs && st.settings.llm.provider !== 'none' && !!st.settings.llm.key && (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!canAI) return { text: template, source: 'template' };
  try {
    const text = await llmText(st, systemPrompt(facts.kind, address), JSON.stringify(facts));
    return { text: text.replace(/[*#_`]/g, '').trim(), source: 'ai' };
  } catch (e) {
    return { text: template, source: 'template', note: `AI unavailable (${String((e as Error).message).slice(0, 60)}), using the standard brief.` };
  }
}
