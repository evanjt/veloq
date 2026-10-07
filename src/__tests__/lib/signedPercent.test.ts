/**
 * Scenario: the week-on-week card printed a fall as "29%" while the card in
 * the same slot printed "-28%", and the chronic branch printed "-0%" for a
 * ratio of exactly zero.
 *
 * Expected behaviour: one format, signed on either side of zero and bare at
 * zero.
 */

import { signedPercent } from '@/features/insights/generators/periodComparison';

describe('signedPercent', () => {
  it('signs a rise', () => {
    expect(signedPercent(0.6)).toBe('+60%');
  });

  it('signs a fall', () => {
    expect(signedPercent(-0.29)).toBe('-29%');
  });

  it('prints zero bare', () => {
    expect(signedPercent(0)).toBe('0%');
  });

  it('prints a move that rounds to zero bare, not as -0%', () => {
    expect(signedPercent(-0.004)).toBe('0%');
    expect(signedPercent(0.004)).toBe('0%');
  });
});
