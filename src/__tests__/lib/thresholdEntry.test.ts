/**
 * Scenario: the athlete types a threshold figure and leaves the field.
 *
 * Expected behaviour: a positive number is set, an empty field clears only a
 * figure the athlete set, and anything else is refused before the engine sees it.
 */

import { readThresholdEntry } from '@/features/settings/lib/thresholdEntry';

describe('readThresholdEntry', () => {
  it('sets a positive number, with a comma or a point as the separator', () => {
    expect(readThresholdEntry('250', null)).toEqual({ kind: 'set', value: 250 });
    expect(readThresholdEntry('62,5', null)).toEqual({ kind: 'set', value: 62.5 });
  });

  it('clears an empty field only when the athlete had set a figure', () => {
    expect(readThresholdEntry('  ', 250)).toEqual({ kind: 'clear' });
    expect(readThresholdEntry('', null)).toEqual({ kind: 'unchanged' });
  });

  it('refuses zero, a negative figure and text', () => {
    for (const bad of ['0', '-3', 'abc', '12 watts', '1.2.3']) {
      expect(readThresholdEntry(bad, 250)).toEqual({ kind: 'invalid' });
    }
  });

  it('changes nothing when the figure is the one already set', () => {
    expect(readThresholdEntry('250', 250)).toEqual({ kind: 'unchanged' });
  });
});
