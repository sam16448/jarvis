// LLM interpreter: text -> Command JSON only. The model never sees or edits the schedule
// beyond item titles (so it can name a target); the deterministic scheduler does the rest.
import { addDays, dateOf, toT, WEEKDAYS, weekday } from '../engine/time';
import { TASK_TYPES, type Command, type Settings, type State } from '../engine/types';

export interface LLMProvider {
  id: Settings['llm']['provider'];
  label: string;
  defaultModel: string;
  keyUrl: string;
  /** json=true asks for a JSON object; otherwise plain text. */
  call(key: string, model: string, system: string, user: string, signal: AbortSignal, opts?: { json?: boolean; temperature?: number }): Promise<string>;
}

export const PROVIDERS: Record<'gemini' | 'groq', LLMProvider> = {
  gemini: {
    id: 'gemini', label: 'Google Gemini (free tier)', defaultModel: 'gemini-flash-latest', keyUrl: 'https://aistudio.google.com/apikey',
    async call(key, model, system, user, signal, opts = { json: true }) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: opts.temperature ?? 0, responseMimeType: opts.json === false ? 'text/plain' : 'application/json' },
        }),
      });
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      return j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    },
  },
  groq: {
    id: 'groq', label: 'Groq (free tier)', defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys',
    async call(key, model, system, user, signal, opts = { json: true }) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: opts.temperature ?? 0, ...(opts.json === false ? {} : { response_format: { type: 'json_object' } }), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      return j?.choices?.[0]?.message?.content ?? '';
    },
  },
};

export function systemPrompt(st: State, nowS: string, conflictOpen: boolean): string {
  const today = dateOf(toT(nowS));
  const days = Array.from({ length: 8 }, (_, i) => `${WEEKDAYS[weekday(addDays(today, i))]} ${addDays(today, i)}`).join(', ');
  const titles = [...new Set([
    ...st.tasks.filter(t => t.status === 'open').map(t => t.title),
    ...st.series.map(s => s.title),
    ...st.events.filter(e => e.start >= today && e.start <= addDays(today, 7)).map(e => e.title),
    ...st.exams.map(e => e.title),
  ])].slice(0, 60);
  return `You convert one message from a student into ONE JSON command for a scheduling app. Output JSON only.
Now: ${nowS} (${WEEKDAYS[weekday(today)]}). Next days: ${days}.
Times are local, format "YYYY-MM-DDTHH:mm" (24h). Dates "YYYY-MM-DD". Bare times like "5 to 8" with no am/pm are evening unless "morning".
Subjects: ${st.settings.subjects.map(s => `${s.name} (${s.aliases.join(', ')})`).join('; ')}.
Existing items (use these names as "target" when the user refers to them): ${titles.join(' | ') || 'none'}.
${conflictOpen ? 'A conflict question is open with options a) later today, push bedtime b) shorten the block c) swap with lower-priority item d) drop a flexible item. Replies choosing one -> {"kind":"resolve","option":"a"|"b"|"c"|"d"}; if they name a time for doing it later today (e.g. "add it from 11 pm and push my sleep") add "start":"YYYY-MM-DDTHH:mm".' : ''}
Commands (pick exactly one "kind"):
- addTask {title, subject?, type: ${TASK_TYPES.join('|')}, due: datetime (end of day 23:59 if no time), estimateMin?, priority?: "critical" if graded/zero-if-absent/user says critical}
- addEvent {title, type?: event|exam|club|personal|study|assignment, subject?, start, end (default 1 hour), priority?}
- addSeries {title, type?, subject?, startTime "HH:mm", endTime "HH:mm", freq: daily|weekdays|weekly|days, days?: [0-6 Sun=0], startDate?, until?: date, count?: number}
- blockTime {title (the reason, e.g. "Hackathon work"), start (now if "till X"), end}
- markDone {target, date?, all?: true if the whole task is finished}
- markNotDone {target, date?}
- logTime {target?, minutes}  ("that took 2 hours")
- query {q: today|next|dueWeek|studyLeft|onTrack|free|day, subject?, date?}
- move {target, date?, timeOfDay?: morning|afternoon|evening, start?, end?}
- cancel {target, date?, scope?: one|series}
- setPriority {target, priority: critical|high|normal|flexible}
- shiftAll {minutes (negative = earlier)}
- planStudy {subject?}
- panic {}
- capture {text}  (a note with no time, e.g. "buy a calculator")
- clarify {question}  (ONE short question if the date or the item is unclear; never guess a missing date for a deadline)
Example: "I need to do my History essay, due Thursday" -> {"kind":"addTask","title":"History essay","subject":"History","type":"assignment","due":"<that Thursday>T23:59"}`;
}

const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const D = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;
const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/** Strictly validate model output; returns a clean Command or null. */
export function validateCommand(x: unknown): Command | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as Record<string, unknown>;
  const opt = (k: string, re: RegExp) => c[k] === undefined || c[k] === null || (typeof c[k] === 'string' && re.test(c[k] as string));
  for (const k of Object.keys(c)) if (c[k] === null) delete c[k];
  switch (c.kind) {
    case 'addTask': return str(c.title) && opt('due', DT) && (c.type === undefined || (TASK_TYPES as string[]).includes(c.type as string)) ? c as Command : null;
    case 'addEvent': return str(c.title) && DT.test(String(c.start)) && DT.test(String(c.end)) ? c as Command : null;
    case 'addSeries': return str(c.title) && HM.test(String(c.startTime)) && HM.test(String(c.endTime)) && ['daily', 'weekdays', 'weekly', 'days'].includes(String(c.freq)) && opt('until', D) && opt('startDate', D) ? c as Command : null;
    case 'blockTime': return str(c.title) && DT.test(String(c.start)) && DT.test(String(c.end)) ? c as Command : null;
    case 'markDone': case 'markNotDone': case 'cancel': return str(c.target) && opt('date', D) ? c as Command : null;
    case 'move': return str(c.target) && opt('date', D) && opt('start', DT) && opt('end', DT) ? c as Command : null;
    case 'setPriority': return str(c.target) && ['critical', 'high', 'normal', 'flexible'].includes(String(c.priority)) ? c as Command : null;
    case 'logTime': return typeof c.minutes === 'number' && c.minutes > 0 ? c as Command : null;
    case 'query': return ['today', 'next', 'dueWeek', 'studyLeft', 'onTrack', 'free', 'day'].includes(String(c.q)) && opt('date', D) ? c as Command : null;
    case 'shiftAll': return typeof c.minutes === 'number' ? c as Command : null;
    case 'resolve': return ['a', 'b', 'c', 'd'].includes(String(c.option)) && opt('start', DT) ? c as Command : null;
    case 'capture': return str(c.text) ? c as Command : null;
    case 'clarify': return str(c.question) ? c as Command : null;
    case 'panic': return { kind: 'panic' };
    case 'planStudy': return c as Command;
    default: return null;
  }
}

export async function llmInterpret(text: string, st: State, nowS: string, conflictOpen: boolean, timeoutMs = 9000): Promise<Command> {
  const cfg = st.settings.llm;
  if (cfg.provider === 'none' || !cfg.key) throw new Error('No AI key set');
  const prov = PROVIDERS[cfg.provider];
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const raw = await prov.call(cfg.key, cfg.model || prov.defaultModel, systemPrompt(st, nowS, conflictOpen), text, ac.signal);
    const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const cmd = validateCommand(JSON.parse(json));
    if (!cmd) throw new Error('AI returned an unexpected command');
    return cmd;
  } finally {
    clearTimeout(t);
  }
}

/** Free-form text from the configured provider (used for spoken briefings). */
export async function llmText(st: State, system: string, user: string, timeoutMs = 12000): Promise<string> {
  const cfg = st.settings.llm;
  if (cfg.provider === 'none' || !cfg.key) throw new Error('No AI key set');
  const prov = PROVIDERS[cfg.provider];
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const out = (await prov.call(cfg.key, cfg.model || prov.defaultModel, system, user, ac.signal, { json: false, temperature: 0.9 })).trim();
    if (!out) throw new Error('AI returned nothing');
    return out;
  } finally {
    clearTimeout(t);
  }
}
