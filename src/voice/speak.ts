// Text-to-speech with the device's built-in voices (free, offline on iPhone).
import { useSyncExternalStore } from 'react';
import type { Settings } from '../engine/types';

type VoiceCfg = Settings['voice'];

const synth = (): SpeechSynthesis | undefined => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined);
export const ttsSupported = () => !!synth();

let speaking = false;
let unlocked = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export const useSpeaking = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => speaking);
export const isUnlocked = () => unlocked;

/** iOS only allows speech after a user gesture; speak a silent utterance on the first tap. */
export function unlockOnFirstGesture() {
  const s = synth();
  if (!s || unlocked) return;
  const go = () => {
    if (unlocked) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u); } catch { /* ignore */ }
    unlocked = true;
    window.removeEventListener('pointerdown', go, true);
    window.removeEventListener('keydown', go, true);
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

/** English voices, British first (closest to a JARVIS feel). */
export function listVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  const rank = (v: SpeechSynthesisVoice) => (v.lang === 'en-GB' ? 0 : v.lang.startsWith('en-') ? 1 : 2) - (/daniel|arthur|oliver|malcolm|google uk english male/i.test(v.name) ? 0.5 : 0);
  return s.getVoices().filter(v => v.lang.toLowerCase().startsWith('en')).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function pickVoice(uri: string): SpeechSynthesisVoice | undefined {
  const vs = listVoices();
  return vs.find(v => v.voiceURI === uri) ?? vs[0];
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
  s.cancel();
  // short chunks: some engines cut off long utterances
  const parts = speechText(text).match(/[^.!?]+[.!?]*/g)?.map(p => p.trim()).filter(Boolean) ?? [];
  const voice = pickVoice(cfg.voiceURI);
  speaking = true; emit();
  return new Promise(resolve => {
    let left = parts.length;
    const done = () => { if (--left <= 0) { speaking = false; emit(); resolve(); } };
    for (const p of parts) {
      const u = new SpeechSynthesisUtterance(p);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
      u.rate = cfg.rate || 1;
      u.onend = done;
      u.onerror = done;
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
