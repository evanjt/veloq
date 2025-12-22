import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import type { PaceCurve } from '@/types';

interface UsePaceCurveOptions {
  sport?: string;
  /** Number of days to include (default 365) */
  days?: number;
  enabled?: boolean;
}

export function usePaceCurve(options: UsePaceCurveOptions = {}) {
  const { sport = 'Run', days = 365, enabled = true } = options;

  return useQuery<PaceCurve>({
    queryKey: ['paceCurve', sport, days],
    queryFn: () => intervalsApi.getPaceCurve({ sport, days }),
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

// Standard distances for running pace curve (in meters)
export const PACE_CURVE_DISTANCES = [
  { meters: 400, label: '400m' },
  { meters: 800, label: '800m' },
  { meters: 1000, label: '1K' },
  { meters: 1609.34, label: 'Mile' },
  { meters: 3000, label: '3K' },
  { meters: 5000, label: '5K' },
  { meters: 10000, label: '10K' },
  { meters: 21097.5, label: 'Half' },
];

// Standard distances for swimming pace curve (in meters)
export const SWIM_PACE_CURVE_DISTANCES = [
  { meters: 100, label: '100m' },
  { meters: 200, label: '200m' },
  { meters: 400, label: '400m' },
  { meters: 800, label: '800m' },
  { meters: 1500, label: '1500m' },
  { meters: 3800, label: '3.8K' },
];

// Legacy exports for backward compatibility
export const PACE_CURVE_DURATIONS = PACE_CURVE_DISTANCES.map(d => ({ secs: d.meters, label: d.label }));
export const SWIM_PACE_CURVE_DURATIONS = SWIM_PACE_CURVE_DISTANCES.map(d => ({ secs: d.meters, label: d.label }));

// Get pace at a specific duration (which is actually distance in our data)
export function getPaceAtDuration(curve: PaceCurve | undefined, targetDuration: number): number | null {
  if (!curve?.secs || !curve?.pace || curve.secs.length === 0) return null;

  // secs array contains times, find closest time to target
  // But we're actually looking for a distance, so this needs adjustment
  // The data is: secs[i] = time to cover some distance, pace[i] = speed at that effort

  const index = curve.secs.findIndex(s => s === targetDuration);
  if (index !== -1 && curve.pace[index]) return curve.pace[index];

  // Find closest duration
  let closestIndex = 0;
  let closestDiff = Math.abs(curve.secs[0] - targetDuration);
  for (let i = 1; i < curve.secs.length; i++) {
    const diff = Math.abs(curve.secs[i] - targetDuration);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }
  return curve.pace[closestIndex] || null;
}

// Format pace curve data for chart display (running - uses distance-based data)
export function formatPaceCurveForChart(curve: PaceCurve | undefined) {
  if (!curve?.secs || !curve?.pace || curve.pace.length === 0) return [];

  // The curve now has secs=durations and pace=speeds
  // Filter to show reasonable running paces (2-8 m/s = 2:05-8:20 min/km)
  const validPoints: { secs: number; label: string; pace: number }[] = [];

  // Sample at regular intervals to get meaningful data points
  const sampleIndices = [
    Math.floor(curve.secs.length * 0.1),
    Math.floor(curve.secs.length * 0.2),
    Math.floor(curve.secs.length * 0.3),
    Math.floor(curve.secs.length * 0.4),
    Math.floor(curve.secs.length * 0.5),
    Math.floor(curve.secs.length * 0.6),
    Math.floor(curve.secs.length * 0.7),
    Math.floor(curve.secs.length * 0.8),
    Math.floor(curve.secs.length * 0.9),
    curve.secs.length - 1,
  ].filter((v, i, a) => a.indexOf(v) === i && v >= 0);

  for (const idx of sampleIndices) {
    const secs = curve.secs[idx];
    const pace = curve.pace[idx];
    if (secs && pace && pace > 0 && pace < 10) { // Filter unreasonable paces
      const label = secs < 60 ? `${secs}s` :
                    secs < 3600 ? `${Math.floor(secs / 60)}m` :
                    `${(secs / 3600).toFixed(1)}h`;
      validPoints.push({ secs, label, pace });
    }
  }

  return validPoints;
}

// Format swim pace curve data for chart display (min:sec per 100m)
export function formatSwimPaceCurveForChart(curve: PaceCurve | undefined) {
  if (!curve?.secs || !curve?.pace || curve.pace.length === 0) return [];

  // Sample swim curve similar to running
  const validPoints: { secs: number; label: string; pace: number }[] = [];

  const sampleIndices = [
    Math.floor(curve.secs.length * 0.1),
    Math.floor(curve.secs.length * 0.3),
    Math.floor(curve.secs.length * 0.5),
    Math.floor(curve.secs.length * 0.7),
    Math.floor(curve.secs.length * 0.9),
    curve.secs.length - 1,
  ].filter((v, i, a) => a.indexOf(v) === i && v >= 0);

  for (const idx of sampleIndices) {
    const secs = curve.secs[idx];
    const pace = curve.pace[idx];
    if (secs && pace && pace > 0 && pace < 3) { // Swim paces are typically 0.5-2 m/s
      const label = secs < 60 ? `${secs}s` :
                    secs < 3600 ? `${Math.floor(secs / 60)}m` :
                    `${(secs / 3600).toFixed(1)}h`;
      validPoints.push({ secs, label, pace });
    }
  }

  return validPoints;
}

// Convert m/s to min:sec per km (for display)
export function paceToMinPerKm(metersPerSecond: number): { minutes: number; seconds: number } {
  if (metersPerSecond <= 0) return { minutes: 0, seconds: 0 };
  const secondsPerKm = 1000 / metersPerSecond;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return { minutes, seconds };
}

// Convert m/s to min:sec per 100m (for swimming)
export function paceToMinPer100m(metersPerSecond: number): { minutes: number; seconds: number } {
  if (metersPerSecond <= 0) return { minutes: 0, seconds: 0 };
  const secondsPer100m = 100 / metersPerSecond;
  const minutes = Math.floor(secondsPer100m / 60);
  const seconds = Math.round(secondsPer100m % 60);
  return { minutes, seconds };
}
