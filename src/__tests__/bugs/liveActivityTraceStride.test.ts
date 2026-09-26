/**
 * Scenario: a five-hour ride refreshes the Live Activity card every five
 * seconds, and the card draws a 150-point outline of the track so far.
 * Expected behaviour: building the card reads a sample of the track, not all
 * of it. The store already holds `[lat, lng]` pairs, so a projection into
 * objects is one throwaway object per fix for the 150 the outline keeps.
 */

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  refreshLiveActivity,
  beginLiveActivity,
  finishLiveActivity,
} from '@/features/recording/lib/liveActivity/controller';
import { composeRouteOutline, ROUTE_OUTLINE_MAX_POINTS } from '@/shared/geo/routePreview';

const mockNative = {
  addListener: jest.fn(() => ({ remove: () => {} })),
  isSupported: jest.fn(() => true),
  start: jest.fn(() => 'activity-1'),
  update: jest.fn(),
  end: jest.fn(),
  endAll: jest.fn(),
};

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(() => mockNative),
}));

/** An array that says how many of its elements were looked at. */
function countingTrack(length: number): { track: [number, number][]; reads: () => number } {
  let reads = 0;
  const raw: [number, number][] = Array.from({ length }, (_, i) => [
    46.0 + i * 0.00001,
    7.0 + i * 0.00001,
  ]);
  const track = new Proxy(raw, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { track, reads: () => reads };
}

function ride(track: [number, number][]): void {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.setState({
    startTime: Date.now() - 300_000,
    streams: { ...useRecordingStore.getState().streams, latlng: track, distance: [12_345] },
  });
}

describe('the live activity card samples the track', () => {
  beforeEach(() => {
    finishLiveActivity();
    jest.clearAllMocks();
    useRecordingStore.getState().reset();
  });

  it('reads a sample of a long ride, not every fix', () => {
    const { track, reads } = countingTrack(10_000);
    ride(track);
    beginLiveActivity();

    expect(mockNative.start).toHaveBeenCalled();
    // The outline keeps 150 points and adds the last one, so a couple of
    // hundred reads is the sample. Ten thousand is a copy of the ride.
    expect(reads()).toBeLessThan(ROUTE_OUTLINE_MAX_POINTS * 3);
  });

  it('reads a sample on every refresh too, not just the first build', () => {
    const { track, reads } = countingTrack(10_000);
    ride(track);
    beginLiveActivity();
    const afterStart = reads();
    refreshLiveActivity();

    expect(mockNative.update).toHaveBeenCalled();
    expect(reads() - afterStart).toBeLessThan(ROUTE_OUTLINE_MAX_POINTS * 3);
  });

  it('draws the same outline from pairs as from points', () => {
    const pairs: [number, number][] = Array.from({ length: 400 }, (_, i) => [
      46.0 + i * 0.0001,
      7.0 + i * 0.0002,
    ]);
    const points = pairs.map(([latitude, longitude]) => ({ latitude, longitude }));

    expect(composeRouteOutline(pairs)).toEqual(composeRouteOutline(points));
  });

  it('skips a pair whose numbers are not finite, the same as a point', () => {
    const pairs: [number, number][] = [
      [46.0, 7.0],
      [NaN, 7.1],
      [46.2, 7.2],
    ];
    const outline = composeRouteOutline(pairs, 10);

    expect(outline?.points).toHaveLength(2);
  });

  it('has nothing to draw from a single pair', () => {
    expect(composeRouteOutline([[46.0, 7.0]])).toBeNull();
  });
});
