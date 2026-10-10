import { useRef, useState } from 'react';
import { listVoices, ttsSupported } from '../voice/speak';
import { useApp } from '../store/store';

type SR = { start(): void; stop(): void; lang: string; interimResults: boolean; continuous: boolean;
  onstart: (() => void) | null; onaudiostart: (() => void) | null; onspeechstart: (() => void) | null; onend: (() => void) | null;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null };

/** On-screen diagnostics for speaking and listening, so problems on a real phone can be seen. */
export function VoiceCheck() {
  const { st } = useApp();
  const [log, setLog] = useState<string[]>([]);
  const t0 = useRef(0);
  const add = (m: string) => setLog(l => [...l, `${((performance.now() - t0.current) / 1000).toFixed(1)}s ${m}`]);

  const env = () => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const vs = listVoices();
    const W = window as unknown as Record<string, unknown>;
    return [
      `Version ${__BUILD__}`,
      `Home Screen app: ${nav.standalone || matchMedia('(display-mode: standalone)').matches ? 'yes' : 'no'}`,
      `Speech output: ${ttsSupported() ? `yes, ${vs.length} English voices${vs.length ? ` (${vs.slice(0, 3).map(v => v.name).join(', ')})` : ''}` : 'NO'}`,
      `Speech input: ${W.SpeechRecognition ? 'SpeechRecognition' : W.webkitSpeechRecognition ? 'webkitSpeechRecognition' : 'NO'}`,
      `Jarvis talks back: ${st!.settings.voice.enabled ? 'on' : 'OFF'}, voice: ${st!.settings.voice.voiceURI || 'automatic'}`,
    ];
  };

  // must start synchronously inside the tap for iOS
  const testSpeak = () => {
    t0.current = performance.now();
    setLog(env());
    const s = window.speechSynthesis;
    if (!s) { add('speech output not available'); return; }
    const u = new SpeechSynthesisUtterance('Voice check. If you can hear this, Jarvis can talk.');
    u.lang = 'en-GB';
    u.onstart = () => add('speak: started');
    u.onend = () => add('speak: finished');
    u.onerror = e => add(`speak: ERROR ${(e as SpeechSynthesisErrorEvent).error}`);
    s.speak(u);
    add(`speak: queued (speaking=${s.speaking}, pending=${s.pending})`);
    setTimeout(() => add(`after 4s: speaking=${s.speaking}, pending=${s.pending}`), 4000);
  };

  const testListen = () => {
    t0.current = performance.now();
    setLog(env());
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!C) { add('speech input not available here'); return; }
    try {
      const r = new C();
      r.lang = navigator.language || 'en-IN';
      r.interimResults = true;
      r.continuous = false;
      r.onstart = () => add('listen: started, say something');
      r.onaudiostart = () => add('listen: microphone on');
      r.onspeechstart = () => add('listen: hearing speech');
      r.onresult = e => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; add(`listen: heard “${t}”`); };
      r.onerror = e => add(`listen: ERROR ${e.error}`);
      r.onend = () => add('listen: ended');
      r.start();
      add('listen: start() called');
      setTimeout(() => { try { r.stop(); } catch { /* ignore */ } }, 8000);
    } catch (e) { add(`listen: failed to start: ${String((e as Error).message ?? e)}`); }
  };

  return (
    <div className="stack">
      <div className="row">
        <button className="btn grow" onClick={testSpeak}>Test Speaking</button>
        <button className="btn grow" onClick={testListen}>Test Listening</button>
      </div>
      {log.length > 0 && (
        <pre className="tiny" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontFamily: 'ui-monospace, Menlo, monospace' }} aria-live="polite">
          {log.join('\n')}
        </pre>
      )}
      {log.length > 0 && <p className="tiny muted">Screenshot this box and send it if voice isn’t working.</p>}
    </div>
  );
}
