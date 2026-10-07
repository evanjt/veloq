/**
 * Scenario: the engine stores a track in one quantised stream and hands the
 * same stream across the bridge, so the decoder here reads exactly what the
 * engine writes. The vectors are the file the Rust codec suite encodes to, byte
 * for byte, so a change to the stream on either side fails both suites.
 *
 * Expected behaviour: every vector decodes to its points, coordinates to six
 * decimals and elevation to a decimetre, an absent elevation stays absent
 * rather than reading as sea level, the flat decoder reports the same pairs,
 * and a stream cut short decodes to nothing, as the engine's decoder does.
 */

import fs from 'fs';
import path from 'path';

import { decodeCoords, decodeCoordsFlat } from '../../../modules/veloqrs/src/coords';
import { encodeTrack } from '../__shared__/trackBytes';

interface Vector {
  name: string;
  points: [number, number, number | null][];
  bytes: number[];
}

const VECTORS: Vector[] = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      '../../../modules/veloqrs/rust/veloqrs/tests/fixtures/track_codec_vectors.json'
    ),
    'utf-8'
  )
).cases;

function buffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('the track stream the engine writes', () => {
  it('has vectors to read', () => {
    expect(VECTORS.length).toBeGreaterThan(0);
  });

  it.each(VECTORS.map((v) => [v.name, v] as const))('decodes %s', (_name, vector) => {
    const decoded = decodeCoords(buffer(vector.bytes));

    expect(decoded).toHaveLength(vector.points.length);
    decoded.forEach((point, i) => {
      const [lat, lng, ele] = vector.points[i];
      expect(point.latitude).toBeCloseTo(lat, 6);
      expect(point.longitude).toBeCloseTo(lng, 6);
      if (ele === null) {
        expect(point).not.toHaveProperty('elevation');
      } else {
        expect(point.elevation).toBeCloseTo(ele, 1);
      }
    });
  });

  it.each(VECTORS.map((v) => [v.name, v] as const))(
    'decodes %s flat to the same pairs',
    (_name, vector) => {
      const buf = buffer(vector.bytes);
      const pairs = decodeCoords(buf).flatMap((p) => [p.latitude, p.longitude]);

      expect(Array.from(decodeCoordsFlat(buf))).toEqual(pairs);
    }
  );

  it.each(VECTORS.map((v) => [v.name, v] as const))(
    'decodes every cut of %s to nothing',
    (_name, vector) => {
      for (let cut = 0; cut < vector.bytes.length; cut++) {
        const torn = buffer(vector.bytes.slice(0, cut));
        expect(decodeCoords(torn)).toEqual([]);
        expect(decodeCoordsFlat(torn)).toHaveLength(0);
      }
    }
  );

  it.each(VECTORS.map((v) => [v.name, v] as const))(
    'builds %s in the test helper byte for byte',
    (_name, vector) => {
      const points = vector.points.map(([latitude, longitude, elevation]) =>
        elevation === null ? { latitude, longitude } : { latitude, longitude, elevation }
      );

      expect(Array.from(new Uint8Array(encodeTrack(points)))).toEqual(vector.bytes);
    }
  );

  it('refuses a count the bytes cannot hold', () => {
    // 200 points claimed, one mode byte and four bytes of body.
    const claimed = buffer([0xc8, 0x01, 0x00, 0x02, 0x02, 0x02, 0x02]);

    expect(decodeCoords(claimed)).toEqual([]);
    expect(decodeCoordsFlat(claimed)).toHaveLength(0);
  });

  it('reads nothing from something that is not a buffer', () => {
    expect(decodeCoords(undefined as unknown as ArrayBuffer)).toEqual([]);
    expect(decodeCoordsFlat(new ArrayBuffer(0))).toHaveLength(0);
  });
});
