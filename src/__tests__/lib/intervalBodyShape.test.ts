/**
 * Scenario: three types described the interval body between them, naming
 * eighteen, twelve and two fields. The body carries 84 keys per interval and
 * 78 per group, so fifty-two populated keys were reachable only by casting away
 * the type written to describe them.
 *
 * Expected behaviour: the types are the measured shape, and the fixture beside
 * them is what keeps that true. It is three real bodies with their values
 * moved off the athlete's own readings: a power ride, a structured run whose
 * intervals the athlete named, and an open-water swim, so the sparsity is in
 * the fixture rather than only in prose. The next census is a diff.
 */

import fixture from '../__fixtures__/intervalBodies.json';
import type { ActivityInterval, ActivityIntervalGroup, IntervalsDTO } from '@/types';

const bodies = fixture as unknown as Record<string, IntervalsDTO>;

const EVERY_BODY = ['powerRide', 'structuredRun', 'openWaterSwim'] as const;

/** What the live body carried when it was measured. */
const INTERVAL_KEYS = 84;
const GROUP_KEYS = 78;

function intervals(): ActivityInterval[] {
  return EVERY_BODY.flatMap((name) => bodies[name].icu_intervals);
}

function groups(): ActivityIntervalGroup[] {
  return EVERY_BODY.flatMap((name) => bodies[name].icu_groups);
}

describe('the interval body fixture', () => {
  it('carries the three sports the census covered', () => {
    for (const name of EVERY_BODY) {
      expect(bodies[name].icu_intervals.length).toBeGreaterThan(0);
      expect(bodies[name].icu_groups.length).toBeGreaterThan(0);
    }
  });

  it('carries every key the live body did', () => {
    const seen = new Set(intervals().flatMap((i) => Object.keys(i)));
    expect(seen.size).toBe(INTERVAL_KEYS);

    const groupKeys = new Set(groups().flatMap((g) => Object.keys(g)));
    expect(groupKeys.size).toBe(GROUP_KEYS);
  });

  it('names every key in the type, so nothing is reached by a cast', () => {
    const seen = new Set(intervals().flatMap((i) => Object.keys(i)));
    const declared = new Set(Object.keys(intervals()[0]) as (keyof ActivityInterval)[]);

    // Every key the body carries is a key of the type: assigning the fixture
    // to `ActivityInterval[]` above is what proves it, and this states the
    // count so a silently narrowed type fails here.
    expect(declared.size).toBe(seen.size);
  });
});

describe('what the census settled about the shape', () => {
  it('anchors every interval in elapsed seconds, not only in indices', () => {
    for (const interval of intervals()) {
      expect(typeof interval.start_time).toBe('number');
      expect(typeof interval.end_time).toBe('number');
      expect(interval.end_time).toBeGreaterThanOrEqual(interval.start_time as number);
    }
  });

  it('carries the group id as the group own string, not a number or an index', () => {
    const withGroup = intervals().filter((i) => i.group_id != null);
    expect(withGroup.length).toBeGreaterThan(0);
    for (const interval of withGroup) {
      expect(typeof interval.group_id).toBe('string');
      expect(groups().some((g) => g.id === interval.group_id)).toBe(true);
    }
  });

  it('reads decoupling as a number that is sometimes a string', () => {
    const decouplings = intervals()
      .map((i) => i.decoupling)
      .filter((d) => d != null);

    // Mostly a number, and `-Infinity` arrives as the word, which is why the
    // field cannot be typed as a number alone.
    expect(decouplings.some((d) => typeof d === 'number')).toBe(true);
    expect(decouplings).toContain('-Infinity');
  });

  it('fits a W prime the athlete never configured', () => {
    const fitted = intervals().filter((i) => i.wbal_start != null);
    expect(fitted.length).toBeGreaterThan(0);
    for (const interval of fitted) {
      expect(typeof interval.ss_w_prime).toBe('number');
    }
  });

  it('leaves the sport-specific fields null rather than absent', () => {
    for (const interval of intervals()) {
      expect('average_lactate' in interval).toBe(true);
      expect('average_smo2' in interval).toBe(true);
      expect('segment_effort_ids' in interval).toBe(true);
    }
    expect(intervals().every((i) => i.average_lactate === null)).toBe(true);
  });

  it('names the intervals of the structured run and nothing else', () => {
    const named = bodies.structuredRun.icu_intervals.filter((i) => i.label);
    expect(named.length).toBeGreaterThan(0);
    expect(bodies.powerRide.icu_intervals.every((i) => !i.label)).toBe(true);
  });

  it('carries only the two interval types this account witnessed', () => {
    expect(new Set(intervals().map((i) => i.type))).toEqual(new Set(['WORK', 'RECOVERY']));
  });
});
