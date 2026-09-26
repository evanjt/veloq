/**
 * Scenario: the map's signature rebuild decodes a library's worth of tracks at
 * once, 58,660 points on a 838-activity library, and every point that was an
 * object was an allocation the map never kept. Measured at 56 ms under Hermes
 * on an S22.
 *
 * Expected behaviour: the flat decoder reads the same wire format and reports
 * the same coordinates as the object one, pair for pair, including where a
 * track is truncated, carries an elevation section it must ignore, or is empty.
 */

import { decodeCoords, decodeCoordsFlat } from '../../../modules/veloqrs/src/coords';

function buffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

/** 2 points, (1e-7, 2e-7) and (3e-7, 4e-7), the vector the Rust suite pins. */
const TWO_POINTS = [0x02, 0x02, 0x04, 0x04, 0x04];

/** The same coordinates the object decoder reports, flattened. */
function asPairs(buf: ArrayBuffer): number[] {
  return decodeCoords(buf).flatMap((p) => [p.latitude, p.longitude]);
}

describe('the flat coordinate decoder', () => {
  it('reports what the object decoder reports', () => {
    const buf = buffer(TWO_POINTS);

    expect(Array.from(decodeCoordsFlat(buf))).toEqual(asPairs(buf));
  });

  it('reads two slots per point', () => {
    const flat = decodeCoordsFlat(buffer(TWO_POINTS));

    expect(flat).toHaveLength(4);
    expect(flat[0]).toBeCloseTo(1e-7, 12);
    expect(flat[1]).toBeCloseTo(2e-7, 12);
    expect(flat[2]).toBeCloseTo(3e-7, 12);
    expect(flat[3]).toBeCloseTo(4e-7, 12);
  });

  it('ignores an elevation section rather than reading it into the pairs', () => {
    const withElevations = buffer([...TWO_POINTS, 0xe1, 0x00, 0xd0, 0x0f, 0x0a]);

    expect(Array.from(decodeCoordsFlat(withElevations))).toEqual(asPairs(withElevations));
    expect(decodeCoordsFlat(withElevations)).toHaveLength(4);
  });

  it('stops where a truncated stream ran out, keeping the pairs that arrived', () => {
    // Says three points and carries two.
    const truncated = buffer([0x03, 0x02, 0x04, 0x04, 0x04]);

    expect(Array.from(decodeCoordsFlat(truncated))).toEqual(asPairs(truncated));
    expect(decodeCoordsFlat(truncated)).toHaveLength(4);
  });

  it('answers an empty track for empty bytes', () => {
    expect(decodeCoordsFlat(new ArrayBuffer(0))).toHaveLength(0);
    expect(decodeCoordsFlat(buffer([0x00]))).toHaveLength(0);
  });

  it('allocates one array rather than one object per point', () => {
    const flat = decodeCoordsFlat(buffer(TWO_POINTS));

    expect(ArrayBuffer.isView(flat)).toBe(true);
    expect(flat).toBeInstanceOf(Float64Array);
  });
});
