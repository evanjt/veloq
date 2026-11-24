/**
 * Scenario: a set logged with half a repetition, read in a language that
 * writes a decimal comma.
 *
 * Expected behaviour: the count uses the language's separator and a whole
 * count prints with no decimals.
 */

import { formatReps } from '@/features/strength/lib/formatting';

jest.mock('@/i18n', () => ({ getCurrentLanguage: () => 'de-DE' }));

describe('formatReps', () => {
  it('writes a half rep with the decimal comma', () => {
    expect(formatReps(7.5)).toBe('7,5');
  });

  it('prints a whole count with no decimals', () => {
    expect(formatReps(8)).toBe('8');
  });
});
