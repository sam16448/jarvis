import type { Command, State } from '../engine/types';
import { llmInterpret } from './llm';
import { mergeAnswerRules, parseRules } from './rules';

export interface Interpretation { cmd: Command; via: 'rules' | 'ai'; note?: string; }

/**
 * Rules first (instant, offline). If the rules are unsure and an AI key is set and we're
 * online, ask the LLM for a Command. Any AI failure falls back to the rule result.
 */
export async function interpret(text: string, st: State, now: string, conflictOpen = false): Promise<Interpretation> {
  const r = parseRules(text, st, now);
  const rules: Interpretation = { cmd: r?.cmd ?? { kind: 'capture', text }, via: 'rules' };
  if (r?.confidence === 'high') return rules;
  const canAI = st.settings.llm.provider !== 'none' && !!st.settings.llm.key && (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!canAI) return rules;
  try {
    return { cmd: await llmInterpret(text, st, now, conflictOpen), via: 'ai' };
  } catch (e) {
    return { ...rules, note: `AI unavailable (${String((e as Error).message ?? e).slice(0, 80)}). Used the offline parser.` };
  }
}

export function mergeAnswer(partial: Command, answer: string, st: State, now: string): Command | null {
  return mergeAnswerRules(partial, answer, st, now);
}
