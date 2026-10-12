/**
 * Expected behaviour: a grouped element's spoken name joins the strings it
 * draws in reading order, skipping what is absent and what was already said.
 */

import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';

describe('composeAccessibilityLabel', () => {
  it('joins the parts in the order given', () => {
    expect(composeAccessibilityLabel('Power', '245 W', 'Above average')).toBe(
      'Power, 245 W, Above average'
    );
  });

  it('skips absent and blank parts', () => {
    expect(
      composeAccessibilityLabel('Ridge climb', null, undefined, false, '', '  ', '3.2 km')
    ).toBe('Ridge climb, 3.2 km');
  });

  it('speaks a number part, zero included', () => {
    expect(composeAccessibilityLabel('Laps', 0)).toBe('Laps, 0');
  });

  it('says a repeated part once', () => {
    expect(composeAccessibilityLabel('142 bpm', 'Heart rate', '142 bpm')).toBe(
      '142 bpm, Heart rate'
    );
  });

  it('is empty when nothing is drawn', () => {
    expect(composeAccessibilityLabel()).toBe('');
    expect(composeAccessibilityLabel(null, false)).toBe('');
  });
});
