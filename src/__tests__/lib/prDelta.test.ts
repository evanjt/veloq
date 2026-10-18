/**
 * Scenario: a route record's gain was split into minutes and seconds by hand,
 * so a fractional gain would read "1:5.5" or "0:60".
 *
 * Expected behaviour: one formatter on the shared minute/second split, whole
 * seconds under a minute and M:SS from a minute up.
 */

import { formatPrImprovement } from '@/shared/format/format';
import { initialiseI18n } from '@/i18n';

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('formatPrImprovement', () => {
  it('reads a signed gap in whole seconds under a minute', () => {
    expect(formatPrImprovement(14)).toBe('-14 s');
    expect(formatPrImprovement(1)).toBe('-1 s');
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
