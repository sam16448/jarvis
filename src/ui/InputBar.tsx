import { Microphone, PaperPlaneRight } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { setInput, submitText, useBus } from './bus';

type SR = { start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SRClass: (new () => SR) | undefined = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

export function InputBar() {
  const { input, thinking, focusSeq } = useBus();
  const ref = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const rec = useRef<SR | null>(null);
  const heard = useRef('');

  useEffect(() => { if (focusSeq) ref.current?.focus(); }, [focusSeq]);

  const startTalk = () => {
    if (!SRClass || listening) return;
    try {
      const r = new SRClass();
      r.lang = navigator.language || 'en-IN';
      r.interimResults = true;
      r.continuous = true;
      heard.current = '';
      r.onresult = e => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        heard.current = t;
        setInput(t);
      };
      r.onerror = () => setListening(false);
      r.onend = () => {
        setListening(false);
        if (heard.current.trim()) submitText(heard.current);
      };
      rec.current = r;
      r.start();
      setListening(true);
    } catch { setListening(false); }
  };
  const stopTalk = () => { rec.current?.stop(); };

  return (
    <form className="ask" onSubmit={e => { e.preventDefault(); submitText(input); ref.current?.blur(); }} role="search">
      <label htmlFor="ask" className="sr-only">Speak or type</label>
      <input
        id="ask" ref={ref} name="ask" type="text" value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={thinking ? 'Thinking…' : listening ? 'Listening…' : 'Speak or type…'}
        autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck enterKeyHint="send"
        disabled={thinking}
      />
      {input.trim() ? (
        <button type="submit" className="mic" aria-label="Send" disabled={thinking}><PaperPlaneRight size={22} weight="fill" aria-hidden="true" /></button>
      ) : SRClass ? (
        <button
          type="button" className={`mic${listening ? ' on' : ''}`} aria-label="Hold to talk" aria-pressed={listening}
          onPointerDown={e => { e.preventDefault(); startTalk(); }}
          onPointerUp={stopTalk} onPointerCancel={stopTalk} onPointerLeave={() => listening && stopTalk()}
          onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !listening) startTalk(); }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') stopTalk(); }}
          onContextMenu={e => e.preventDefault()}
        >
          <Microphone size={24} weight={listening ? 'fill' : 'regular'} aria-hidden="true" />
        </button>
      ) : null}
    </form>
  );
}
