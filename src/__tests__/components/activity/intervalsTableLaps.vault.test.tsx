/**
 * Scenario: a ride from a recording's own laps, kind Lap, beside one the
 * server detected intervals for.
 * Expected behaviour: the laps list is headed Laps and its rows read Lap; a
 * detected list or a mixed one stays Intervals.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { IntervalKind } from 'veloqrs';

import { IntervalsTable } from '@/features/activity/components/IntervalsTable';
import { intervalsAreLaps } from '@/features/activity/lib/intervalTypeLabel';
import { i18n, initialiseI18n } from '@/i18n';
import type { ActivityInterval } from '@/types';

const row = (id: number, kind: IntervalKind) =>
  ({ id, kind, startIndex: 0, endIndex: 10, distance: 1000, movingTime: 120 }) as ActivityInterval;

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('laps read from a recording', () => {
  it('are headed Laps only when every row is a lap', () => {
    expect(intervalsAreLaps([row(1, IntervalKind.Lap), row(2, IntervalKind.Lap)])).toBe(true);
    expect(intervalsAreLaps([row(1, IntervalKind.Work), row(2, IntervalKind.Lap)])).toBe(false);
    expect(intervalsAreLaps([row(1, IntervalKind.Work)])).toBe(false);
    expect(intervalsAreLaps([])).toBe(false);
    expect(intervalsAreLaps(undefined)).toBe(false);
  });

  it('have a heading word and name their rows Lap', async () => {
    await render(
      <IntervalsTable
        intervals={[row(1, IntervalKind.Lap), row(2, IntervalKind.Lap)]}
        activityType="Ride"
        isMetric
        isDark={false}
      />
    );
    expect(i18n.t('activityDetail.tabs.laps')).toBe('Laps');
    expect(screen.getAllByText('Lap')).toHaveLength(2);
  });
});
