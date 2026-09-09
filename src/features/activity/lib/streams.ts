import type { RawStreamItem, ActivityStreams } from '@/types';
import { paceMinutesFromSpeed } from '@/shared/math/kinematics';

/**
 * A coordinate the engine will store. Mirrors `is_storable` in
 * `net/types.rs`, so a point the engine drops is dropped here too.
 */
function isStorable(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Sample validity taken from `latlng`: true where both lat and lng are
 * storable. `null` when the response carries no usable `latlng`, in which case
 * every series keeps its own length.
 */
function latlngMask(rawStreams: RawStreamItem[]): boolean[] | null {
  const s = rawStreams.find((x) => x.type === 'latlng');
  if (!s?.data || !s.data2) return null;
  const n = Math.min(s.data.length, s.data2.length);
  const mask: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const lat = s.data[i];
    const lng = s.data2[i];
    mask[i] = lat != null && lng != null && isStorable(lat, lng);
  }
  return mask;
}

/**
 * One series reduced to the valid samples, gaps as NaN. A series shorter than
 * the mask reads NaN past its end rather than shifting the ones that follow.
 */
function select(mask: boolean[] | null, data: number[] | undefined): number[] {
  const v = data ?? [];
  if (!mask) return v.map((x) => (x == null ? NaN : x));
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = v[i];
    out.push(x == null ? NaN : x);
  }
  return out;
}

/**
 * Transform raw API streams array into usable ActivityStreams object.
 * Handles combining lat/lng arrays and preferring corrected altitude.
 *
 * The `latlng` validity mask governs every series, the same rule
 * `parse_streams` applies in Rust, so the chart cursor and the map cursor
 * index the same samples.
 */
export function parseStreams(rawStreams: RawStreamItem[]): ActivityStreams {
  const streams: ActivityStreams = {};
  const mask = latlngMask(rawStreams);
  let altitudeIsFixed = false;

  for (const stream of rawStreams) {
    switch (stream.type) {
      case 'latlng':
        // latlng uses data for lat, data2 for lng - combine into [lat, lng] tuples
        if (stream.data && stream.data2) {
          const len = Math.min(stream.data.length, stream.data2.length);
          const points: [number, number][] = [];
          for (let i = 0; i < len; i++) {
            const lat = stream.data[i];
            const lng = stream.data2[i];
            if (lat != null && lng != null && isStorable(lat, lng)) points.push([lat, lng]);
          }
          streams.latlng = points;
        }
        break;
      case 'time':
        // A NaN gap saturates to 0, as the Rust cast to i64 does.
        streams.time = select(mask, stream.data).map((x) => (Number.isNaN(x) ? 0 : x));
        break;
      case 'altitude':
        // Use fixed_altitude if available (corrected elevation), fallback to altitude
        if (!altitudeIsFixed) streams.altitude = select(mask, stream.data);
        break;
      case 'fixed_altitude':
        streams.altitude = select(mask, stream.data);
        altitudeIsFixed = true;
        break;
      case 'heartrate':
        streams.heartrate = select(mask, stream.data);
        break;
      case 'watts':
        streams.watts = select(mask, stream.data);
        break;
      case 'cadence':
        streams.cadence = select(mask, stream.data);
        break;
      case 'velocity_smooth':
        streams.velocity_smooth = select(mask, stream.data);
        break;
      case 'distance':
        streams.distance = select(mask, stream.data);
        break;
      case 'grade_smooth':
        streams.grade_smooth = select(mask, stream.data);
        break;
      case 'temp':
        streams.temp = select(mask, stream.data);
        break;
      case 'w_bal':
        streams.wbal = select(mask, stream.data);
        break;
      case 'ga_velocity':
        streams.gap = select(mask, stream.data).map((v) => paceMinutesFromSpeed(v));
        break;
    }
  }

  return streams;
}
