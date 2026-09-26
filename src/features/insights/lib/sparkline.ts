import type { SeriesPoint } from '../types';

/**
 * The sparkline fields a card carries, or nothing when there is no line.
 *
 * Every insight card draws a graphic of its own history, and the points come
 * from the engine read that already holds them. Spread into `supportingData`
 * so a card with too short a series carries neither the data nor a label for
 * it, rather than a label over an empty strip.
 *
 * Three points, because that is what `InsightListCard` requires before it
 * draws a path: two are a line segment and say nothing about a direction.
 */
export function sparkline(
  points: SeriesPoint[] | undefined,
  label: string
): { sparklineData?: number[]; sparklineLabel?: string } {
  if (!points || points.length < 3) return {};
  return { sparklineData: points.map((p) => p.value), sparklineLabel: label };
}
