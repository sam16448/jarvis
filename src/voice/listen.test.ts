import { describe, expect, it } from 'vitest';
import { isNo, isYes } from './listen';

describe('yes / no replies', () => {
  it.each(['yes', 'Yes.', 'yeah', 'Yeah do it', 'yes please', 'Yes please go ahead', 'okay', 'Okay sure', 'OK boss', 'yep', 'Sure thing',
    'go ahead', 'Do it.', 'sounds good', 'Perfect, thanks', 'alright', 'make it so', 'Yes Jarvis', 'confirm', 'of course'])('yes: %s', t => {
    expect(isYes(t)).toBe(true);
    expect(isNo(t)).toBe(false);
  });
  it.each(['no', 'No.', 'nope', 'nah', 'cancel', 'cancel it', 'never mind', 'Forget it', "don't", 'not now', 'leave it'])('no: %s', t => {
    expect(isNo(t)).toBe(true);
    expect(isYes(t)).toBe(false);
  });
  it.each(['okay add it today after I come home and push my sleep', 'yes but move it to tomorrow', 'option a', 'okay push my sleep',
    'yes do it at 9 instead', 'Add gym at 7 pm', 'no wait yes', 'Yes, I would like to reschedule everything for next week please'])('neither: %s', t => {
    expect(isYes(t)).toBe(false);
  });
});
