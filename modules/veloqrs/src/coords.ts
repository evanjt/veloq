/**
 * Decode delta+zigzag-varint encoded GPS coordinates from Rust.
 *
 * Wire format:
 *   - point_count as varint
 *   - First point: lat_scaled as zigzag varint i64, lng_scaled as zigzag varint i64
 *   - Subsequent: delta_lat as zigzag varint, delta_lng as zigzag varint
 *   - Optional trailing elevation section, present only when at least one
 *     point carries an elevation:
 *       - 0xE1 tag byte
 *       - mode byte: bit 0 set means a presence bitmap follows, bit 1 set
 *         means exact f64 LE payloads rather than quantised deltas
 *       - presence bitmap of ceil(count/8) bytes, LSB first, when bit 0 is set
 *       - per elevation-bearing point, in point order: a zigzag varint delta
 *         of the 0.1 m quantised value, or 8 little-endian f64 bytes
 *
 * Coordinates scaled by 1e7 (~0.011m precision).
 *
 * A truncated or malformed elevation section stops where the bytes run out,
 * keeps the elevations already decoded, and never disturbs the coordinates.
 */

const SCALE = 1e7;
const ELE_SCALE = 10;
const ELE_TAG = 0xe1;
const ELE_MIXED = 0b01;
const ELE_EXACT = 0b10;

export interface LatLng {
  latitude: number;
  longitude: number;
  /** Metres; absent (never null or NaN) when the point carries none. */
  elevation?: number;
}

/**
 * The coordinates alone, as a flat `[lat, lng, lat, lng, ...]` array.
 *
 * The map's signature read decodes a library's worth of these at once, 58,660
 * points on a 838-activity library, and measured 56 ms under Hermes on an S22
 * as objects. A point that is two slots of one typed array allocates nothing,
 * and the caller that wants a pair builds only the pairs it keeps.
 *
 * Elevations are not carried: no caller of this wants them, and reading them
 * would cost the allocation this exists to avoid.
 */
export function decodeCoordsFlat(buf: ArrayBuffer): Float64Array {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength === 0) {
    return new Float64Array(0);
  }
  const bytes = new Uint8Array(buf);
  let pos = 0;

  const readVarint = (): number => {
    let result = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  };

  const readZigzag = (): number => {
    const v = readVarint();
    return (v >>> 1) ^ -(v & 1);
  };

  const count = readVarint();
  const out = new Float64Array(count * 2);

  let lat = 0;
  let lng = 0;
  let written = 0;

  for (let i = 0; i < count; i++) {
    if (pos >= bytes.length) break;
    lat += readZigzag();
    lng += readZigzag();
    out[written++] = lat / SCALE;
    out[written++] = lng / SCALE;
  }

  // A truncated stream stops where the bytes ran out, the same as the object
  // decoder, so the pairs that did arrive are all real.
  return written === out.length ? out : out.subarray(0, written);
}

export function decodeCoords(buf: ArrayBuffer): LatLng[] {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength === 0) {
    return [];
  }
  const bytes = new Uint8Array(buf);
  let pos = 0;

  const readVarint = (): number => {
    let result = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  };

  const readZigzag = (): number => {
    const v = readVarint();
    return (v >>> 1) ^ -(v & 1);
  };

  const count = readVarint();
  const points: LatLng[] = [];

  let lat = 0;
  let lng = 0;

  for (let i = 0; i < count; i++) {
    if (pos >= bytes.length) break;
    lat += readZigzag();
    lng += readZigzag();
    points.push({
      latitude: lat / SCALE,
      longitude: lng / SCALE,
    });
  }

  // Elevation section, mirroring the Rust read_elevations early returns.
  if (pos >= bytes.length || bytes[pos] !== ELE_TAG) return points;
  pos++;
  if (pos >= bytes.length) return points;
  const mode = bytes[pos++];

  const exact = (mode & ELE_EXACT) !== 0;
  let bitmap: Uint8Array | null = null;
  if ((mode & ELE_MIXED) !== 0) {
    const len = Math.ceil(points.length / 8);
    if (bytes.length < pos + len) return points;
    bitmap = bytes.subarray(pos, pos + len);
    pos += len;
  }

  const view = new DataView(buf);
  let prev = 0;
  for (let i = 0; i < points.length; i++) {
    if (bitmap !== null && (bitmap[i >> 3] & (1 << (i % 8))) === 0) {
      continue;
    }
    if (exact) {
      if (bytes.length < pos + 8) return points;
      points[i].elevation = view.getFloat64(pos, true);
      pos += 8;
    } else {
      if (pos >= bytes.length) return points;
      prev += readZigzag();
      points[i].elevation = prev / ELE_SCALE;
    }
  }

  return points;
}
