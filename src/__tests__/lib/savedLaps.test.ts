/**
 * Scenario: a ride is saved with the laps the athlete pressed, over a window
 * that may be trimmed, with pauses inside it. The engine writes the laps it is
 * given, so the saved laps must already cover the ride from first sample to last.
 *
 * Expected behaviour: store laps are moved onto the saved window and clipped at its
 * edges, and a closing lap is added after the last press, or the one lap over the
 * whole ride when none was pressed.
 */

import { rebaseLaps, summariseLap, withClosingLap } from '@/features/recording/lib/savedLaps';
import type { RecordingLap, RecordingStreams } from '@/types';

const EMPTY_STREAMS: RecordingStreams = {
  time: [],
  latlng: [],
  altitude: [],
  heartrate: [],
  power: [],
  cadence: [],
  speed: [],
  distance: [],
};

function makeStreams(overrides: Partial<RecordingStreams>): RecordingStreams {
  return { ...EMPTY_STREAMS, ...overrides };
}

function pressed(overrides: Partial<RecordingLap>): RecordingLap {
  return {
    index: 0,
    startTime: 0,
    endTime: 0,
    startIndex: 0,
    endIndex: 0,
    movingEndTime: 0,
    distance: 0,
    avgSpeed: 0,
    avgHeartrate: null,
    avgPower: null,
    avgCadence: null,
    ...overrides,
  };
}

describe('summariseLap', () => {
  const bounds = {
    index: 0,
    startTime: 0,
    endTime: 10,
    startIndex: 1,
    endIndex: 1,
    movingEndTime: 10,
  };

  it('divides the lap distance by its moving time', () => {
    const streams = makeStreams({ time: [0, 10], distance: [0, 100] });
    expect(summariseLap(streams, bounds, 0).avgSpeed).toBe(10);
  });

  it.each([NaN, Infinity])('reads zero speed for a lap whose distance is %p', (distance) => {
    const streams = makeStreams({ time: [0, 10], distance: [0, distance] });
    expect(summariseLap(streams, bounds, 0).avgSpeed).toBe(0);
  });
});

describe('withClosingLap', () => {
  it('adds a lap from the last press to the end, over moving time', () => {
    const streams = makeStreams({
      time: [0, 10, 20, 30],
      distance: [0, 100, 150, 200],
      heartrate: [120, 140, NaN, 160],
    });
    const laps = withClosingLap(
      streams,
      [
        pressed({
          endTime: 10,
          endIndex: 1,
          movingEndTime: 10,
          distance: 100,
          avgSpeed: 10,
          avgHeartrate: 130,
        }),
      ],
      10
    );

    expect(laps).toHaveLength(2);
    expect(laps[1]).toMatchObject({
      index: 1,
      startTime: 10,
      endTime: 30,
      startIndex: 2,
      endIndex: 3,
      movingEndTime: 20,
      distance: 100,
      avgSpeed: 10,
      avgHeartrate: 160,
    });
  });

  it('writes one lap over the whole ride when none was pressed', () => {
    const laps = withClosingLap(makeStreams({ time: [0, 10], distance: [0, 100] }), [], 0);
    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({
      startTime: 0,
      endTime: 10,
      startIndex: 0,
      endIndex: 1,
      movingEndTime: 10,
      distance: 100,
      avgSpeed: 10,
    });
  });

  it('writes one empty lap for a recording with no sample', () => {
    const laps = withClosingLap(EMPTY_STREAMS, [], 0);
    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({ startTime: 0, endTime: 0, distance: 0, avgSpeed: 0 });
  });

  it('adds nothing when the last press is at the end of the ride', () => {
    const streams = makeStreams({ time: [0, 10], distance: [0, 100] });
    const last = pressed({ endTime: 10, endIndex: 1, movingEndTime: 10, distance: 100 });
    expect(withClosingLap(streams, [last], 0)).toEqual([last]);
  });

  it('does not take more pause than the ride held', () => {
    const streams = makeStreams({ time: [0, 10], distance: [0, 100] });
    const [lap] = withClosingLap(streams, [], 50);
    expect(lap?.movingEndTime).toBe(0);
    expect(lap?.avgSpeed).toBe(0);
  });
});

describe('rebaseLaps', () => {
  it('keeps the first lap at its original end after a 25-second first fix', () => {
    const streams = makeStreams({ time: [0, 575], distance: [0, 1000] });
    const rebased = rebaseLaps(
      [pressed({ endTime: 600, endIndex: 1, movingEndTime: 600, distance: 1000 })],
      streams,
      25,
      0,
      []
    );
    const [lap] = withClosingLap(streams, rebased, 0);

    expect(rebased).toHaveLength(1);
    expect(lap).toMatchObject({
      startTime: 0,
      endTime: 575,
      avgHeartrate: null,
      avgPower: null,
      avgCadence: null,
    });
  });

  it.each([
    {
      base: 25,
      from: 0,
      to: 4,
      expectedEnds: [35, 40],
      expectedDistances: [150, 150],
      expectedIndices: [
        [0, 2],
        [3, 3],
      ],
      expectedHeartRates: [140, 160],
    },
    {
      base: 65,
      from: 3,
      to: 5,
      expectedEnds: [25],
      expectedDistances: [100],
      expectedIndices: [[0, 1]],
      expectedHeartRates: [160],
    },
    {
      base: 45,
      from: 2,
      to: 4,
      expectedEnds: [15, 20],
      expectedDistances: [0, 150],
      expectedIndices: [
        [0, 0],
        [1, 1],
      ],
      expectedHeartRates: [null, 160],
    },
  ])(
    'rebases and clips saved laps at $base seconds',
    ({ base, from, to, expectedEnds, expectedDistances, expectedIndices, expectedHeartRates }) => {
      const original = makeStreams({
        time: [25, 35, 45, 65, 90],
        distance: [0, 100, 150, 300, 400],
        heartrate: [NaN, 140, 0, 160, Infinity],
        power: [null, 200, NaN, 250, null],
        cadence: [NaN, 80, 0, 90, 0],
      });
      const streams = Object.fromEntries(
        Object.entries(original).map(([key, values]) => [key, values.slice(from, to)])
      ) as unknown as RecordingStreams;
      streams.time = streams.time.map((t) => t - base);
      streams.distance = streams.distance.map((d) => d - (original.distance[from] ?? 0));
      const lap = (
        index: number,
        startTime: number,
        endTime: number,
        startIndex: number,
        endIndex: number
      ): RecordingLap =>
        pressed({
          index,
          startTime,
          endTime,
          startIndex,
          endIndex,
          movingEndTime: endTime,
          distance: 999,
          avgSpeed: 999,
          avgHeartrate: 999,
          avgPower: 999,
          avgCadence: 999,
        });

      const rebased = rebaseLaps(
        [lap(0, 0, 60, 0, 2), lap(1, 60, 100, 3, 4)],
        streams,
        base,
        from,
        []
      );
      expect(rebased.map((l) => [l.startIndex, l.endIndex])).toEqual(expectedIndices);

      const closed = withClosingLap(streams, rebased, 0);
      expect(closed.map((l) => l.endTime)).toEqual(expectedEnds);
      expect(closed.map((l) => l.distance)).toEqual(expectedDistances);
      expect(closed.map((l) => l.avgHeartrate)).toEqual(expectedHeartRates);
      expect(closed.at(-1)?.endTime).toBe(streams.time.at(-1));
      expect(closed.every((l) => l.startTime >= 0)).toBe(true);
    }
  );

  it('clips pauses crossing the trim and lap boundaries', () => {
    const streams = makeStreams({ time: [0, 10, 20, 40], distance: [0, 100, 200, 300] });
    const rebased = rebaseLaps(
      [pressed({ endTime: 40, endIndex: 2, movingEndTime: 20, distance: 200, avgSpeed: 10 })],
      streams,
      20,
      0,
      [
        { start: 10, end: 25 },
        { start: 35, end: 45 },
      ]
    );
    const closed = withClosingLap(streams, rebased, 15);

    const moving = closed.map((l, i) => l.movingEndTime - (closed[i - 1]?.movingEndTime ?? 0));
    expect(moving).toEqual([10, 15]);
    expect(closed.map((l) => Math.round(l.avgSpeed * 1000))).toEqual([20000, 6667]);
  });
});
