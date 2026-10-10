// Speech recognition (one phrase at a time) and yes/no detection for confirmations.

type SRResultList = ArrayLike<ArrayLike<{ transcript: string }>>;
type SR = {
  start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: SRResultList }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};

const SRClass = (): (new () => SR) | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const BLOCKED_KEY = 'jarvis-mic-blocked';
export function micAvailable(): boolean {
  if (!SRClass()) return false;
  try { return localStorage.getItem(BLOCKED_KEY) !== '1'; } catch { return true; }
}

export interface ListenHandlers {
  onText?: (t: string) => void;          // interim transcript
  onDone: (t: string) => void;           // final transcript ('' if nothing heard)
  onError?: (code: string) => void;
}

/** Listen for one phrase. Returns a function that stops listening early. */
export function listenOnce(h: ListenHandlers): () => void {
  const C = SRClass();
  if (!C) { h.onError?.('unsupported'); return () => {}; }
  let heard = '';
  let failed = false;
  let r: SR;
  try {
    r = new C();
    r.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = e => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      heard = t;
      h.onText?.(t);
    };
    r.onerror = e => { failed = true; h.onError?.(e.error); };
    r.onend = () => { if (!failed) h.onDone(heard.trim()); };
    r.start();
  } catch (e) {
    h.onError?.(String((e as Error).message ?? e));
    return () => {};
  }
  return () => { try { r.stop(); } catch { /* ignore */ } };
}

// ---------- yes / no ----------

const norm = (t: string) => t.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const AFFIRM = /^(yes|yeah|yea|yep|yup|ya|yah|ok|okay|okey|k|sure|alright|all right|go ahead|go for it|do it|do that|apply|confirm|confirmed|sounds good|looks good|perfect|make it so|please|fine|great|cool|absolutely|definitely|correct|right|done|yes sir|affirmative|of course|let's do it|lets do it)\b/;
const NEGATE = /\b(no|not|don't|dont|cancel|wait|stop|nope|nah|never)\b/;
// words that mean the reply is really a change or an option, not a plain yes
const CHANGE = /\b(push|move|add|option|instead|later|earlier|tomorrow|today|shorten|swap|drop|skip|but|change|make|at|to)\b/;

export function isYes(t: string): boolean {
  const s = norm(t);
  if (!s || s.split(' ').length > 7) return false;
  return AFFIRM.test(s) && !NEGATE.test(s) && !CHANGE.test(s.replace('make it so', ''));
}

export function isNo(t: string): boolean {
  const s = norm(t);
  if (!s || s.split(' ').length > 5) return false;
  return /^(no|nope|nah|na|cancel|never ?mind|stop|scrap (it|that)|forget it|don't|dont|leave it|not now)\b/.test(s);
}
