import type { RawStreamItem, ActivityStreams } from '@/types';

/**
 * Transform raw API streams array into usable ActivityStreams object.
 * Handles combining lat/lng arrays and preferring corrected altitude.
 */
export function parseStreams(rawStreams: RawStreamItem[]): ActivityStreams {
  const streams: ActivityStreams = {};

  for (const stream of rawStreams) {
    switch (stream.type) {
      case 'latlng':
        // latlng uses data for lat, data2 for lng - combine into [lat, lng] tuples
        if (stream.data && stream.data2) {
          streams.latlng = stream.data.map((lat, i) => [lat, stream.data2![i]]);
        }
        break;
      case 'time':
        streams.time = stream.data;
        break;
      case 'altitude':
      case 'fixed_altitude':
        // Use fixed_altitude if available (corrected elevation), fallback to altitude
        if (!streams.altitude || stream.type === 'fixed_altitude') {
          streams.altitude = stream.data;
        }
        break;
      case 'heartrate':
        streams.heartrate = stream.data;
        break;
      case 'watts':
        streams.watts = stream.data;
        break;
      case 'cadence':
        streams.cadence = stream.data;
        break;
      case 'velocity_smooth':
        streams.velocity_smooth = stream.data;
        break;
      case 'distance':
        streams.distance = stream.data;
        break;
    }
  }

  return streams;
}
