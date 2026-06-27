import type { RoutePerformancePoint } from '../hooks/useRoutePerformances';

export interface RouteStats {
  distance: number;
  lastDate: string;
}

export function computeRouteStats(performances: RoutePerformancePoint[]): RouteStats {
  if (performances.length === 0) return { distance: 0, lastDate: '' };
  const distances = performances.map((p) => p.distance || 0);
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  // Filter out invalid dates: a NaN getTime() poisons Math.max, and
  // new Date(NaN).toISOString() throws RangeError.
  const dates = performances.map((p) => p.date.getTime()).filter((t) => Number.isFinite(t));
  const lastDate = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : '';
  return { distance: avgDistance, lastDate };
}
