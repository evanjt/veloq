/**
 * Scenario: a ride with three GPS fixes is switched to an indoor sport and
 * four more samples are recorded, so the time streams are longer than latlng.
 *
 * Expected behaviour: the review window spans every time sample, so the
 * untrimmed window saves all seven samples and reports no trim.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivitySummary } from '@/features/recording/hooks/useActivitySummary';
import type { RecordingStreams } from '@/features/recording/types';

const START = 1_700_000_000_000;

function mixedStreams(): RecordingStreams {
  const time = [0, 10, 20, 30, 40, 50, 60];
  return {
    time,
    latlng: [
      [1, 2],
      [1.001, 2],
      [1.002, 2],
    ],
    altitude: time.map(() => 0),
    heartrate: time.map(() => 120),
    power: time.map(() => 0),
    cadence: time.map(() => 0),
    speed: time.map(() => 0),
    distance: [0, 10, 20, 30, 40, 50, 60],
  };
}

async function summaryFor(trimStart: number, trimEnd: number) {
  const streams = mixedStreams();
  const { result } = await renderHook(() =>
    useActivitySummary({
      streams,
      startTime: START,
      stopTime: START + 60_000,
      pausedDuration: 0,
      pauseIntervals: [],
      trimStart,
      trimEnd,
      canTrim: true,
      isManual: false,
      params: {},
    })
  );
  return result.current;
}

describe('review window over a ride that gains indoor samples', () => {
  it('saves all seven samples and shows no trim for the full window', async () => {
    const out = await summaryFor(0, 6);
    expect(out.getTrimmedStreams().time).toHaveLength(7);
    expect(out.trimDelta).toBeNull();
  });

  it('reports a trim when only the GPS portion is kept', async () => {
    const out = await summaryFor(0, 2);
    expect(out.getTrimmedStreams().time).toHaveLength(3);
    expect(out.trimDelta).not.toBeNull();
  });
});
