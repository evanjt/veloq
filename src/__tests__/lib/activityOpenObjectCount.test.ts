/**
 * Scenario: a five-hour ride opens with 18,000 samples read from the engine's
 * stream store. A demo library never reaches this path, since its streams come
 * from the generator, so a session measured on demo data reads flat whatever
 * the real decode allocates.
 * Expected behaviour: an open builds a bounded number of objects per sample,
 * counted rather than timed. The count covers what the decoder hands back,
 * kept or dropped, and everything the streams and the map line retain. A copy
 * made and dropped elsewhere on the way is garbage, not growth, and not seen.
 */

import { readStreams, DETAIL_STREAM_TYPES } from '@/features/activity/lib/engineStreams';
import { resolveDetailCoordinates } from '@/features/activity/lib/detailCoordinates';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { streamBuffers } from '../__shared__/streamBuffers';
import { encodeTrack } from '../__shared__/trackBytes';

const mockDecoded: unknown[] = [];

jest.mock('veloqrs', () =>
  require('@/__tests__/__shared__/veloqrsStub').withOverrides(
    Object.fromEntries(
      ['decodeCoords', 'decodeCoordsFlat'].map((name) => {
        const decode = jest.requireActual('../../../modules/veloqrs/src/coords')[name];
        return [
          name,
          (buf: ArrayBuffer) => {
            const out = decode(buf);
            mockDecoded.push(out);
            return out;
          },
        ];
      })
    )
  )
);

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const SAMPLES = 18_000;

// Three per sample is what an open builds today: the decoder's point object,
// the pair the streams keep and the object the map line keeps. The count only
// moves down from here.
const OBJECTS_PER_SAMPLE = 3;

function longRide(samples: number) {
  const series = (f: (i: number) => number) => Array.from({ length: samples }, (_, i) => f(i));
  return streamBuffers({
    latlng: encodeTrack(
      Array.from({ length: samples }, (_, i) => ({
        latitude: 46 + i * 1e-5,
        longitude: 7 + i * 1e-5,
      }))
    ),
    time: series((i) => i),
    altitude: series((i) => 400 + (i % 100)),
    heartrate: series((i) => 120 + (i % 40)),
    watts: series((i) => 180 + (i % 60)),
    cadence: series((i) => 85 + (i % 10)),
    velocitySmooth: series((i) => 8 + (i % 5) * 0.1),
    distance: series((i) => i * 8),
    gradeSmooth: series((i) => (i % 20) - 10),
    temp: series(() => 18),
    wbal: series((i) => 20_000 - (i % 500)),
    gap: series((i) => 4 + (i % 7) * 0.1),
  });
}

/** Every distinct object reachable from the roots, typed arrays counted once. */
function countObjects(roots: unknown[]): number {
  const seen = new Set<object>();
  const stack: unknown[] = [...roots];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
    for (const child of Object.values(value)) stack.push(child);
  }
  return seen.size;
}

function openActivity(samples: number): { objects: number; points: number } {
  const engine = { getActivityStreams: jest.fn(() => longRide(samples)) };
  (getEngine as jest.Mock).mockReturnValue(engine);
  mockDecoded.length = 0;

  const streams = readStreams('ride-1', DETAIL_STREAM_TYPES);
  const coordinates = resolveDetailCoordinates({ streamLatLng: streams?.latlng });

  return {
    objects: countObjects([streams, coordinates, ...mockDecoded]),
    points: coordinates.length,
  };
}

describe('opening a long ride from stored streams', () => {
  beforeEach(() => {
    useAuthStore.setState({ isDemoMode: false });
  });

  it('runs the stored-stream decode, not the demo generator', () => {
    const { points } = openActivity(SAMPLES);

    expect(points).toBe(SAMPLES);
    expect(mockDecoded.length).toBeGreaterThan(0);
  });

  it('builds a bounded number of objects per sample', () => {
    const { objects } = openActivity(SAMPLES);

    expect(objects).toBeLessThanOrEqual(SAMPLES * OBJECTS_PER_SAMPLE + 50);
  });

  it('grows its object count with the ride, not faster', () => {
    const short = openActivity(SAMPLES / 4).objects;
    const long = openActivity(SAMPLES).objects;

    expect(long - short).toBeLessThanOrEqual((SAMPLES - SAMPLES / 4) * OBJECTS_PER_SAMPLE);
  });
});
