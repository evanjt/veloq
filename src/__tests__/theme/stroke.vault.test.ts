/**
 * Scenario: border and rule widths were written as 1, 1.5, 2, 3, a doubled
 * hairline and a dozen local constants, so two edges of one kind drew at two
 * weights.
 *
 * Expected behaviour: the stroke token holds the four widths and no others,
 * the hairline being the platform's own value rather than a fixed fraction.
 */
import { StyleSheet } from 'react-native';

import { stroke } from '@/theme';

describe('the stroke token', () => {
  it('holds the platform hairline and the three whole widths', () => {
    expect(stroke).toEqual({ hairline: StyleSheet.hairlineWidth, one: 1, two: 2, three: 3 });
  });

  it('draws the hairline thinner than the one-point edge', () => {
    expect(stroke.hairline).toBeGreaterThan(0);
    expect(stroke.hairline).toBeLessThanOrEqual(stroke.one);
  });
});
