// Text-to-speech with the device's built-in voices (free, offline on iPhone).
import { useSyncExternalStore } from 'react';
import type { Settings } from '../engine/types';

type VoiceCfg = Settings['voice'];

const synth = (): SpeechSynthesis | undefined => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined);
export const ttsSupported = () => !!synth();

let speaking = false;
let unlocked = false;
let lastError = '';
export const lastSpeechError = () => lastError;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export const useSpeaking = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => speaking);
export const isUnlocked = () => unlocked;

/**
 * iOS only lets a page speak after a real tap (touchend/click count, pointerdown does not).
 * Speak a short silent utterance on the first such tap to unlock speech for later replies.
 */
export function unlockOnFirstGesture() {
  const s = synth();
  if (!s || unlocked) return;
  const go = () => {
    if (unlocked) return;
    try { const u = new SpeechSynthesisUtterance('.'); u.volume = 0; u.rate = 2; s.speak(u); s.getVoices(); } catch { /* ignore */ }
    unlocked = true;
    for (const ev of ['touchend', 'click', 'keydown']) window.removeEventListener(ev, go, true);
  };
  for (const ev of ['touchend', 'click', 'keydown']) window.addEventListener(ev, go, true);
}

/** English voices, British first (closest to a JARVIS feel). */
export function listVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  const rank = (v: SpeechSynthesisVoice) => (v.lang === 'en-GB' ? 0 : v.lang.startsWith('en-') ? 1 : 2) - (/daniel|arthur|oliver|malcolm|google uk english male/i.test(v.name) ? 0.5 : 0);
  return s.getVoices().filter(v => v.lang.toLowerCase().startsWith('en')).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Only force a voice when the user picked one; otherwise let the device choose for en-GB. */
function pickVoice(uri: string): SpeechSynthesisVoice | undefined {
  return uri ? listVoices().find(v => v.voiceURI === uri) : undefined;
}

/** Make text sound right when spoken. */
export function speechText(t: string): string {
  return t
    .replace(/[“”"*_#`]/g, '')
    .replace(/(\d{1,2}):00(?=\s|-|$)/g, '$1')
    .replace(/(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*-\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)\b/gi, (_m, a, am, b, bm) => `${a}${am ? ' ' + am : ''} to ${b} ${bm}`)
    .replace(/\b(\d+)h (\d+)m\b/g, (_m, h, m) => `${h} hour${h === '1' ? '' : 's'} ${m} minutes`)
    .replace(/\b(\d+)h\b/g, (_m, h) => `${h} hour${h === '1' ? '' : 's'}`)
    .replace(/\b(\d+)m\b/g, '$1 minutes')
    .replace(/(\d+(?:\.\d+)?) h\b/g, '$1 hours')
    .replace(/°C/g, ' degrees').replace(/%/g, ' percent').replace(/&/g, ' and ')
    .replace(/\b(\d+) d\b/g, '$1 days')
    .replace(/\s+/g, ' ').trim();
}

/** Speak text, replacing anything already being said. Resolves when finished or stopped. */
export function speak(text: string, cfg: VoiceCfg): Promise<void> {
  const s = synth();
  if (!s || !cfg.enabled || !text.trim()) return Promise.resolve();
  // cancel() right before speak() can silently break speech on iOS; only cancel if needed
  if (s.speaking || s.pending) s.cancel();
  if (s.paused) s.resume();
  // short chunks: some engines cut off long utterances
  const parts = speechText(text).match(/[^.!?]+[.!?]*/g)?.map(p => p.trim()).filter(Boolean) ?? [];
  const voice = pickVoice(cfg.voiceURI);
  speaking = true; emit();
  return new Promise(resolve => {
    let left = parts.length;
    const finish = () => { speaking = false; emit(); resolve(); };
    const done = () => { if (--left <= 0) finish(); };
    // iOS sometimes never fires onend; don't stay stuck in "speaking"
    setTimeout(() => { if (speaking && !s.speaking && !s.pending) finish(); }, 3000 + text.length * 120);
    for (const p of parts) {
      const u = new SpeechSynthesisUtterance(p);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
      u.rate = cfg.rate || 1;
      u.onend = done;
      u.onerror = e => { lastError = (e as SpeechSynthesisErrorEvent).error ?? 'error'; done(); };
      s.speak(u);
    }
    if (!parts.length) done();
  });
}

export function stopSpeaking() {
  synth()?.cancel();
  speaking = false;
  emit();
}
