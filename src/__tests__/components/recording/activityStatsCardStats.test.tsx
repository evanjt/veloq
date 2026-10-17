/**
 * Scenario: a paused ride with heart rate and power is reviewed before saving.
 *
 * Expected behaviour: the card names the time it shows as moving time, puts
 * the elapsed time beside it, and shows every average that will be saved.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivityStatsCard } from '@/features/recording/components/ActivityStatsCard';
import type { ActivitySummary } from '@/features/recording/hooks/useActivitySummary';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: jest.fn(() => true),
  useTheme: () => ({ isDark: false }),
}));

const PAUSED_RIDE: ActivitySummary = {
  duration: 3600,
  elapsed: 4200,
  distance: 30000,
  avgSpeed: 30000 / 3600,
  elevationGain: 300,
  avgHeartrate: 142,
  avgPower: 210,
  hasGps: true,
};

function renderCard(summary: ActivitySummary, activityType: 'Ride' | 'Run' = 'Ride') {
  return render(<ActivityStatsCard summary={summary} activityType={activityType} />);
}

describe('ActivityStatsCard', () => {
  it('labels the summary duration as moving time with the elapsed time beside it', async () => {
    const { getByText, queryByText } = await renderCard(PAUSED_RIDE);
    expect(getByText('recording.fields.movingTime')).toBeTruthy();
    expect(getByText('1:00:00')).toBeTruthy();
    expect(getByText('recording.fields.elapsedTime')).toBeTruthy();
    expect(getByText('1:10:00')).toBeTruthy();
    expect(queryByText('recording.durationLabel')).toBeNull();
  });

  it('shows the heart rate, power and speed averages that will be saved', async () => {
    const { getByText } = await renderCard(PAUSED_RIDE);
    expect(getByText('142 bpm')).toBeTruthy();
    expect(getByText('recording.avgHrLabel')).toBeTruthy();
    expect(getByText('210 W')).toBeTruthy();
    expect(getByText('recording.fields.avgPower')).toBeTruthy();
    expect(getByText('30.0 km/h')).toBeTruthy();
    expect(getByText('recording.fields.avgSpeed')).toBeTruthy();
  });

  it('labels the climb as elevation gain', async () => {
    const { getByText, queryByText } = await renderCard(PAUSED_RIDE);
    expect(getByText('recording.fields.elevationGain')).toBeTruthy();
    expect(queryByText('recording.elevation')).toBeNull();
  });

  it('shows pace rather than speed for a run', async () => {
    const run = { ...PAUSED_RIDE, distance: 10000, avgSpeed: 10000 / 3000, duration: 3000 };
    const { getByText, queryByText } = await renderCard(run, 'Run');
    expect(getByText('5:00 /km')).toBeTruthy();
    expect(getByText('recording.fields.avgPace')).toBeTruthy();
    expect(queryByText('recording.fields.avgSpeed')).toBeNull();
  });

  it('leaves out elapsed time and averages that were never recorded', async () => {
    const bare: ActivitySummary = {
      ...PAUSED_RIDE,
      elapsed: 3600,
      distance: 0,
      avgSpeed: 0,
      avgHeartrate: null,
      avgPower: null,
    };
    const { getByText, queryByText } = await renderCard(bare);
    expect(getByText('recording.fields.movingTime')).toBeTruthy();
    expect(queryByText('recording.fields.elapsedTime')).toBeNull();
    expect(queryByText('recording.avgHrLabel')).toBeNull();
    expect(queryByText('recording.fields.avgPower')).toBeNull();
    expect(queryByText('recording.fields.avgSpeed')).toBeNull();
  });
});
