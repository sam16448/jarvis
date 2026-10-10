// Voice controller: speaks replies and briefings using the user's voice settings.
import type { PlanResult } from '../engine/types';
import { dateOf, toT } from '../engine/time';
import { getApp, meta, setMeta } from '../store/store';
import { makeBriefing, morningFacts, nightFacts, type Briefing } from './briefing';
import { replyFor } from './persona';
import { speak, stopSpeaking } from './speak';
import { fetchWeather, type Weather } from './weather';

export function say(text: string) {
  const st = getApp().st;
  if (!st) return Promise.resolve();
  return speak(text, st.settings.voice);
}

export const address = () => getApp().st?.settings.voice.address || 'boss';

export function sayReply(r: PlanResult | undefined): Promise<void> {
  return r ? say(replyFor(r, address())) : Promise.resolve();
}

let wCache: { key: string; w?: Weather } | null = null;
export async function todaysWeather(): Promise<Weather | undefined> {
  const st = getApp().st;
  const wcfg = st?.settings.weather;
  if (!st || !wcfg || wcfg.lat === undefined || wcfg.lon === undefined) return undefined;
  const date = dateOf(toT(getApp().now));
  const key = `${date}|${wcfg.lat}|${wcfg.lon}`;
  if (wCache?.key === key) return wCache.w;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 6000);
    const w = await fetchWeather(wcfg.lat, wcfg.lon, wcfg.place, date, ac.signal);
    clearTimeout(t);
    wCache = { key, w };
    return w;
  } catch {
    return undefined;
  }
}

/** Today's briefing text, cached per day so reopening doesn't spend AI quota. */
export async function getBriefing(kind: 'morning' | 'night', fresh = false): Promise<Briefing> {
  const st = getApp().st!;
  const now = getApp().now;
  const key = `brief-${kind}-${dateOf(toT(now))}`;
  if (!fresh) {
    const cached = await meta<Briefing>(key);
    if (cached?.text) return cached;
  }
  const facts = kind === 'morning' ? morningFacts(st, now, await todaysWeather()) : nightFacts(st, now);
  const b = await makeBriefing(st, facts, true);
  if (b.source === 'ai') await setMeta(key, b);
  return b;
}

export { stopSpeaking };
