/**
 * Scenario: a pool swim with 100 m intervals, a run and a ride, each in the
 * intervals table, the swim and the run carrying the pace text the engine wrote
 * for them.
 * Expected behaviour: the swim reads the engine's pace per 100 m, as the pace
 * chart and the section rows do, the run the engine's pace per km and the ride
 * its speed. The table works out no pace itself.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { IntervalsTable } from '@/features/activity/components/IntervalsTable';
import { formatSportSpeedText } from '@/shared/format/format';
import type { ActivityInterval, ActivityType } from '@/types';
import { FfiIntervalKind } from 'veloqrs';

function interval(
  distance: number,
  seconds: number,
  texts: { metric?: string; imperial?: string } = {}
): ActivityInterval {
  return {
    id: 1,
    kind: FfiIntervalKind.Work,
    startIndex: 0,
    endIndex: 100,
    distance,
    movingTime: seconds,
    averageSpeed: distance / seconds,
    ...(texts.metric === undefined ? {} : { averageSpeedMetricText: texts.metric }),
    ...(texts.imperial === undefined ? {} : { averageSpeedImperialText: texts.imperial }),
  } as ActivityInterval;
}

async function renderRow(type: ActivityType, row: ActivityInterval, isMetric = true) {
  await render(
    <IntervalsTable intervals={[row]} activityType={type} isMetric={isMetric} isDark={false} />
  );
}

describe('the intervals table speed column', () => {
  it('reads a swim as the engine pace per 100 m', async () => {
    await renderRow('Swim', interval(100, 120, { metric: '2:03', imperial: '1:52' }));
    expect(screen.getByText('2:03 /100m')).toBeTruthy();
    expect(screen.queryByText(/km\/h/)).toBeNull();
  });

  it('reads an imperial swim as the engine pace per 100 yd', async () => {
    await renderRow('Swim', interval(100, 120, { metric: '2:03', imperial: '1:52' }), false);
    expect(screen.getByText('1:52 /100yd')).toBeTruthy();
  });

  it('reads a run as the engine pace per km', async () => {
    await renderRow('Run', interval(1000, 300, { metric: '5:01', imperial: '8:04' }));
    expect(screen.getByText('5:01 /km')).toBeTruthy();
  });

  it('reads a run in miles as the engine pace per mile', async () => {
    await renderRow('Run', interval(1000, 300, { metric: '5:01', imperial: '8:04' }), false);
    expect(screen.getByText('8:04 /mi')).toBeTruthy();
  });

  it('shows the absent mark for a run lap the engine wrote no pace for', async () => {
    await renderRow('Run', interval(1000, 300));
    expect(screen.getByText('--:--')).toBeTruthy();
  });

  it('reads a ride as speed', async () => {
    await renderRow('Ride', interval(1000, 120));
    expect(screen.getByText('30.0 km/h')).toBeTruthy();
  });
});

describe('formatSportSpeedText', () => {
  const text = { metricText: '9:59', imperialText: '16:04' };

  it('prints the engine text with the unit of the sport and system', () => {
    expect(formatSportSpeedText(100 / 120, 'Swim', true, text)).toBe('9:59 /100m');
    expect(formatSportSpeedText(100 / 120, 'Swim', false, text)).toBe('16:04 /100yd');
    expect(formatSportSpeedText(1000 / 300, 'Run', true, text)).toBe('9:59 /km');
    expect(formatSportSpeedText(1000 / 300, 'Walk', false, text)).toBe('16:04 /mi');
  });

  it('prints a speed for a sport that reads one, whatever text came with it', () => {
    expect(formatSportSpeedText(1000 / 120, 'Ride', true, text)).toBe('30.0 km/h');
  });

  it('keeps the absent mark for a pace the engine sent no text for', () => {
    expect(formatSportSpeedText(0, 'Swim', true, {})).toBe('--:--');
    expect(formatSportSpeedText(3, 'Run', true, { imperialText: '8:56' })).toBe('--:--');
  });
});
