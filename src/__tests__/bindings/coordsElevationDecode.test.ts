/**
 * Byte-literal vectors shared with the Rust suite
 * (modules/veloqrs/rust/veloqrs/src/coords.rs, mod shared_vectors). Both
 * suites assert the same bytes verbatim, pinning the wire format on both
 * sides.
 */

import { decodeCoords, type LatLng } from '../../../modules/veloqrs/src/coords';

// 2 points, (1e-7, 2e-7) and (3e-7, 4e-7).
const PREFIX = [0x02, 0x02, 0x04, 0x04, 0x04];

function buffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function withSuffix(suffix: number[]): ArrayBuffer {
  return buffer([...PREFIX, ...suffix]);
}

function expectCoordsIntact(decoded: LatLng[]) {
  expect(decoded).toHaveLength(2);
  expect(decoded[0].latitude).toBeCloseTo(1e-7, 12);
  expect(decoded[0].longitude).toBeCloseTo(2e-7, 12);
  expect(decoded[1].latitude).toBeCloseTo(3e-7, 12);
  expect(decoded[1].longitude).toBeCloseTo(4e-7, 12);
}

function elevations(decoded: LatLng[]): (number | undefined)[] {
  return decoded.map((p) => p.elevation);
}

describe('decodeCoords elevation section', () => {
  it('V1: all present, quantised deltas', () => {
    const decoded = decodeCoords(withSuffix([0xe1, 0x00, 0xd0, 0x0f, 0x0a]));
    expectCoordsIntact(decoded);
    expect(elevations(decoded)).toEqual([100.0, 100.5]);
  });

  it('V2: bitmap, quantised', () => {
    const decoded = decodeCoords(withSuffix([0xe1, 0x01, 0x01, 0xd0, 0x0f]));
    expectCoordsIntact(decoded);
    expect(elevations(decoded)).toEqual([100.0, undefined]);
  });

  it('V3: all present, exact f64 LE', () => {
    const decoded = decodeCoords(
      withSuffix([
        0xe1, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x59, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0xf8, 0xbf,
      ])
    );
    expectCoordsIntact(decoded);
    expect(elevations(decoded)).toEqual([100.25, -1.5]);
  });

  it('V4: bitmap, exact', () => {
    const decoded = decodeCoords(
      withSuffix([0xe1, 0x03, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x59, 0x40])
    );
    expectCoordsIntact(decoded);
    expect(elevations(decoded)).toEqual([undefined, 100.25]);
  });

  it('V5: truncated after mode byte', () => {
    const decoded = decodeCoords(withSuffix([0xe1, 0x00]));
    expectCoordsIntact(decoded);
    expect(elevations(decoded)).toEqual([undefined, undefined]);
  });

  it('V6: truncated mid-varint pins partial-value semantics', () => {
    const decoded = decodeCoords(withSuffix([0xe1, 0x00, 0xd0]));
    expectCoordsIntact(decoded);
    expect(elevations(decoded)).toEqual([4.0, undefined]);
  });

  it('V7: prefix alone, elevation-free payload', () => {
    const decoded = decodeCoords(buffer(PREFIX));
    expectCoordsIntact(decoded);
    expect(elevations(decoded)).toEqual([undefined, undefined]);
  });

  it('every prefix cut of V1 decodes without throwing', () => {
    const full = [...PREFIX, 0xe1, 0x00, 0xd0, 0x0f, 0x0a];
    for (let cut = 0; cut < full.length; cut++) {
      const decoded = decodeCoords(buffer(full.slice(0, cut)));
      expect(decoded.length).toBeLessThanOrEqual(2);
      for (const p of decoded) {
        expect(p.elevation === undefined || Number.isFinite(p.elevation)).toBe(true);
      }
    }
  });

  it('elevation stays absent, never null or NaN, on legacy payloads', () => {
    const decoded = decodeCoords(buffer(PREFIX));
    for (const p of decoded) {
      expect('elevation' in p).toBe(false);
    }
  });
});
