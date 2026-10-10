// Floating local time. All stored times are 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' with no zone.
// Internally we use T = minutes since 1970-01-01 00:00 (floating), so arithmetic is exact
// and independent of the machine's time zone.

export type T = number;
export const DAY = 1440;

export function dayNum(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function dateOfDay(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

/** 'HH:mm' -> minutes. Accepts '24:00'. */
export function hm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** minutes (any) -> 'HH:mm' wrapped to a day */
export function fmtHM(min: number): string {
  const m = ((Math.round(min) % DAY) + DAY) % DAY;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function toT(s: string): T {
  const [d, t] = s.split('T');
  return dayNum(d) * DAY + (t ? hm(t) : 0);
}

export function fromT(t: T): string {
  const d = Math.floor(t / DAY);
  return `${dateOfDay(d)}T${fmtHM(t - d * DAY)}`;
}

export const dateOf = (t: T): string => dateOfDay(Math.floor(t / DAY));
export const minOfDay = (t: T): number => t - Math.floor(t / DAY) * DAY;
export const timeOf = (t: T): string => fmtHM(minOfDay(t));

/** 0 = Sunday ... 6 = Saturday */
export function weekday(date: string): number {
  return (((dayNum(date) + 4) % 7) + 7) % 7;
}

export function addDays(date: string, n: number): string {
  return dateOfDay(dayNum(date) + n);
}

export function daysBetween(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}

/** T for a clock time on a date. */
export function at(date: string, hhmm: string): T {
  return dayNum(date) * DAY + hm(hhmm);
}

/** T for a night-time clock on `date`'s evening: times before noon are the next morning. */
export function nightAt(date: string, hhmm: string): T {
  const m = hm(hhmm);
  return dayNum(date) * DAY + (m < 12 * 60 ? m + DAY : m);
}

/** End time that may wrap past midnight relative to a start. */
export function endAt(date: string, startHM: string, endHM: string): T {
  const s = at(date, startHM);
  let e = at(date, endHM);
  if (e <= s) e += DAY;
  return e;
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = dayNum(from); n <= dayNum(to); n++) out.push(dateOfDay(n));
  return out;
}

/** Current local floating time from a JS Date. */
export function localNow(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const roundUp = (t: T, step: number) => Math.ceil(t / step) * step;
export const roundDown = (t: T, step: number) => Math.floor(t / step) * step;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 12-hour clock, e.g. 7:05 pm */
export function clock(t: T | string): string {
  const m = typeof t === 'string' ? (t.includes('T') ? minOfDay(toT(t)) : hm(t)) : minOfDay(t);
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(mm)} ${h < 12 ? 'am' : 'pm'}`;
}

export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${WD[weekday(date)]} ${d} ${MON[m - 1]}`;
}

export function dayLabel(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return shortDate(date);
}

/** Compact time range: "7:00-8:30 pm", "11:30 am-1:00 pm" */
export function range(s: T, e: T): string {
  const a = clock(s), b = clock(e);
  if (a.slice(-2) === b.slice(-2)) return `${a.slice(0, -3)}-${b}`;
  return `${a}-${b}`;
}

export function dur(min: number): string {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const WEEKDAYS = WD;
export const MONTHS = MON;
