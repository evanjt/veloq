import { createActivitySeededRandom } from '@/data/demo/random';

import type { ApiActivityStreams } from './types';
import { getActivity } from './activities';
import { getActivityMap } from './maps';

export function getActivityStreams(id: string): ApiActivityStreams | null {
  const activity = getActivity(id);
  if (!activity) return null;

  // Create activity-seeded random for reproducible stream data
  const streamRandom = createActivitySeededRandom(id + '-streams');

  const duration = activity.moving_time;
  const points = Math.min(Math.max(duration / 5, 100), 1000); // 100-1000 points, ~5 sec intervals
  const interval = Math.ceil(duration / points);

  const streams: ApiActivityStreams = {
    time: Array.from({ length: points }, (_, i) => i * interval),
  };

  // Heart rate stream - always include for activities with HR data
  const baseHr = activity.average_heartrate || 140; // Default to 140 if not set
  streams.heartrate = streams.time.map((t) => {
    const progress = t / duration;
    const warmup = Math.min(1, progress * 5); // Warmup effect
    const fatigue = progress * 5; // Cardiac drift
    const variation = (streamRandom() - 0.5) * 10;
    return Math.round(Math.max(80, Math.min(200, baseHr * 0.85 * warmup + fatigue + variation)));
  });

  // Power stream (for rides)
  if (activity.type === 'Ride' || activity.type === 'VirtualRide') {
    const ftp = activity.icu_ftp || 250;
    streams.watts = streams.time.map((t) => {
      const progress = t / duration;
      // Create some intervals/variability
      const intervalPhase = Math.sin(progress * Math.PI * 8) * 0.2;
      const base = ftp * (0.65 + intervalPhase);
      return Math.round(Math.max(50, base + (streamRandom() - 0.5) * ftp * 0.3));
    });
  }

  // GPS stream - only for outdoor activities with routes
  if (activity.stream_types?.includes('latlng')) {
    const map = getActivityMap(id, false);
    if (map?.latlngs && map.latlngs.length > 0) {
      // Interpolate to match time points
      const coords = map.latlngs;
      streams.latlng = streams.time.map((_, i) => {
        const idx = Math.min(Math.floor((i / points) * coords.length), coords.length - 1);
        return coords[idx];
      });
    }
  }

  // Altitude stream - generate realistic elevation profile
  if (activity.stream_types?.includes('altitude')) {
    const maxElev = activity.total_elevation_gain || 100;
    const baseAltitude = 50; // Starting altitude in meters

    // Create a more realistic elevation profile with multiple hills
    streams.altitude = streams.time.map((t) => {
      const progress = t / duration;
      // Multiple hills with different frequencies
      const hill1 = Math.sin(progress * Math.PI * 2) * (maxElev / 3);
      const hill2 = Math.sin(progress * Math.PI * 4 + 1) * (maxElev / 4);
      const hill3 = Math.sin(progress * Math.PI * 6 + 2) * (maxElev / 6);
      const noise = (streamRandom() - 0.5) * 5;
      return Math.round(Math.max(0, baseAltitude + hill1 + hill2 + hill3 + noise));
    });

    // Also create fixed_altitude (same as altitude for demo)
    streams.fixed_altitude = [...streams.altitude];

    // Grade stream - derivative of altitude over horizontal distance
    if (activity.stream_types?.includes('grade_smooth') && streams.altitude.length > 1) {
      const dist = activity.distance || 10000;
      const stepDist = dist / streams.altitude.length;
      streams.grade_smooth = streams.altitude.map((alt, i) => {
        if (i === 0) return 0;
        const dAlt = alt - streams.altitude![i - 1];
        const grade = (dAlt / stepDist) * 100;
        return Math.round(Math.max(-25, Math.min(25, grade)) * 10) / 10;
      });
    }
  }

  // Cadence stream - always include for cycling and running
  if (activity.type === 'Ride' || activity.type === 'VirtualRide') {
    const baseCadence = activity.average_cadence || 85;
    streams.cadence = streams.time.map((t) => {
      const progress = t / duration;
      // Simulate cadence variation (lower on climbs, higher on descents)
      const hillEffect = Math.sin(progress * Math.PI * 2) * 5;
      const variation = (streamRandom() - 0.5) * 8;
      return Math.round(Math.max(60, Math.min(120, baseCadence + hillEffect + variation)));
    });
  } else if (activity.type === 'Run') {
    const baseCadence = activity.average_cadence || 170; // Running cadence in spm
    streams.cadence = streams.time.map(() => {
      const variation = (streamRandom() - 0.5) * 6;
      return Math.round(Math.max(150, Math.min(190, baseCadence + variation)));
    });
  }

  // Velocity/speed stream
  if (activity.average_speed) {
    streams.velocity_smooth = streams.time.map((t) => {
      const progress = t / duration;
      // Slower on uphills, faster on downhills
      const hillEffect = -Math.sin(progress * Math.PI * 2) * (activity.average_speed * 0.15);
      const variation = (streamRandom() - 0.5) * 2;
      return Math.max(1, activity.average_speed + hillEffect + variation);
    });
  }

  // Distance stream - cumulative distance over time (required for charts)
  // This is the X-axis for most activity charts
  // Derived from velocity to ensure monotonically increasing values
  if (activity.distance && streams.velocity_smooth && streams.time.length > 1) {
    const totalDistance = activity.distance;
    // Calculate cumulative distance from velocity
    const rawDistance: number[] = [0];
    for (let i = 1; i < streams.time.length; i++) {
      const dt = streams.time[i] - streams.time[i - 1];
      const avgVelocity = (streams.velocity_smooth[i] + streams.velocity_smooth[i - 1]) / 2;
      rawDistance.push(rawDistance[i - 1] + avgVelocity * dt);
    }
    // Scale to match actual total distance
    const calculatedTotal = rawDistance[rawDistance.length - 1];
    const scale = calculatedTotal > 0 ? totalDistance / calculatedTotal : 1;
    streams.distance = rawDistance.map((d) => Math.round(d * scale));
  } else if (activity.distance) {
    // Fallback: linear distance progression
    const totalDistance = activity.distance;
    streams.distance = streams.time.map((t) => {
      const progress = t / duration;
      return Math.round(totalDistance * progress);
    });
  }

  return streams;
}
