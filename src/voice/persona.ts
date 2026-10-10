// Jarvis's spoken replies to commands: instant, offline templates.
import type { Answer, PlanResult, Proposal, Question } from '../engine/types';

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const clean = (s: string) => s.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();

export const ACKS = ['Right away', 'On it', 'Certainly', 'Very good', 'Consider it handled', 'As you wish'];
const DONE = ['Done.', 'Consider it done.', 'All set.', 'Sorted.', 'Done and dusted.'];

function proposalLine(p: Proposal, address: string): string {
  const first = p.diff.find(d => d.change === 'add' || d.change === 'move');
  const where = first?.after && !p.understood.includes(first.after) ? ` I've pencilled ${clean(first.title)} in for ${first.after}.` : '';
  if (p.conflicts.length) {
    const c = p.conflicts[0];
    const best = c.options[0];
    return `${pick(ACKS)}, ${address}. ${clean(p.understood)} One snag: ${clean(c.reason)}${best ? ` I'd suggest option ${best.key}, ${clean(best.label).toLowerCase()}. ${clean(best.detail)}` : ''} Which would you like?`;
  }
  const warn = p.warnings[0] ? ` Note: ${clean(p.warnings[0])}` : '';
  return `${pick(ACKS)}, ${address}. ${clean(p.understood)}${where}${warn} Shall I go ahead?`;
}

function answerLine(a: Answer): string {
  const lines = a.lines.slice(0, 6).map(clean).join('. ');
  return `${clean(a.title)}. ${lines}${a.lines.length > 6 ? `. And ${a.lines.length - 6} more on screen.` : ''}`;
}

const questionLine = (q: Question, address: string) => `${clean(q.question).replace(/\?$/, '')}, ${address}?`;

/** What Jarvis says right after interpreting a command. */
export function replyFor(r: PlanResult, address: string): string {
  if (r.type === 'proposal') return proposalLine(r, address);
  if (r.type === 'answer') return answerLine(r);
  return questionLine(r, address);
}

export const doneLine = (address: string) => {
  const d = pick(DONE);
  return Math.random() < 0.5 ? `${d.replace(/\.$/, '')}, ${address}.` : d;
};
export const cancelLine = () => pick(['Cancelled.', 'Very well, nothing changed.', 'Scrapped.']);
export const undoLine = (label?: string) => (label ? `Undone: ${clean(label)}` : 'Nothing to undo.');
