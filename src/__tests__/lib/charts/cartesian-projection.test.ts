/**
 * Scenario: the pace curves plot a slow-to-fast y axis, so their domain runs
 * `[slowest, fastest]` and descends. The critical-speed line was guarded with
 * `cs >= domain[0] && cs <= domain[1]`, which on a descending domain reads
 * "slower than the slowest and faster than the fastest" and is never true, so
 * the line the footer names was never drawn. Had the guard passed, the
 * placement measured from the top and would have mirrored it.
 *
 * Expected behaviour: one containment test and one projection, both order-free,
 * so a chart that reads fast-at-the-top and one that reads high-at-the-top
 * share them.
 */

import { domainContains, yForValue } from '@/shared/charts/projection';

const BOUNDS = { top: 0, bottom: 300 };

/** A running pace curve in seconds per kilometre: 6:43/km down to 2:14/km. */
const PACE: [number, number] = [403, 134];
/** A power curve in watts, which ascends. */
const POWER: [number, number] = [100, 400];

describe('domainContains', () => {
  it('holds a value inside a descending domain', () => {
    expect(domainContains(PACE, 314)).toBe(true);
  });

  it('holds a value inside an ascending domain', () => {
    expect(domainContains(POWER, 250)).toBe(true);
  });

  it('holds each end of the domain', () => {
    expect(domainContains(PACE, 403)).toBe(true);
    expect(domainContains(PACE, 134)).toBe(true);
  });

  it('refuses a value outside either end, whichever way the domain runs', () => {
    expect(domainContains(PACE, 500)).toBe(false);
    expect(domainContains(PACE, 100)).toBe(false);
    expect(domainContains(POWER, 99)).toBe(false);
    expect(domainContains(POWER, 401)).toBe(false);
  });

  it('refuses a value that is not a number', () => {
    expect(domainContains(PACE, Number.NaN)).toBe(false);
  });
});

describe('yForValue', () => {
  it('puts the first end of the domain at the bottom and the second at the top', () => {
    expect(yForValue(403, PACE, BOUNDS)).toBe(300);
    expect(yForValue(134, PACE, BOUNDS)).toBe(0);
    expect(yForValue(100, POWER, BOUNDS)).toBe(300);
    expect(yForValue(400, POWER, BOUNDS)).toBe(0);
  });

  it('lands a third of the way up from the slow end', () => {
    // (314 - 403) / (134 - 403) is 0.331, so the line sits 99 px above the
    // bottom of a 300 px plot.
    expect(yForValue(314, PACE, BOUNDS)).toBeCloseTo(200.7, 1);
  });

  it('agrees with the ascending case at the same fraction', () => {
    expect(yForValue(200, POWER, BOUNDS)).toBeCloseTo(200, 5);
  });

  it('answers the bottom for a domain of zero width rather than dividing by it', () => {
    expect(yForValue(50, [50, 50], BOUNDS)).toBe(300);
  });

  it('respects a plot that does not start at zero', () => {
    expect(yForValue(134, PACE, { top: 40, bottom: 340 })).toBe(40);
    expect(yForValue(403, PACE, { top: 40, bottom: 340 })).toBe(340);
  });
});
