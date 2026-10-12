/**
 * Scenario: the engine stores an interval body with every null field of its
 * intervals and groups dropped, so a key that arrived null is absent when the
 * body is read back.
 *
 * Expected behaviour: the intervals table and the chart's interval bands read
 * an absent field exactly as they read a null one.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import fixture from '../../__fixtures__/intervalBodies.json';
import { IntervalsTable } from '@/features/activity/components/IntervalsTable';
import { computeIntervalBands } from '@/features/stats/lib/combinedPlotData';
import type { ActivityInterval, ActivityStreams, ActivityType, IntervalsDTO } from '@/types';

const bodies = fixture as unknown as Record<string, IntervalsDTO>;

const SPORTS: Record<string, ActivityType> = {
  powerRide: 'Ride',
  structuredRun: 'Run',
  openWaterSwim: 'OpenWaterSwim' as ActivityType,
};

function withoutNulls(intervals: ActivityInterval[]): ActivityInterval[] {
  return intervals.map(
    (interval) =>
      Object.fromEntries(
        Object.entries(interval).filter(([, value]) => value !== null)
      ) as ActivityInterval
  );
}

async function tableOf(intervals: ActivityInterval[], sport: ActivityType, isMetric: boolean) {
  const { toJSON, unmount } = await render(
    <IntervalsTable intervals={intervals} activityType={sport} isMetric={isMetric} isDark />
  );
  // The rows as drawn, without the list's own copy of the data it was handed.
  const tree = JSON.stringify((toJSON() as { children: unknown }).children);
  await unmount();
  return tree;
}

function streamsCovering(intervals: ActivityInterval[]): ActivityStreams {
  const end = Math.max(...intervals.map((interval) => interval.end_index)) + 1;
  const seconds = Float64Array.from({ length: end }, (_, i) => i);
  return { time: seconds, distance: seconds.map((s) => s * 5) };
}

describe.each(Object.keys(SPORTS))('the %s body with its nulls dropped', (name) => {
  const sport = SPORTS[name];
  const fetched = bodies[name].icu_intervals;
  const stored = withoutNulls(fetched);

  it('drops fields the fixture carried as null', () => {
    expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(fetched).length);
  });

  it.each([true, false])('renders the same intervals table (metric %s)', async (isMetric) => {
    expect(await tableOf(stored, sport, isMetric)).toBe(await tableOf(fetched, sport, isMetric));
  });

  it.each(['time', 'distance'] as const)('places the same bands on the %s axis', (axis) => {
    const streams = streamsCovering(fetched);
    const length = streams.time!.length;
    expect(computeIntervalBands(stored, length, streams, axis, true, sport, [])).toEqual(
      computeIntervalBands(fetched, length, streams, axis, true, sport, [])
    );
  });
});
