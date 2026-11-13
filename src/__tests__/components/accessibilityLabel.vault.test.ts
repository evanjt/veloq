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

  it('drops the full stop that ends the label, so the role follows after one pause', () => {
    expect(composeAccessibilityLabel('Compared with 23 on Oct 25.')).toBe(
      'Compared with 23 on Oct 25'
    );
    expect(composeAccessibilityLabel('Power', '245 W.')).toBe('Power, 245 W');
  });

  it('keeps full stops inside the label and drops only the last one', () => {
    expect(composeAccessibilityLabel('Fitness 23, steady. Compared with 23 on Oct 25.')).toBe(
      'Fitness 23, steady. Compared with 23 on Oct 25'
    );
    expect(composeAccessibilityLabel('Oct 25..')).toBe('Oct 25.');
  });
});
