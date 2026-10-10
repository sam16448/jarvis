// Free weather from Open-Meteo (no key, no account). Only rounded coordinates are sent.

export interface Weather { place: string; desc: string; nowC?: number; maxC: number; minC: number; rainPct?: number; }

const CODES: [number[], string][] = [
  [[0], 'clear skies'], [[1], 'mostly clear'], [[2], 'partly cloudy'], [[3], 'overcast'],
  [[45, 48], 'foggy'], [[51, 53, 55, 56, 57], 'drizzle'], [[61, 63, 66], 'rain'], [[65, 67], 'heavy rain'],
  [[71, 73, 75, 77], 'snow'], [[80, 81], 'showers'], [[82], 'heavy showers'], [[85, 86], 'snow showers'],
  [[95], 'thunderstorms'], [[96, 99], 'thunderstorms with hail'],
];

export function describeCode(code: number): string {
  return CODES.find(([cs]) => cs.includes(code))?.[1] ?? 'mixed weather';
}

export const round2 = (x: number) => Math.round(x * 100) / 100;

export async function geocode(name: string): Promise<{ place: string; lat: number; lon: number }> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(name.trim())}`);
  if (!r.ok) throw new Error(`Place lookup failed (${r.status})`);
  const j = await r.json();
  const g = j?.results?.[0];
  if (!g) throw new Error(`Couldn't find “${name}”. Try a nearby city.`);
  return { place: g.name, lat: round2(g.latitude), lon: round2(g.longitude) };
}

/** Today's weather for a location; `date` is YYYY-MM-DD in local time. */
export async function fetchWeather(lat: number, lon: number, place: string, date: string, signal?: AbortSignal): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${round2(lat)}&longitude=${round2(lon)}&timezone=auto&forecast_days=3`
    + '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max';
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Weather unavailable (${r.status})`);
  const j = await r.json();
  const d = j.daily;
  let i = (d?.time as string[] | undefined)?.indexOf(date) ?? -1;
  if (i < 0) i = 0;
  return {
    place,
    desc: describeCode(d.weather_code[i]),
    nowC: typeof j.current?.temperature_2m === 'number' ? Math.round(j.current.temperature_2m) : undefined,
    maxC: Math.round(d.temperature_2m_max[i]),
    minC: Math.round(d.temperature_2m_min[i]),
    rainPct: typeof d.precipitation_probability_max?.[i] === 'number' ? d.precipitation_probability_max[i] : undefined,
  };
}

export function weatherLine(w: Weather): string {
  const rain = w.rainPct !== undefined && w.rainPct >= 40 ? `, ${w.rainPct}% chance of rain` : '';
  return `${w.place}: ${w.desc}, ${w.nowC !== undefined ? `${w.nowC}°C now, ` : ''}high ${w.maxC}°C, low ${w.minC}°C${rain}`;
}
