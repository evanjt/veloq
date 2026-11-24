/**
 * Scenario: the location service hands over a cached fix taken before the ride began.
 * Expected behaviour: the fix is dropped, so no sample has a negative time and the
 * next real fix does not add the distance from the cached position.
 */

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const T = 1_700_000_000_000;

function fix(offsetMs: number, latitude: number) {
  return {
    latitude,
    longitude: 8,
    altitude: 400,
    speed: 0,
    heading: 0,
    accuracy: 5,
    timestamp: T + offsetMs,
  };
}

describe('a fix older than the ride start', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T);
    useRecordingStore.getState().reset();
    useRecordingStore.getState().startRecording('Ride', 'gps');
  });

  afterEach(() => {
    useRecordingStore.getState().reset();
    jest.useRealTimers();
  });

  it('keeps only the fix taken after the start, at distance zero', () => {
    const { addGpsPoint } = useRecordingStore.getState();
    addGpsPoint(fix(-60_000, 46.0));
    addGpsPoint(fix(1_000, 46.045));
    const { streams } = useRecordingStore.getState();
    expect(streams.time).toEqual([1]);
    expect(streams.distance[0]).toBe(0);
  });

  it('keeps a fix taken exactly at the start', () => {
    useRecordingStore.getState().addGpsPoint(fix(0, 46.0));
    expect(useRecordingStore.getState().streams.time).toEqual([0]);
  });
});
