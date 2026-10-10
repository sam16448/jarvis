import { Microphone, PaperPlaneRight, Stop } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '../store/store';
import { stopSpeaking } from '../voice/speak';
import { setInput, submitText, useBus } from './bus';

type SRResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
type SR = {
  start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: SRResultList }) => void) | null; onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null; onstart: (() => void) | null;
};
const SRClass: (new () => SR) | undefined = (window as unknown as { SpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

const BLOCKED_KEY = 'jarvis-mic-blocked';
const blockedBefore = () => { try { return localStorage.getItem(BLOCKED_KEY) === '1'; } catch { return false; } };

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is off for Jarvis. Use the mic on the keyboard instead, or allow the microphone in iPhone Settings.',
  'service-not-allowed': 'This iPhone doesn’t allow speech recognition inside Home Screen apps. Use the mic on the keyboard instead.',
  'audio-capture': 'No microphone found. Use the mic on the keyboard instead.',
  'network': 'Speech recognition needs internet. Use the mic on the keyboard instead.',
};

export function InputBar() {
  const { input, thinking, focusSeq } = useBus();
  const ref = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const [available, setAvailable] = useState(() => !!SRClass && !blockedBefore());
  const rec = useRef<SR | null>(null);
  const heard = useRef('');
  const failed = useRef(false);
  const silentEnds = useRef(0);

  useEffect(() => { if (focusSeq) ref.current?.focus(); }, [focusSeq]);

  const fallback = (msg: string, permanent: boolean) => {
    toast(msg);
    if (permanent) { try { localStorage.setItem(BLOCKED_KEY, '1'); } catch { /* ignore */ } setAvailable(false); }
    ref.current?.focus(); // opens the keyboard so its mic can be used
  };

  const start = () => {
    if (!SRClass || listening) return;
    stopSpeaking();
    try {
      const r = new SRClass();
      r.lang = navigator.language || 'en-IN';
      r.interimResults = true;
      r.continuous = false;      // stops by itself after a pause (most reliable on iPhone)
      r.maxAlternatives = 1;
      heard.current = '';
      failed.current = false;
      r.onresult = e => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        heard.current = t;
        setInput(t);
      };
      r.onerror = e => {
        failed.current = true;
        setListening(false);
        if (e.error === 'no-speech' || e.error === 'aborted') { toast('Didn’t catch that. Tap the mic and try again.'); return; }
        fallback(ERRORS[e.error] ?? `Voice input failed (${e.error}). Use the mic on the keyboard instead.`, e.error === 'service-not-allowed' || e.error === 'not-allowed');
      };
      r.onend = () => {
        setListening(false);
        if (failed.current) return;
        if (heard.current.trim()) { silentEnds.current = 0; submitText(heard.current); return; }
        // ended without hearing anything and without an error (common in iPhone Home Screen apps)
        silentEnds.current++;
        if (silentEnds.current >= 2) fallback('The mic button isn’t picking you up on this phone. Use the mic on the keyboard instead: tap “Speak or type”, then the keyboard mic.', true);
        else toast('Didn’t hear anything. Tap the mic, speak right away, then pause.');
      };
      rec.current = r;
      r.start();
      setListening(true);
    } catch (err) {
      setListening(false);
      fallback(`Voice input isn’t available here (${String((err as Error).message ?? err).slice(0, 60)}). Use the mic on the keyboard instead.`, true);
    }
  };
  const stop = () => rec.current?.stop();

  return (
    <form className="ask" onSubmit={e => { e.preventDefault(); submitText(input); ref.current?.blur(); }} role="search">
      <label htmlFor="ask" className="sr-only">Speak or type</label>
      <input
        id="ask" ref={ref} name="ask" type="text" value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={thinking ? 'Thinking…' : listening ? 'Listening… pause when done' : 'Speak or type…'}
        autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck enterKeyHint="send"
        disabled={thinking}
      />
      {input.trim() && !listening ? (
        <button type="submit" className="mic" aria-label="Send" disabled={thinking}><PaperPlaneRight size={22} weight="fill" aria-hidden="true" /></button>
      ) : available ? (
        <button type="button" className={`mic${listening ? ' on' : ''}`} aria-label={listening ? 'Stop listening' : 'Tap to talk'} aria-pressed={listening}
          onClick={() => (listening ? stop() : start())}>
          {listening ? <Stop size={22} weight="fill" aria-hidden="true" /> : <Microphone size={24} aria-hidden="true" />}
        </button>
      ) : null}
    </form>
  );
}
