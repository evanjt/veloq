/**
 * Scenario: a runner holds 3 m/s. The metrics hook reports the current and
 * average speed, and beside them a pace in seconds per km. The pace tiles
 * format from metres per second, so handing them seconds per km read 0:03 /km.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import type { ActivityType, DataFieldType } from '@/types';
import { formatRecordingSpeed } from '@/features/recording/lib/formatRecordingSpeed';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

function metricsAt(speed: number, avgSpeed: number) {
  // The shape `useRecordingMetrics` returns, pace included.
  return {
    speed,
    avgSpeed,
    distance: 1000,
    heartrate: 0,
    power: 0,
    cadence: 0,
    elevation: null,
    elevationGain: 0,
    pace: speed > 0 ? 1000 / speed : 0,
    avgPace: avgSpeed > 0 ? 1000 / avgSpeed : 0,
    calories: 0,
    lapDistance: 0,
    lapTime: 0,
    elapsedTime: 0,
    movingTime: 0,
  };
}

function tile(
  field: DataFieldType,
  speed: number,
  avgSpeed: number,
  isMetric: boolean,
  activityType?: ActivityType
): string {
  const tree = render(
    <DataFieldGrid
      fields={[field]}
      metrics={metricsAt(speed, avgSpeed)}
      isMetric={isMetric}
      activityType={activityType}
    />
  );
  return tree
    .getByTestId(`data-field-${field}`)
    .findAll((n) => typeof n.children[0] === 'string')[0].children[0] as string;
}

it('reads the current pace of a 3 m/s run in both unit systems', () => {
  expect(tile('pace', 3, 2.5, true)).toBe('5:33 /km');
  expect(tile('pace', 3, 2.5, false)).toBe('8:56 /mi');
});

it('reads the average pace from the average speed, not the current one', () => {
  expect(tile('avgPace', 2.5, 3, true)).toBe('5:33 /km');
  expect(tile('avgPace', 2.5, 3, false)).toBe('8:56 /mi');
});

it('reads a placeholder when standing still', () => {
  expect(tile('pace', 0, 0, true)).toBe('--:--');
  expect(tile('avgPace', 0, 0, false)).toBe('--:--');
});

describe('an open-water swim', () => {
  it('reads the pace tiles per 100 m or 100 yd', () => {
    expect(tile('pace', 0.833, 0.833, true, 'OpenWaterSwim')).toBe('2:00 /100m');
    expect(tile('avgPace', 0.833, 0.833, false, 'OpenWaterSwim')).toBe('1:50 /100yd');
  });

  it('reads the same label on the notification and live activity text', () => {
    expect(formatRecordingSpeed('OpenWaterSwim', 0.833, true)).toBe('2:00 /100m');
    expect(formatRecordingSpeed('OpenWaterSwim', 0.833, false)).toBe('1:50 /100yd');
  });

  it('keeps run pace and ride speed on the notification', () => {
    expect(formatRecordingSpeed('Run', 3, true)).toBe('5:33 /km');
    expect(formatRecordingSpeed('Ride', 10, true)).toBe('36.0 km/h');
  });
});
