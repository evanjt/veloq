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

import { recordings } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

// The engine owns the pace rule, so each answer here is text no formatter in
// the app would print for the speed: a tile that formats it itself fails.
const livePace = recordings.livePace as jest.Mock;
beforeEach(() => {
  livePace.mockReset();
  livePace.mockImplementation((speed: number, sport: string | undefined, isMetric: boolean) => ({
    text: `engine ${speed} ${sport ?? 'none'} ${isMetric ? 'metric' : 'imperial'}`,
    seconds: undefined,
  }));
});
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

async function tile(
  field: DataFieldType,
  speed: number,
  avgSpeed: number,
  isMetric: boolean,
  activityType?: ActivityType
): Promise<string> {
  const tree = await render(
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

it('reads the current pace tile from the engine, for the speed and unit system', async () => {
  expect(await tile('pace', 3, 2.5, true, 'Run')).toBe('engine 3 Run metric');
  expect(await tile('pace', 3, 2.5, false, 'Run')).toBe('engine 3 Run imperial');
});

it('reads the average pace tile from the engine for the average speed, not the current one', async () => {
  expect(await tile('avgPace', 2.5, 3, true, 'Run')).toBe('engine 3 Run metric');
  expect(await tile('avgPace', 2.5, 3, false, 'Run')).toBe('engine 3 Run imperial');
});

it('hands the engine no sport when the recording has none', async () => {
  expect(await tile('pace', 3, 2.5, true)).toBe('engine 3 none metric');
});

describe('an open-water swim', () => {
  it('asks the engine for the swim pace on both pace tiles', async () => {
    expect(await tile('pace', 0.833, 0.833, true, 'OpenWaterSwim')).toBe(
      'engine 0.833 OpenWaterSwim metric'
    );
    expect(await tile('avgPace', 0.833, 0.833, false, 'OpenWaterSwim')).toBe(
      'engine 0.833 OpenWaterSwim imperial'
    );
  });

  it('reads the notification and live activity text from the same engine pace', () => {
    expect(formatRecordingSpeed('OpenWaterSwim', 0.833, true)).toBe(
      'engine 0.833 OpenWaterSwim metric'
    );
  });

  it('reads run pace from the engine and ride speed in the app', () => {
    expect(formatRecordingSpeed('Run', 3, true)).toBe('engine 3 Run metric');
    expect(formatRecordingSpeed('Ride', 10, true)).toBe('36.0 km/h');
    expect(livePace).toHaveBeenCalledTimes(1);
  });
});
