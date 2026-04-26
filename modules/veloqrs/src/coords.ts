/**
 * Decode delta+zigzag-varint encoded GPS coordinates from Rust.
 *
 * Wire format:
 *   - point_count as varint
 *   - First point: lat_scaled as zigzag varint i64, lng_scaled as zigzag varint i64
 *   - Subsequent: delta_lat as zigzag varint, delta_lng as zigzag varint
 *
 * Coordinates scaled by 1e7 (~0.011m precision).
 */

const SCALE = 1e7;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function decodeCoords(buf: ArrayBuffer): LatLng[] {
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
  const points: LatLng[] = new Array(count);

  let lat = 0;
  let lng = 0;

  for (let i = 0; i < count; i++) {
    lat += readZigzag();
    lng += readZigzag();
    points[i] = {
      latitude: lat / SCALE,
      longitude: lng / SCALE,
    };
  }

  return points;
}
