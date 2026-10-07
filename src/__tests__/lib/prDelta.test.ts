/**
 * Scenario: the route PR+ badge on the feed card and on the activity page each
 * split its delta into minutes and seconds by hand, so a fractional delta
 * would read "1:5.5" or "0:60".
 *
 * Expected behaviour: one formatter on the shared minute/second split, whole
 * seconds under a minute and M:SS from a minute up.
 */

import { formatPrDelta, formatPrImprovement } from '@/shared/format/format';

describe('formatPrDelta', () => {
  it('reads whole seconds under a minute', () => {
    expect(formatPrDelta(59)).toBe('PR+59s');
    expect(formatPrDelta(1)).toBe('PR+1s');
  });

  it('reads M:SS from a minute up', () => {
    expect(formatPrDelta(60)).toBe('PR+1:00');
    expect(formatPrDelta(61)).toBe('PR+1:01');
    expect(formatPrDelta(3599)).toBe('PR+59:59');
  });

  it('never shows a fractional second or a seconds field of 60', () => {
    expect(formatPrDelta(65.5)).toBe('PR+1:06');
    expect(formatPrDelta(59.6)).toBe('PR+1:00');
    expect(formatPrDelta(5.4)).toBe('PR+5s');
  });
});

describe('formatPrImprovement', () => {
  it('reads a signed gap in whole seconds under a minute', () => {
    expect(formatPrImprovement(14)).toBe('-14s');
    expect(formatPrImprovement(1)).toBe('-1s');
  });

  it('reads M:SS from a minute up', () => {
    expect(formatPrImprovement(65)).toBe('-1:05');
    expect(formatPrImprovement(59.6)).toBe('-1:00');
  });

  it('is empty when there is no improvement to show', () => {
    expect(formatPrImprovement(null)).toBeNull();
    expect(formatPrImprovement(undefined)).toBeNull();
    expect(formatPrImprovement(0)).toBeNull();
    expect(formatPrImprovement(0.4)).toBeNull();
  });
});
