/**
 * Decode the engine's one track encoding, `codec::encode_polyline` in veloqrs.
 * The store holds the same stream inside a five-byte frame, and every encoded
 * track crossing the bridge carries it unframed.
 *
 * Stream:
 *   - point count as varint
 *   - elevation mode byte: 0 none, 1 every point, 2 some points
 *   - in mode 2, a presence bitmap of ceil(count/8) bytes, LSB first
 *   - per point: zigzag varint deltas of latitude and longitude at 1e6 counts
 *     per degree, then, where the point carries one, the zigzag varint delta of
 *     its elevation at 0.1 m
 *
 * A stream that is truncated, malformed, or claims more points than its bytes
 * could hold decodes to nothing, as the engine's own decoder refuses it.
 * `tests/fixtures/track_codec_vectors.json` in veloqrs pins the bytes both
 * sides read.
 */

const SCALE = 1e6;
const ELE_SCALE = 10;
const ELE_ALL = 1;
const ELE_MIXED = 2;

/** A coordinate as `lat`/`lng`, the shape routes, sections and map inputs are written in. */
export interface LatLngShort {
  lat: number;
  lng: number;
}

export interface LatLng {
  latitude: number;
  longitude: number;
  /** Metres; absent (never null or NaN) when the point carries none. */
  elevation?: number;
}

/**
 * Reads one little-endian base-128 varint at `pos` and returns it with the
 * position after it, or null when the bytes run out inside it. The value
 * accumulates by multiplication rather than the 32-bit shift operators, which
 * would wrap a value past 31 bits. The result is exact to 2^53.
 */
function varintAt(bytes: Uint8Array, pos: number): [number, number] | null {
  let result = 0;
  let scale = 1;
  while (pos < bytes.length) {
    const byte = bytes[pos++];
    result += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return [result, pos];
    scale *= 128;
  }
  return null;
}

/** Zigzag decode without bitwise operators, which truncate to 32 bits. */
function unzigzag(v: number): number {
  return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
}

/**
 * Walks the stream, handing each point to `visit`. False when the stream is
 * malformed, in which case the caller discards whatever was visited.
 */
function walk(
  buf: ArrayBuffer,
  start: (count: number) => void,
  visit: (lat: number, lng: number, elevation: number | undefined) => void
): boolean {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength === 0) return false;
  const bytes = new Uint8Array(buf);

  const head = varintAt(bytes, 0);
  if (head === null) return false;
  const [count] = head;
  let pos = head[1];
  // A varint can claim any count; two bytes a point is the least a point takes.
  if (count > Math.floor((bytes.length - pos) / 2)) return false;

  if (pos >= bytes.length) return false;
  const mode = bytes[pos++];
  let bitmap: Uint8Array | null = null;
  if (mode === ELE_MIXED) {
    const len = Math.ceil(count / 8);
    if (bytes.length < pos + len) return false;
    bitmap = bytes.subarray(pos, pos + len);
    pos += len;
  }

  start(count);
  let lat = 0;
  let lng = 0;
  let ele = 0;
  for (let i = 0; i < count; i++) {
    const dLat = varintAt(bytes, pos);
    if (dLat === null) return false;
    const dLng = varintAt(bytes, dLat[1]);
    if (dLng === null) return false;
    pos = dLng[1];
    lat += unzigzag(dLat[0]);
    lng += unzigzag(dLng[0]);

    const hasEle = mode === ELE_ALL || (bitmap !== null && (bitmap[i >> 3] & (1 << (i % 8))) !== 0);
    let elevation: number | undefined;
    if (hasEle) {
      const dEle = varintAt(bytes, pos);
      if (dEle === null) return false;
      pos = dEle[1];
      ele += unzigzag(dEle[0]);
      elevation = ele / ELE_SCALE;
    }
    visit(lat / SCALE, lng / SCALE, elevation);
  }
  return true;
}

/**
 * The coordinates alone, as a flat `[lat, lng, lat, lng, ...]` array.
 *
 * The map's signature read decodes a library's worth of these at once, 58,660
 * points on a 838-activity library, and measured 56 ms under Hermes on an S22
 * as objects. A point that is two slots of one typed array allocates nothing,
 * and the caller that wants a pair builds only the pairs it keeps.
 *
 * Elevations are read past and not kept: no caller of this wants them.
 */
export function decodeCoordsFlat(buf: ArrayBuffer): Float64Array {
  let out = new Float64Array(0);
  let written = 0;
  const ok = walk(
    buf,
    (count) => {
      out = new Float64Array(count * 2);
    },
    (lat, lng) => {
      out[written++] = lat;
      out[written++] = lng;
    }
  );
  return ok ? out : new Float64Array(0);
}

export function decodeCoords(buf: ArrayBuffer): LatLng[] {
  const points: LatLng[] = [];
  const ok = walk(
    buf,
    () => {},
    (latitude, longitude, elevation) => {
      points.push(
        elevation === undefined ? { latitude, longitude } : { latitude, longitude, elevation }
      );
    }
  );
  return ok ? points : [];
}
