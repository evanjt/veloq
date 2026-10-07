/**
 * Scenario: a pool swim with 100 m intervals in 2:00, a run and a ride, each in
 * the intervals table.
 * Expected behaviour: the swim reads pace per 100 m, as the pace chart and the
 * section rows do, the run pace per km and the ride speed.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { IntervalsTable } from '@/features/activity/components/IntervalsTable';
import { formatSportSpeed } from '@/shared/format/format';
import type { ActivityInterval, ActivityType } from '@/types';

function interval(distance: number, seconds: number): ActivityInterval {
  return {
    id: 1,
    type: 'WORK',
    start_index: 0,
    end_index: 100,
    distance,
    moving_time: seconds,
    elapsed_time: seconds,
    average_speed: distance / seconds,
  } as ActivityInterval;
}

function renderRow(type: ActivityType, row: ActivityInterval, isMetric = true) {
  render(
    <IntervalsTable intervals={[row]} activityType={type} isMetric={isMetric} isDark={false} />
  );
}

describe('the intervals table speed column', () => {
  it('reads a swim as pace per 100 m', () => {
    renderRow('Swim', interval(100, 120));
    expect(screen.getByText('2:00 /100m')).toBeTruthy();
    expect(screen.queryByText(/km\/h/)).toBeNull();
  });

  it('reads an imperial swim as pace per 100 yd', () => {
    renderRow('Swim', interval(100, 120), false);
    expect(screen.getByText('1:50 /100yd')).toBeTruthy();
  });

  it('reads a run as pace per km', () => {
    renderRow('Run', interval(1000, 300));
    expect(screen.getByText('5:00 /km')).toBeTruthy();
  });

  it('reads a ride as speed', () => {
    renderRow('Ride', interval(1000, 120));
    expect(screen.getByText('30.0 km/h')).toBeTruthy();
  });
});

describe('formatSportSpeed', () => {
  it('chooses swim pace, run pace or speed by sport', () => {
    expect(formatSportSpeed(100 / 120, 'Swim', true)).toBe('2:00 /100m');
    expect(formatSportSpeed(1000 / 300, 'Run', true)).toBe('5:00 /km');
    expect(formatSportSpeed(1000 / 300, 'Walk', false)).toBe('8:03 /mi');
    expect(formatSportSpeed(1000 / 120, 'Ride', true)).toBe('30.0 km/h');
  });

  it('keeps the absent mark for a swim with no speed', () => {
    expect(formatSportSpeed(0, 'Swim', true)).toBe('--:--');
  });
});
