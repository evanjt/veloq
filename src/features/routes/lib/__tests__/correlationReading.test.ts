/**
 * Scenario: the engine hands over a coefficient and its 95% interval for a wellness input.
 * Expected behaviour: an interval spanning zero reads as no clear link whatever the size of r;
 * otherwise |r| picks a strength band and the sign picks the direction.
 */

import { correlationReading } from '../correlationReading';

describe('correlationReading', () => {
  it.each([
    [0.05, 'veryWeak'],
    [0.1, 'weak'],
    [0.29, 'weak'],
    [0.3, 'moderate'],
    [0.49, 'moderate'],
    [0.5, 'strong'],
    [0.69, 'strong'],
    [0.7, 'veryStrong'],
    [1, 'veryStrong'],
  ])('reads |r| of %s as %s', (r, strength) => {
    expect(correlationReading(r, r - 0.02, Math.min(r + 0.02, 1)).strength).toBe(strength);
  });

  it('reads the same band for a negative r, with the direction reversed', () => {
    expect(correlationReading(-0.42, -0.6, -0.2)).toEqual({
      strength: 'moderate',
      direction: 'lower',
    });
    expect(correlationReading(0.42, 0.2, 0.6)).toEqual({
      strength: 'moderate',
      direction: 'higher',
    });
  });

  it('reads an interval spanning zero as no clear link even when r is large', () => {
    expect(correlationReading(0.6, -0.05, 0.9)).toEqual({ strength: 'none', direction: null });
    expect(correlationReading(-0.6, -0.9, 0.05)).toEqual({ strength: 'none', direction: null });
  });

  it('reads an interval touching zero as no clear link', () => {
    expect(correlationReading(0.4, 0, 0.7).strength).toBe('none');
  });
});
