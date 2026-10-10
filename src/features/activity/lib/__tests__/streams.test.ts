import { resolveDetailCoordinates } from '@/features/activity/lib/detailCoordinates';
import { streamsFromBuffers } from '@/features/activity/lib/streams';
import { encodeTrack } from '@/__tests__/__shared__/trackBytes';
import { decodeCoords as decodeTrack } from '../../../../../modules/veloqrs/src/coords';
import type { ActivityStreamBuffers } from 'veloqrs';

const mockDecodeCoords = jest.fn();

jest.mock('veloqrs', () => {
  const coords = jest.requireActual('../../../../../modules/veloqrs/src/coords');
  return require('@/__tests__/__shared__/veloqrsStub').withOverrides({
    decodeCoords: (buf: ArrayBuffer) => {
      mockDecodeCoords(buf);
      return coords.decodeCoords(buf);
    },
    decodeCoordsFlat: coords.decodeCoordsFlat,
  });
});

beforeEach(() => mockDecodeCoords.mockClear());

function floats(values: number[]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(values.length * 8));
  values.forEach((v, i) => view.setFloat64(i * 8, v, true));
  return view.buffer as ArrayBuffer;
}

const NONE = new ArrayBuffer(0);

function buffers(overrides: Partial<ActivityStreamBuffers>): ActivityStreamBuffers {
  return {
    latlng: NONE,
    time: NONE,
    altitude: NONE,
    heartrate: NONE,
    watts: NONE,
    cadence: NONE,
    velocitySmooth: NONE,
    distance: NONE,
    gradeSmooth: NONE,
    temp: NONE,
    wbal: NONE,
    gap: NONE,
    ...overrides,
  };
}

/**
 * Scenario: the engine hands over each series as little-endian floats.
 * Expected behaviour: a present series reads as the numbers the engine wrote,
 * a gap stays NaN, and a series the activity lacks is absent rather than empty.
 */
describe('streamsFromBuffers', () => {
  it('reads each series under the name the charts use', () => {
    const streams = streamsFromBuffers(
      buffers({
        time: floats([0, 5, 10]),
        heartrate: floats([120, NaN, 140]),
        velocitySmooth: floats([3.5, 3.6, 3.7]),
        gradeSmooth: floats([0.1, 0.2, 0.3]),
        wbal: floats([20000, 19900, 19800]),
        gap: floats([5.5, 5.6, 5.7]),
      })
    );

    expect(streams.time).toEqual(new Float64Array([0, 5, 10]));
    expect(streams.heartrate).toEqual(new Float64Array([120, NaN, 140]));
    expect(streams.velocity_smooth).toEqual(new Float64Array([3.5, 3.6, 3.7]));
    expect(streams.grade_smooth).toEqual(new Float64Array([0.1, 0.2, 0.3]));
    expect(streams.wbal).toEqual(new Float64Array([20000, 19900, 19800]));
    expect(streams.gap).toEqual(new Float64Array([5.5, 5.6, 5.7]));
  });

  it('reads the coordinates from the engine track encoding as flat lat, lng slots', () => {
    const bytes = Uint8Array.from([1, 0, 128, 158, 132, 43, 226, 183, 160, 8]);

    const streams = streamsFromBuffers(buffers({ latlng: bytes.buffer as ArrayBuffer }));

    expect(streams.latlng).toEqual(new Float64Array([45.123456, 8.654321]));
  });

  it('leaves out the coordinates of an activity with no track', () => {
    const streams = streamsFromBuffers(buffers({ watts: floats([200]) }));

    expect(streams).not.toHaveProperty('latlng');
  });

  it('leaves out a series the activity does not have', () => {
    const streams = streamsFromBuffers(buffers({ watts: floats([200]) }));

    expect(Object.keys(streams)).toEqual(['watts']);
  });

  it('reads a buffer that is not whole samples as absent', () => {
    const streams = streamsFromBuffers(buffers({ watts: new ArrayBuffer(12) }));

    expect(streams.watts).toBeUndefined();
  });

  it('keeps every sample of a long series exactly', () => {
    const values = Array.from({ length: 20_000 }, (_, i) => i * 0.1 + 1e-9);

    const streams = streamsFromBuffers(buffers({ distance: floats(values) }));

    expect(streams.distance).toEqual(new Float64Array(values));
  });

  it('views each series over the buffer the engine handed over rather than copying it', () => {
    const watts = floats([200, 210, 220]);
    const time = floats([0, 1, 2]);

    const streams = streamsFromBuffers(buffers({ watts, time }));

    expect(streams.watts).toBeInstanceOf(Float64Array);
    expect(streams.watts!.buffer).toBe(watts);
    expect(streams.time!.buffer).toBe(time);
  });
});

/**
 * Scenario: a four-hour ride at one sample a second opens on the detail
 * screen, the stream body to hand.
 * Expected behaviour: the track stays one flat typed array from the decoder to
 * the map's points, read once per slot, with no per-point object or tuple in
 * between, and a point the map cannot place keeps its index so the track and
 * the series stay aligned.
 */
describe('the detail track from the stream body', () => {
  const SAMPLES = 21_600;

  function longRide() {
    return Array.from({ length: SAMPLES }, (_, i) => ({
      latitude: -37.8 + i * 0.00001,
      longitude: 144.9 + i * 0.00002,
    }));
  }

  function counting(values: Float64Array) {
    let reads = 0;
    const proxy = new Proxy(values, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { proxy, reads: () => reads };
  }

  it('holds the track as two slots a point, without the object decoder', () => {
    const streams = streamsFromBuffers(buffers({ latlng: encodeTrack(longRide()) }));

    expect(streams.latlng).toBeInstanceOf(Float64Array);
    expect(streams.latlng).toHaveLength(SAMPLES * 2);
    expect(mockDecodeCoords).not.toHaveBeenCalled();
  });

  it('builds the map points reading each slot once, equal to what the decoder reads', () => {
    const encoded = encodeTrack(longRide());
    const streams = streamsFromBuffers(buffers({ latlng: encoded }));
    const { proxy, reads } = counting(streams.latlng!);

    const coords = resolveDetailCoordinates({ streamLatLng: proxy });

    expect(reads()).toBe(SAMPLES * 2);
    expect(coords).toHaveLength(SAMPLES);
    expect(coords).toEqual(decodeTrack(encoded));
  });

  it('keeps a point it cannot place at its index', () => {
    const coords = resolveDetailCoordinates({
      streamLatLng: new Float64Array([-37.0, 144.0, NaN, NaN, -37.1, 144.1]),
    });

    expect(coords).toHaveLength(3);
    expect(coords[0]).toEqual({ latitude: -37.0, longitude: 144.0 });
    expect(coords[1].latitude).toBeNaN();
    expect(coords[1].longitude).toBeNaN();
    expect(coords[2]).toEqual({ latitude: -37.1, longitude: 144.1 });
  });
});
