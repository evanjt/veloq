/**
 * Scenario: a GPS recording paused mid-ride is reviewed and saved.
 *
 * Expected behaviour: the summary duration is moving time, so it matches the
 * timer time the FIT writer records and the duration intervals.icu reports.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivitySummary } from '@/features/recording/hooks/useActivitySummary';
import { pausedSecondsBetween } from '@/features/recording/lib/pausedTime';
import type { RecordingStreams } from '@/features/recording/types';
import { elevationGain } from '@/shared/math';

const START = 1_700_000_000_000;

/** Four points at 0, 10, 610 and 620 s, with a 600 s pause between 10 and 610. */
function streamsWithPause(): RecordingStreams {
  const time = [0, 10, 610, 620];
  return {
    time,
    latlng: time.map((_, i) => [1 + i * 0.001, 2] as [number, number]),
    altitude: time.map(() => 0),
    heartrate: time.map(() => 0),
    power: time.map(() => 0),
    cadence: time.map(() => 0),
    speed: time.map(() => 0),
    distance: [0, 100, 200, 300],
  };
}

const PAUSES = [{ start: 10, end: 610 }];

function summaryFor(overrides: Partial<Parameters<typeof useActivitySummary>[0]> = {}) {
  const streams = streamsWithPause();
  const { result } = renderHook(() =>
    useActivitySummary({
      streams,
      startTime: START,
      stopTime: START + 620_000,
      pausedDuration: 600_000,
      pauseIntervals: PAUSES,
      trimStart: 0,
      trimEnd: streams.time.length - 1,
      canTrim: true,
      isManual: false,
      params: {},
      ...overrides,
    })
  );
  return result.current;
}

describe('pausedSecondsBetween', () => {
  it('counts only the overlap with the window', () => {
    expect(pausedSecondsBetween(PAUSES, 0, 620)).toBe(600);
    expect(pausedSecondsBetween(PAUSES, 300, 620)).toBe(310);
    expect(pausedSecondsBetween(PAUSES, 610, 620)).toBe(0);
    expect(pausedSecondsBetween(PAUSES, 620, 620)).toBe(0);
  });
});

describe('useActivitySummary duration', () => {
  it('excludes paused time from the whole recording', () => {
    const { summary } = summaryFor();
    expect(summary.duration).toBe(20);
    expect(summary.avgSpeed).toBeCloseTo(300 / 20);
  });

  it('excludes only the pause inside a trimmed window', () => {
    const { summary, pausedSecondsInWindow } = summaryFor({
      trimStart: 1,
      trimEnd: 3,
    });
    expect(pausedSecondsInWindow).toBe(600);
    expect(summary.duration).toBe(10);
  });

  it('reports no paused time for a window after the pause', () => {
    const { summary, pausedSecondsInWindow } = summaryFor({
      trimStart: 2,
      trimEnd: 3,
    });
    expect(pausedSecondsInWindow).toBe(0);
    expect(summary.duration).toBe(10);
  });
});

/**
 * The window's gain and averages now come from prefixes built once, so they
 * are pinned against a walk of the slice they are meant to describe.
 */
describe('useActivitySummary over a trimmed window', () => {
  const RICH: RecordingStreams = {
    time: [0, 10, 20, 30, 40, 50],
    latlng: [0, 1, 2, 3, 4, 5].map((i) => [1 + i * 0.001, 2] as [number, number]),
    altitude: [100, 112, 108, 130, 129, 140],
    heartrate: [0, 140, 152, 0, 168, 160],
    power: [0, 200, 0, 250, 260, 0],
    cadence: [0, 0, 0, 0, 0, 0],
    speed: [0, 0, 0, 0, 0, 0],
    distance: [0, 100, 200, 300, 400, 500],
  };

  function richSummary(trimStart: number, trimEnd: number) {
    const { result } = renderHook(() =>
      useActivitySummary({
        streams: RICH,
        startTime: START,
        stopTime: START + 50_000,
        pausedDuration: 0,
        pauseIntervals: [],
        trimStart,
        trimEnd,
        canTrim: true,
        isManual: false,
        params: {},
      })
    );
    return result.current.summary;
  }

  const walkedAverage = (values: number[]) => {
    const kept = values.filter((v) => v > 0);
    return kept.length > 0 ? kept.reduce((sum, v) => sum + v, 0) / kept.length : null;
  };

  it.each([
    [0, 5],
    [1, 4],
    [2, 5],
    [3, 3],
    [0, 2],
  ])('matches a walk of the slice for [%i, %i]', (from, to) => {
    const summary = richSummary(from, to);

    expect(summary.elevationGain).toBeCloseTo(elevationGain(RICH.altitude.slice(from, to + 1)), 9);
    expect(summary.avgHeartrate).toEqual(walkedAverage(RICH.heartrate.slice(from, to + 1)));
    expect(summary.avgPower).toEqual(walkedAverage(RICH.power.slice(from, to + 1)));
    expect(summary.distance).toBe(RICH.distance[to] - RICH.distance[from]);
    expect(summary.hasGps).toBe(true);
  });
});
