import { streamsFromBuffers } from '@/features/activity/lib/streams';
import type { ActivityStreamBuffers } from 'veloqrs';

jest.mock('veloqrs', () =>
  require('@/__tests__/__shared__/veloqrsStub').withOverrides({
    decodeCoords: jest.requireActual('../../../../../modules/veloqrs/src/coords').decodeCoords,
  })
);

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

    expect(streams.time).toEqual([0, 5, 10]);
    expect(streams.heartrate).toEqual([120, NaN, 140]);
    expect(streams.velocity_smooth).toEqual([3.5, 3.6, 3.7]);
    expect(streams.grade_smooth).toEqual([0.1, 0.2, 0.3]);
    expect(streams.wbal).toEqual([20000, 19900, 19800]);
    expect(streams.gap).toEqual([5.5, 5.6, 5.7]);
  });

  it('reads the coordinates from the engine track encoding as [lat, lng] pairs', () => {
    const bytes = Uint8Array.from([1, 0, 128, 158, 132, 43, 226, 183, 160, 8]);

    const streams = streamsFromBuffers(buffers({ latlng: bytes.buffer as ArrayBuffer }));

    expect(streams.latlng).toEqual([[45.123456, 8.654321]]);
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

    expect(streams.distance).toEqual(values);
  });
});
