// Rule-based interpreter: turns common phrases into Commands with no network and no key.
import { canonicalSubject } from '../engine/match';
import { addDays, dateOf, fmtHM, hm, minOfDay, toT, weekday } from '../engine/time';
import type { Command, ItemType, Priority, QueryKind, State, TaskType, TimeOfDay } from '../engine/types';

export interface RuleResult { cmd: Command; confidence: 'high' | 'low'; }

const WD: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const WD_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const pad = (n: number) => String(n).padStart(2, '0');

/** Mutable text that phrases are pulled out of, leaving the title behind. */
class Text {
  rest: string;
  constructor(public raw: string) {
    this.rest = ' ' + raw.toLowerCase()
      .replace(/[“”"]/g, '').replace(/[’']/g, "'").replace(/[–—]/g, '-')
      .replace(/\b(\d{1,2})\s*\.\s*(\d{2})\s*(am|pm)\b/g, '$1:$2 $3')
      .replace(/\ba\.m\.?/g, 'am').replace(/\bp\.m\.?/g, 'pm')
      .replace(/\s+/g, ' ') + ' ';
  }
  take(re: RegExp): RegExpMatchArray | null {
    const m = this.rest.match(re);
    if (m) this.rest = this.rest.replace(m[0], ' ');
    return m;
  }
  has(re: RegExp) { return re.test(this.rest); }
}

// ---------- dates ----------

function nextWeekday(today: string, wd: number, next: boolean): string {
  let diff = (wd - weekday(today) + 7) % 7;
  if (next && diff === 0) diff = 7;
  return addDays(today, diff);
}

function mkDate(today: string, d: number, m: number, y?: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  let yr = y ?? Number(today.slice(0, 4));
  if (yr < 100) yr += 2000;
  let s = `${yr}-${pad(m)}-${pad(d)}`;
  if (!y && s < addDays(today, -1)) s = `${yr + 1}-${pad(m)}-${pad(d)}`;
  return s;
}

/** Pull one date phrase out of the text. */
export function takeDate(t: Text, today: string): string | undefined {
  let m;
  if (t.take(/\b(day after tomorrow|day after tmrw)\b/)) return addDays(today, 2);
  if (t.take(/\b(today|tonight|this evening|this morning|this afternoon|now)\b/)) return today;
  if (t.take(/\b(tomorrow|tmrw|tmr|tommorow|tomorow)\b/)) return addDays(today, 1);
  if ((m = t.take(/\bin (\d+) days?\b/))) return addDays(today, Number(m[1]));
  if ((m = t.take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ${MON_RE}\\b(?:,? (\\d{4}))?`)))) return mkDate(today, Number(m[1]), MON[m[2].slice(0, 3)] ?? MON[m[2].slice(0, 4)], m[3] ? Number(m[3]) : undefined);
  if ((m = t.take(new RegExp(`\\b${MON_RE} (\\d{1,2})(?:st|nd|rd|th)?\\b(?:,? (\\d{4}))?`)))) return mkDate(today, Number(m[2]), MON[m[1].slice(0, 3)], m[3] ? Number(m[3]) : undefined);
  if ((m = t.take(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) return mkDate(today, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
  if ((m = t.take(new RegExp(`\\b(?:(this|next|coming|on|by|before|until|till) )?${WD_RE}\\b`)))) {
    const wd = WD[m[2].slice(0, 3)] ?? WD[m[2]];
    const d = nextWeekday(today, wd, m[1] === 'next');
    return m[1] === 'next' && d < addDays(today, 7) && weekday(today) < wd ? addDays(d, 7) : d;
  }
  if ((m = t.take(/\b(?:on (?:the )?|the |by (?:the )?)(\d{1,2})(?:st|nd|rd|th)\b/))) {
    const [y, mo] = today.split('-').map(Number);
    let d = mkDate(today, Number(m[1]), mo, y)!;
    if (d < today) d = mkDate(today, Number(m[1]), mo === 12 ? 1 : mo + 1, mo === 12 ? y + 1 : y)!;
    return d;
  }
  return undefined;
}

// ---------- times ----------

interface Clock { h: number; m: number; mer?: 'am' | 'pm' }
const clockOf = (h: string, m?: string, mer?: string): Clock => ({ h: Number(h), m: m ? Number(m) : 0, mer: mer as Clock['mer'] });

function to24(c: Clock, ctx: { morning?: boolean; evening?: boolean; afterMin?: number }): number {
  let h = c.h;
  if (c.mer === 'am') h = h === 12 ? 0 : h;
  else if (c.mer === 'pm') h = h === 12 ? 12 : h + 12;
  else if (h <= 12) {
    if (ctx.morning) h = h === 12 ? 12 : h;
    else if (ctx.evening) h = h === 12 ? 12 : h < 12 ? h + 12 : h;
    else if (ctx.afterMin !== undefined) {
      // first occurrence after `afterMin` within waking hours
      const am = (h === 12 ? 12 : h) * 60 + c.m, pm = (h === 12 ? 12 : h + 12) * 60 + c.m;
      h = am > ctx.afterMin && am >= 6 * 60 ? Math.floor(am / 60) : Math.floor(pm / 60);
    } else h = h <= 6 || h === 12 ? (h === 12 ? 12 : h + 12) : h >= 7 && h <= 11 ? h + 12 : h;
  }
  return h * 60 + c.m;
}

interface Times { start?: number; end?: number; until?: number }

export function takeTimes(t: Text, ctx: { morning?: boolean; evening?: boolean; afterMin?: number }): Times {
  const T = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?';
  let m;
  if ((m = t.take(new RegExp(`\\b(?:from |between )?${T}\\s*(?:to|till|until|-|and)\\s*${T}\\b`)))) {
    const a = clockOf(m[1], m[2], m[3]), b = clockOf(m[4], m[5], m[6]);
    if (a.h > 24 || b.h > 24) return {};
    if (!a.mer && b.mer) {
      a.mer = b.mer;
      // "11 to 1 pm" -> 11 am
      if (b.mer === 'pm' && a.h !== 12 && a.h > b.h && b.h !== 12) a.mer = 'am';
    }
    let s = to24(a, ctx);
    let e = to24(b, { ...ctx, afterMin: s });
    if (!b.mer && e <= s) e += 12 * 60;
    if (e <= s) e += 24 * 60;
    if (!a.mer && !b.mer && s < 12 * 60 && e > 12 * 60 && e - s > 8 * 60) { s += 12 * 60; e = to24(b, { afterMin: s }); }
    return { start: s, end: e };
  }
  if ((m = t.take(new RegExp(`\\b(?:till|until|untill|upto|up to|through)\\s+${T}\\b`)))) {
    const c = clockOf(m[1], m[2], m[3]);
    return { until: to24(c, ctx) };
  }
  if ((m = t.take(/\b(?:at )?(noon|midday)\b/))) return { start: 12 * 60 };
  if ((m = t.take(/\b(?:at )?midnight\b/))) return { start: 24 * 60 - 1 };
  if ((m = t.take(new RegExp(`\\b(?:at |@ ?|by |before )?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b`)))) return { start: to24(clockOf(m[1], m[2], m[3]), ctx) };
  if ((m = t.take(/\b(\d{1,2}):(\d{2})\b/))) return { start: to24(clockOf(m[1], m[2]), ctx) };
  if ((m = t.take(/\b(?:at|by|before) (\d{1,2})\b/))) return { start: to24(clockOf(m[1]), ctx) };
  return {};
}

export function takeDuration(t: Text): number | undefined {
  let m;
  if ((m = t.take(/\b(?:for |takes? |about |around |~)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b)?/))) return Math.round(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0));
  if ((m = t.take(/\b(?:for |takes? |about |around )?(\d+)\s*(?:minutes?|mins?|m)\b/))) return Number(m[1]);
  if (t.take(/\b(?:for |takes? )?(?:an|one) hour and a half\b/) || t.take(/\b(?:for |takes? )?(?:1|one|an) and a half hours?\b/)) return 90;
  if (t.take(/\b(?:for |takes? )?half an hour\b/)) return 30;
  if (t.take(/\b(?:for |takes? )?(?:an|one) hour\b/)) return 60;
  if (t.take(/\b(?:for |takes? )?two hours\b/)) return 120;
  return undefined;
}

// ---------- classification ----------

function taskType(s: string): TaskType | undefined {
  if (/\b(lab|write-?up|record|practical|journal)\b/.test(s)) return 'lab';
  if (/\b(exam prep|prepare for|prep for|revise for|revision for|mock test|pyq)\b/.test(s)) return 'examprep';
  if (/\b(assignment|homework|hw|worksheet|sheet|essay|report|submission|submit|project|tutorial)\b/.test(s)) return 'assignment';
  if (/\b(study|revise|revision|practice|practise|read|learn|notes|numericals|problems)\b/.test(s)) return 'study';
  if (/\b(course|nptel|coursera|udemy|module|program|programme|certificate|lecture videos?)\b/.test(s)) return 'course';
  if (/\b(club|committee|fest|team|society|event prep)\b/.test(s)) return 'club';
  return undefined;
}

function eventType(s: string): ItemType {
  if (/\b(exam|test|quiz|viva|midterm|mid-sem|endsem)\b/.test(s)) return 'exam';
  if (/\b(club|meeting|committee|fest|society)\b/.test(s)) return 'club';
  if (/\b(gym|workout|run|walk|football|cricket|swim|yoga|doctor|dentist|haircut|party|dinner|lunch|movie|family|friends|call)\b/.test(s)) return 'personal';
  const tt = taskType(s);
  return tt ?? 'event';
}

const FILLER = /\b(i need to|i have to|i've got to|i got to|i gotta|i must|need to|have to|please|can you|could you|jarvis|remind me to|i want to|i'd like to|let's|lets|add|schedule|put|create|set up|book|plan|new|also|okay|ok|hey|and then|so|my|an|a|the|do|finish|complete|work on|it's|its|is|there's|there is|i have|got)\b/g;

function cleanTitle(rest: string): string {
  let s = rest
    .replace(/\b(due|deadline|by|before|on|at|from|for|in the|this|next|every|each|till|until|is|to)\s*(?=[,.;!?]|$)/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\b(due|deadline)\b/g, ' ')
    .replace(/\b(on|at|by|from|for|in|this|before)\s*$/g, ' ')
    .replace(/[,.;:!?]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  s = s.replace(/^(on|at|by|for|to|from|in|is)\s+/, '').replace(/\s+(on|at|by|for|to|from|in|and|is)$/, '').trim();
  if (!s) return '';
  return s.replace(/\b(c|ac|dc|nptel|ai|ml|dsa|oop|os|cn|dbms|ui|ux|api)\b/g, w => w.toUpperCase()).replace(/^\w/, c => c.toUpperCase());
}

const ctxOf = (s: string) => ({ morning: /\b(morning|breakfast)\b|\d\s*am\b/.test(s), evening: /\b(evening|tonight|night|after college|after i come home)\b|\d\s*pm\b/.test(s) });

function tod(s: string): TimeOfDay | undefined {
  if (/\bmorning\b/.test(s)) return 'morning';
  if (/\bafternoon\b/.test(s)) return 'afternoon';
  if (/\b(evening|tonight|night)\b/.test(s)) return 'evening';
  return undefined;
}

// ---------- main ----------

export function parseRules(raw: string, st: State, nowS: string): RuleResult | null {
  const now = toT(nowS);
  const today = dateOf(now);
  const nowMin = minOfDay(now);
  const t = new Text(raw);
  const s = t.rest;
  const subj = canonicalSubject(st, s);
  const hi = (cmd: Command): RuleResult => ({ cmd, confidence: 'high' });

  // conflict follow-ups
  let m;
  if ((m = s.match(/\boption ([abcd])\b/)) || (m = s.match(/^\s*\(?([abcd])\)?\s*$/))) return hi({ kind: 'resolve', option: m[1] as 'a' });
  if (/\b(push|move|shift|delay) (my |the )?(sleep|bedtime|bed time)\b|\bafter i (come|get) (home|back)\b|\blater today\b|\bstay up\b/.test(s)) return hi({ kind: 'resolve', option: 'a' });
  if (/\bshorten (the |my )?(block|it)\b|\bshorter block\b/.test(s)) return hi({ kind: 'resolve', option: 'b' });
  if (/^\s*(ok(ay)?|yes|sure)?,?\s*swap\b/.test(s)) return hi({ kind: 'resolve', option: 'c' });
  if (/^\s*(ok(ay)?|yes|sure)?,?\s*(drop|skip) (it|that|the flexible one)\s*$/.test(s)) return hi({ kind: 'resolve', option: 'd' });

  if (/\b(panic|i'?m overwhelmed|only critical|emergency mode)\b/.test(s)) return hi({ kind: 'panic' });

  // ---- questions ----
  const isQ = /\?\s*$/.test(raw.trim()) || /^\s*(what|whats|what's|when|how|am i|do i|show|list|which|is there|tell me)\b/.test(s);
  if (isQ) {
    const q = (q: QueryKind, extra: Partial<Extract<Command, { kind: 'query' }>> = {}) => hi({ kind: 'query', q, ...extra });
    if (/\b(on track|behind|ahead)\b/.test(s)) return q('onTrack');
    if (/\b(how many|how much)\b.*\b(hours?|study|left)\b/.test(s) || /\bhours? left\b/.test(s)) return q('studyLeft', { subject: subj });
    if (/\b(due|deadlines?)\b/.test(s)) return q('dueWeek');
    if (/\bnext\b/.test(s)) return q('next');
    if (/\bfree\b|\bavailable\b|\bspare time\b/.test(s)) { const d = takeDate(t, today); return q('free', { date: d ?? today }); }
    const d = takeDate(t, today);
    if (d && d !== today) return q('day', { date: d });
    if (/\btoday\b|\bschedule\b|\bplan\b|\bdo i have\b|\bwhat'?s on\b|^\s*what'?s up\b/.test(s) || d === today) return q('today');
  }
  if (/^\s*(today|what'?s today|agenda)\s*$/.test(s)) return hi({ kind: 'query', q: 'today' });
  if (/^\s*(next|what'?s next)\s*$/.test(s)) return hi({ kind: 'query', q: 'next' });

  // ---- progress ----
  if ((m = s.match(/\b(?:that |it |this |which )?took(?: me)? (.+)$/))) {
    const tt = new Text(m[1]);
    const mins = takeDuration(tt);
    const target = s.replace(m[0], '').replace(/\b(that|it|this|which)\b/g, '').trim();
    if (mins) return hi({ kind: 'logTime', minutes: mins, target: target && target.length > 2 ? cleanTitle(target) : undefined });
  }
  if ((m = s.match(/\b(?:didn'?t|did not|couldn'?t|could not|wasn'?t able to|failed to) (?:finish|complete|do|get to|start)(?: with)? (.+)$/)) || (m = s.match(/\b(?:missed|skipped) (.+)$/))) {
    const tt = new Text(m[1]);
    const date = takeDate(tt, today);
    return hi({ kind: 'markNotDone', target: cleanTitle(tt.rest), date });
  }
  if ((m = s.match(/^\s*(?:i'?m |i am |i'?ve |i have )?(?:done|finished|completed|did)(?: with)? (.+)$/)) || (m = s.match(/^\s*(.+?) (?:is |are )?(?:done|finished|completed)\s*[.!]?\s*$/))) {
    const tt = new Text(m[1]);
    const all = /\b(all of|whole|entire|completely)\b/.test(m[1]);
    const date = takeDate(tt, today);
    const target = cleanTitle(tt.rest.replace(/\b(all of|whole|entire|completely)\b/g, ''));
    if (target) return hi({ kind: 'markDone', target, date, all });
  }

  // ---- edits ----
  if ((m = s.match(/\b(?:push|delay|shift|move) (?:everything|all|it all|the rest(?: of (?:the day|today))?)(?: (?:back|forward|later|earlier))? by (.+)$/)) || (m = s.match(/\b(?:i'?m|i am) running (.+?) late\b/))) {
    const mins = takeDuration(new Text(m[1]));
    if (mins) return hi({ kind: 'shiftAll', minutes: /earlier|forward/.test(s) ? -mins : mins });
  }
  if ((m = s.match(/\b(?:make|mark|set) (.+?) (?:as )?(critical|important|high priority|top priority|flexible|optional|low priority|normal|not critical)\b/)) || (m = s.match(/^\s*(.+?) is (critical|flexible|optional|not critical)\b/))) {
    const p: Priority = /critical|important|top|high/.test(m[2]) && !/not/.test(m[2]) ? 'critical' : /flexible|optional|low/.test(m[2]) ? 'flexible' : 'normal';
    return hi({ kind: 'setPriority', target: cleanTitle(m[1]), priority: p });
  }
  if ((m = s.match(/\b(?:cancel|delete|remove|drop|skip|scrap) (.+)$/))) {
    const tt = new Text(m[1]);
    const series = !!tt.take(/\b(?:all|every|whole|entire|the series|series|all future|recurring)\b/);
    const date = takeDate(tt, today);
    const target = cleanTitle(tt.rest.replace(/\b(sessions?|occurrences?|ones?)\b/g, ''));
    if (target) return hi({ kind: 'cancel', target, date: series ? undefined : date ?? (series ? undefined : today), scope: series ? 'series' : 'one' });
  }
  if ((m = s.match(/\b(?:move|reschedule|shift|push|postpone) (.+?) (?:to|till|until|for|on|into) (.+)$/))) {
    const target = cleanTitle(m[1]);
    const tt = new Text(m[2]);
    const date = takeDate(tt, today);
    const td = tod(tt.rest);
    const times = takeTimes(tt, { ...ctxOf(tt.rest), afterMin: date === today || !date ? nowMin : undefined });
    const d = date ?? today;
    const start = times.start !== undefined ? `${d}T${fmtHM(times.start)}` : undefined;
    const end = times.end !== undefined ? `${d}T${fmtHM(times.end)}` : undefined;
    if (target && (date || td || start)) return hi({ kind: 'move', target, date: d, timeOfDay: td, start, end });
  }
  if ((m = s.match(/\bplan (?:my )?(?:exam )?study(?: hours)?(?: for (.+))?/))) return hi({ kind: 'planStudy', subject: m[1] ? canonicalSubject(st, m[1]) ?? cleanTitle(m[1]) : undefined });

  // ---- block time ----
  if (/\b(clear|block|free up|keep free|i'?m busy|i am busy|i'?ll be busy|i will be busy|hold)\b/.test(s) && /\b(time|till|until|from|to|morning|afternoon|evening|\d)\b/.test(s)) {
    const reason = s.match(/\b(?:i have|i've got|i got|for|with|because|doing|have)\s+(.+?)(?:\s+(?:till|until|from|today|tomorrow)\b|[,.]|$)/);
    const date = takeDate(t, today) ?? today;
    const times = takeTimes(t, { ...ctxOf(s), afterMin: date === today ? nowMin : undefined });
    let start: number | undefined = times.start, end: number | undefined = times.end;
    if (times.until !== undefined) { end = times.until; start = date === today ? nowMin : hm(st.settings.wake); }
    if (start !== undefined && end === undefined) { end = start; start = date === today ? nowMin : hm(st.settings.wake); }
    if (end === undefined) {
      const td = tod(s);
      if (td === 'morning') { start = date === today ? Math.max(nowMin, hm(st.settings.wake)) : hm(st.settings.wake); end = 12 * 60; }
      else if (td === 'evening') { start = 17 * 60; end = hm(st.settings.bedtime); }
      else if (td === 'afternoon') { start = 12 * 60; end = 17 * 60; }
    }
    if (start !== undefined && end !== undefined) {
      if (end <= start) end += 12 * 60;
      const title = reason ? cleanTitle(reason[1].replace(/\b(work|stuff)\b$/, '$1')) : 'Busy';
      return hi({ kind: 'blockTime', title: title || 'Busy', start: `${date}T${fmtHM(start)}`, end: end >= 24 * 60 ? `${addDays(date, 1)}T${fmtHM(end)}` : `${date}T${fmtHM(end)}` });
    }
    return { cmd: { kind: 'clarify', question: 'Until what time should I clear?' }, confidence: 'low' };
  }

  // ---- recurring ----
  if (/\b(every|daily|each|weekdays|weekly|weeknights|on weekends|mon(?:day)? to fri(?:day)?)\b/.test(s)) {
    let freq: Extract<Command, { kind: 'addSeries' }>['freq'] = 'daily';
    let days: number[] | undefined;
    const untilM = t.take(new RegExp(`\\b(?:till|until|untill|through|thru|up to|upto|ending|ends|to)\\s+((?:the )?\\d{1,2}(?:st|nd|rd|th)?(?: of)? ${MON_RE}|${MON_RE} \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|tomorrow|next ${WD_RE}|${WD_RE}|end of (?:the )?(?:week|month))\\b`));
    let until: string | undefined;
    if (untilM) {
      if (/end of (the )?week/.test(untilM[1])) until = addDays(today, (7 - weekday(today)) % 7);
      else if (/end of (the )?month/.test(untilM[1])) { const [y, mo] = today.split('-').map(Number); until = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); }
      else until = takeDate(new Text(untilM[1]), today);
    }
    const countM = t.take(/\b(?:for )?(\d+) (?:times|sessions|days|occurrences)\b/);
    const weeksM = !countM && t.take(/\bfor (\d+|two|three|four) weeks\b/);
    if (t.take(/\b(?:every ?day|daily|each day|every night|nightly)\b/)) freq = 'daily';
    else if (t.take(/\b(?:every weekday|weekdays|on weekdays|each weekday|weeknights|every weeknight|mon(?:day)? to fri(?:day)?|monday through friday)\b/)) freq = 'weekdays';
    else if (t.take(/\b(?:every weekend|weekends|on weekends|every sat(?:urday)? and sun(?:day)?)\b/)) { freq = 'days'; days = [0, 6]; }
    else {
      const ds = [...s.matchAll(new RegExp(`\\b${WD_RE}s?\\b`, 'g'))].map(x => WD[x[1].slice(0, 3)]);
      if (ds.length) { freq = ds.length === 1 && /\bweekly\b|\bevery week\b/.test(s) ? 'weekly' : 'days'; days = [...new Set(ds)].sort(); t.rest = t.rest.replace(new RegExp(`\\b(?:every |on |and |, )*${WD_RE}s?\\b`, 'g'), ' '); }
      else if (t.take(/\b(?:weekly|every week)\b/)) { freq = 'weekly'; days = [weekday(today)]; }
    }
    t.take(/\b(?:every|each)\b/);
    const startDate = takeDate(t, today);
    const times = takeTimes(t, ctxOf(s));
    if (times.start === undefined) return { cmd: { kind: 'clarify', question: 'What time should it repeat?' }, confidence: 'low' };
    const dur = takeDuration(t);
    const end = times.end ?? times.start + (dur ?? 60);
    const title = cleanTitle(t.rest.replace(/\bstarting\b|\bfrom\b/g, ' '));
    if (!title) return { cmd: { kind: 'clarify', question: 'What should I call it?' }, confidence: 'low' };
    const words = ['two', 'three', 'four'];
    const count = countM ? Number(countM[1]) : undefined;
    if (weeksM) until = addDays(startDate ?? today, 7 * (Number(weeksM[1]) || words.indexOf(weeksM[1]) + 2) - 1);
    return hi({ kind: 'addSeries', title, subject: canonicalSubject(st, title) ?? subj, type: eventType(title.toLowerCase()) === 'event' ? 'study' : eventType(title.toLowerCase()), startTime: fmtHM(times.start), endTime: fmtHM(end % (24 * 60)), freq, days, startDate, until, count });
  }

  // ---- tasks with deadlines ----
  const hasDue = /\b(due|deadline|submit|submission|by|before|hand in)\b/.test(s);
  const tt = taskType(s);
  const timesAt = /\b(at|from|between)\b|\d\s*(am|pm)\b|\d:\d\d|\bto \d/.test(s);
  if (hasDue || (tt && tt !== 'club' && !timesAt) || /\b(remind me to|i need to|i have to|need to)\b/.test(s) && !timesAt) {
    const est = takeDuration(t);
    const date = takeDate(t, today);
    const times = takeTimes(t, { ...ctxOf(s), afterMin: date === today ? nowMin : undefined });
    const crit = !!t.take(/\b(critical|very important|important|graded|compulsory|mandatory|absence means zero)\b/);
    const title = cleanTitle(t.rest);
    if (!title) return { cmd: { kind: 'clarify', question: 'What is the task called?' }, confidence: 'low' };
    if (!date && !tt) return { cmd: { kind: 'capture', text: raw.trim() }, confidence: 'low' };
    const dueMin = times.start ?? times.until;
    const due = date ? `${date}T${dueMin !== undefined ? fmtHM(dueMin) : '23:59'}` : undefined;
    return {
      cmd: { kind: 'addTask', title, subject: canonicalSubject(st, title) ?? subj, type: tt ?? 'personal', due, estimateMin: est, priority: crit ? 'critical' : undefined, preferredTime: tod(s) },
      confidence: date ? 'high' : 'low',
    };
  }

  // ---- fixed events ----
  const date = takeDate(t, today);
  const times = takeTimes(t, { ...ctxOf(s), afterMin: (date ?? today) === today ? nowMin : undefined });
  if (times.start !== undefined || times.until !== undefined) {
    const d = date ?? today;
    const s0 = times.start ?? nowMin;
    const dur = takeDuration(t);
    const e0 = times.end ?? times.until ?? s0 + (dur ?? 60);
    const title = cleanTitle(t.rest);
    if (!title) return { cmd: { kind: 'clarify', question: 'What is it called?' }, confidence: 'low' };
    const type = eventType(s);
    const end = e0 >= 24 * 60 ? `${addDays(d, 1)}T${fmtHM(e0)}` : `${d}T${fmtHM(e0)}`;
    const crit = /\b(critical|important|graded|exam|test|viva)\b/.test(s);
    return hi({ kind: 'addEvent', title, type, subject: canonicalSubject(st, title) ?? subj, start: `${d}T${fmtHM(s0)}`, end, priority: crit ? 'critical' : undefined });
  }
  if (date && /\b(add|schedule|put)\b/.test(s)) {
    const title = cleanTitle(t.rest);
    return { cmd: { kind: 'clarify', question: `What time is ${title || 'it'}?` }, confidence: 'low' };
  }

  // nothing recognised: Inbox capture (low confidence so the AI may try first)
  return { cmd: { kind: 'capture', text: raw.trim().replace(/^(add|note|remember|inbox)[:\s]+/i, '') }, confidence: 'low' };
}

/** Merge a short answer ("Thursday 5 pm") into a partial command from a clarifying question. */
export function mergeAnswerRules(partial: Command, answer: string, st: State, nowS: string): Command | null {
  const now = toT(nowS);
  const today = dateOf(now);
  const t = new Text(answer);
  const date = takeDate(t, today);
  const times = takeTimes(t, { ...ctxOf(t.rest), afterMin: (date ?? today) === today ? minOfDay(now) : undefined });
  switch (partial.kind) {
    case 'addTask': {
      if (!date && times.start === undefined) return null;
      const d = date ?? today;
      return { ...partial, due: `${d}T${times.start !== undefined ? fmtHM(times.start) : '23:59'}` };
    }
    case 'addEvent': case 'blockTime': {
      const d = date ?? partial.start.slice(0, 10);
      if (times.start === undefined) return date ? { ...partial, start: `${d}T${partial.start.slice(11)}`, end: `${d}T${partial.end.slice(11)}` } : null;
      const s = times.start, e = times.end ?? (times.start > hm(partial.start.slice(11)) ? times.start : s + 60);
      return times.end !== undefined ? { ...partial, start: `${d}T${fmtHM(s)}`, end: `${d}T${fmtHM(e)}` } : { ...partial, end: `${d}T${fmtHM(s)}` };
    }
    case 'addSeries':
      if (times.start === undefined) return null;
      return { ...partial, startTime: fmtHM(times.start), endTime: fmtHM(times.end ?? times.start + 60) };
    case 'markDone': case 'markNotDone': case 'cancel': case 'move': case 'setPriority':
      return { ...partial, target: cleanTitle(answer) || answer };
    default:
      void st;
      return null;
  }
}
