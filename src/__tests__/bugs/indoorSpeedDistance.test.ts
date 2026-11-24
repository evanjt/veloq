/**
 * Scenario: an indoor run records with a foot pod, or with heart rate alone.
 *
 * Expected behaviour: distance accumulates from the fresh speed over the elapsed
 * time, and a missing or stale speed is stored as no reading, never as 0 m/s.
 */

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const START = 1_000_000;

function startIndoor() {
  useRecordingStore.setState({
    status: 'recording',
    mode: 'indoor',
    startTime: START,
    latestSensor: { heartrate: null, power: null, cadence: null, speed: null },
    streams: {
      time: [],
      latlng: [],
      altitude: [],
      speed: [],
      distance: [],
      heartrate: [],
      power: [],
      cadence: [],
    } as never,
  });
}

function sampleAt(offsetMs: number) {
  jest.spyOn(Date, 'now').mockReturnValue(START + offsetMs);
  useRecordingStore.getState().addIndoorSample();
}

beforeEach(startIndoor);
afterEach(() => jest.restoreAllMocks());

it('accumulates indoor distance from a fresh speed sensor', () => {
  jest.spyOn(Date, 'now').mockReturnValue(START);
  useRecordingStore.getState().setSensorSample('speed', 3);
  sampleAt(0 + 1);
  sampleAt(1000);
  const { distance } = useRecordingStore.getState().streams;
  expect(distance).toHaveLength(2);
  expect(distance[0]).toBe(0);
  expect(distance[1]).toBeCloseTo((3 * (1000 - 1)) / 1000, 5);
});

it('stores an absent speed sensor as a missing value, not 0 m/s', () => {
  sampleAt(1000);
  const { speed, distance } = useRecordingStore.getState().streams;
  expect(speed[0] === null || Number.isNaN(speed[0])).toBe(true);
  expect(distance).toEqual([0]);
});

it('stores a stale speed as missing and adds no distance', () => {
  jest.spyOn(Date, 'now').mockReturnValue(START);
  useRecordingStore.getState().setSensorSample('speed', 3);
  sampleAt(1000);
  sampleAt(60_000);
  const { speed, distance } = useRecordingStore.getState().streams;
  expect(Number.isNaN(speed[1] as number) || speed[1] === null).toBe(true);
  expect(distance[1]).toBe(distance[0]);
});
