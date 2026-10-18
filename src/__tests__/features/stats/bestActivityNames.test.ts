/**
 * Scenario: the Best Efforts read names the activity holding each best, with
 * its start stored as the wall clock stamped as UTC.
 *
 * Expected behaviour: a row carries that name and the start's own calendar day,
 * whatever the device's zone, and a best whose activity the device does not
 * hold carries none, so the row reads as not cached.
 */

import { bestEffortsOf, climbBestsOf } from '@/features/stats/hooks/useSeasonBests';
import { BestEffortKind, type BestEffortsData } from 'veloqrs';
import type { TFunction } from 'i18next';
import { atUtcOffset } from '../../__shared__/fixedOffsetDate';

const t = ((key: string) => key) as unknown as TFunction;

/** 2026-03-01T23:30:00 stamped as UTC: the next day when read locally east of UTC. */
const LATE_START = 1_772_407_800;

const read = {
  sports: [
    {
      sport: 'Run',
      fetched: true,
      efforts: [
        {
          kind: BestEffortKind.Distance,
          checkpoint: 5000,
          value: 4.2,
          time: 1190,
          activityId: 'lake-loop',
          activity: { activityId: 'lake-loop', name: 'Lakeside tempo', date: LATE_START },
        },
        {
          kind: BestEffortKind.Distance,
          checkpoint: 10000,
          value: 4,
          time: 2500,
          activityId: 'far-away',
          activity: undefined,
        },
        {
          kind: BestEffortKind.HalfMarathon,
          checkpoint: 21097.5,
          value: undefined,
          time: undefined,
          activityId: undefined,
          activity: undefined,
        },
      ],
    },
  ],
  climbing: [
    {
      sport: 'Run',
      owed: 0,
      sourceExcluded: 0,
      bests: [
        {
          label: '15s',
          windowS: 15,
          vam: 1800,
          wattsPerKg: 4.9,
          activityId: 'quarry',
          activity: { activityId: 'quarry', name: 'Quarry repeats', date: LATE_START },
        },
        { label: '5m', windowS: 300, vam: 900, wattsPerKg: 2.4, activityId: 'gone' },
      ],
    },
  ],
} as unknown as BestEffortsData;

describe('the activity a best names', () => {
  it('carries the name and the start day of a pace best', () => {
    const [fiveK] = bestEffortsOf(read, 'Running', t);

    expect(fiveK.activity).toEqual({ name: 'Lakeside tempo', date: '2026-03-01' });
  });

  it.each([10, -8])('keeps the start day on a device at UTC%+d', (offsetHours) => {
    const [fiveK] = atUtcOffset(offsetHours, () => bestEffortsOf(read, 'Running', t));

    expect(fiveK.activity?.date).toBe('2026-03-01');
  });

  it('names nothing for a best the device does not hold, and nothing for no best', () => {
    const [, tenK, half] = bestEffortsOf(read, 'Running', t);

    expect(tenK.activityId).toBe('far-away');
    expect(tenK.activity).toBeUndefined();
    expect(half.activity).toBeUndefined();
  });

  it('carries the name and start day of a climbing best', () => {
    const [short, long] = climbBestsOf(read, 'Running');

    expect(short.activity).toEqual({ name: 'Quarry repeats', date: '2026-03-01' });
    expect(long.activity).toBeUndefined();
  });
});
