/**
 * Scenario: intervals.icu indexes its intervals into the stream as it sent it,
 * and both stream readers drop every sample whose `latlng` is missing before
 * the chart ever sees it. A band placed by raw index therefore lands one
 * sample later for every dropped sample before it. Measured on 60 activities:
 * 328 of 876 band edges displaced, median 167 s, worst 1855 s.
 *
 * Expected behaviour: a band is placed by the interval's elapsed seconds,
 * looked up in the reduced `time` series, which reproduced all 876 edges
 * exactly on that corpus. The raw index stays as the fallback for a body that
 * carries no seconds.
 */

import { computeIntervalBands } from '@/features/stats/lib/combinedPlotData';
import type { ActivityInterval, ActivityStreams } from '@/types';
import { streamsFromArrays } from '@/features/activity/lib/streams';
import { IntervalKind } from 'veloqrs';

/**
 * Ten seconds recorded, four of them without a fix. The reader keeps the six
 * with coordinates, so raw index 8 is reduced index 4.
 */
function reducedStreams(): ActivityStreams {
  return streamsFromArrays({
    time: [0, 1, 2, 3, 8, 9],
    distance: [0, 10, 20, 30, 80, 90],
  });
}

/** Any field may be missing, as a body from the API sometimes leaves one out. */
function interval(over: {
  [K in keyof ActivityInterval]?: ActivityInterval[K] | undefined;
}): ActivityInterval {
  return {
    id: 1,
    kind: IntervalKind.Work,
    startIndex: 8,
    endIndex: 9,
    startTime: 8,
    endTime: 9,
    distance: 10,
    movingTime: 1,
    averageSpeed: 10,
    ...over,
  } as ActivityInterval;
}

describe('where an interval band lands when samples were dropped', () => {
  it('places the band at the second the athlete rode, not the raw index', () => {
    const bands = computeIntervalBands([interval({})], 6, reducedStreams(), 'time', true, 'Ride');

    expect(bands[0].startX).toBe(8);
    expect(bands[0].endX).toBe(9);
  });

  it('reads the distance axis at the index the seconds lookup returned', () => {
    const bands = computeIntervalBands(
      [interval({})],
      6,
      reducedStreams(),
      'distance',
      true,
      'Ride'
    );

    expect(bands[0].startX).toBe(0.08);
    expect(bands[0].endX).toBe(0.09);
  });

  it('places a clean activity exactly where it does today', () => {
    const clean = streamsFromArrays({ time: [0, 1, 2, 3, 4], distance: [0, 10, 20, 30, 40] });

    const bands = computeIntervalBands(
      [interval({ startIndex: 1, endIndex: 3, startTime: 1, endTime: 3 })],
      5,
      clean,
      'time',
      true,
      'Ride'
    );

    expect(bands[0].startX).toBe(1);
    expect(bands[0].endX).toBe(3);
  });

  it('takes the nearest sample when the second itself was dropped', () => {
    const bands = computeIntervalBands(
      [interval({ startTime: 5, endTime: 9, startIndex: 5, endIndex: 9 })],
      6,
      reducedStreams(),
      'time',
      true,
      'Ride'
    );

    expect(bands[0].startX).toBe(8);
    expect(bands[0].endX).toBe(9);
  });

  it('falls back to the raw index for an interval with no seconds', () => {
    const bands = computeIntervalBands(
      [interval({ startTime: undefined, endTime: undefined, startIndex: 1, endIndex: 2 })],
      6,
      reducedStreams(),
      'time',
      true,
      'Ride'
    );

    expect(bands[0].startX).toBe(1);
    expect(bands[0].endX).toBe(2);
  });

  it('still renders on the distance axis when the body carries no time series', () => {
    const noTime = streamsFromArrays({ distance: [0, 10, 20, 30, 80, 90] });

    const bands = computeIntervalBands([interval({})], 6, noTime, 'distance', true, 'Ride');

    expect(bands).toHaveLength(1);
    expect(bands[0].endX).toBe(0.09);
  });

  it('ends the last interval on the final sample when its seconds run past the stream', () => {
    const bands = computeIntervalBands(
      [interval({ startTime: 2, endTime: 400, startIndex: 2, endIndex: 400 })],
      6,
      reducedStreams(),
      'time',
      true,
      'Ride'
    );

    expect(bands[0].startX).toBe(2);
    expect(bands[0].endX).toBe(9);
  });
});
