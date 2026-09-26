/**
 * The chart's personal best, as an index into the points it is drawn from.
 *
 * A personal record here is a beat over the same route or section and
 * direction pair, which is what the engine writes in `persistence/records.rs`,
 * so a faster traversal the other way is a different effort and cannot be the
 * ring. The engine's own pick applies the same rule; this is the local
 * fallback for when it has not answered yet.
 *
 * A route only ever ridden in reverse still has a best: with no forward
 * traversal to pick from, the rule applies to the direction that exists
 * rather than answering nothing.
 */
export interface ChartBestCandidate {
  sectionTime?: number;
  direction?: string;
}

export function chartBestIndex(points: readonly ChartBestCandidate[]): number {
  const forward = fastest(points, (p) => p.direction !== 'reverse');
  return forward ?? fastest(points, () => true) ?? 0;
}

function fastest(
  points: readonly ChartBestCandidate[],
  keep: (p: ChartBestCandidate) => boolean
): number | null {
  let bestTime = Infinity;
  let bestIdx: number | null = null;
  for (let i = 0; i < points.length; i++) {
    if (!keep(points[i])) continue;
    const time = points[i].sectionTime ?? Infinity;
    if (time > 0 && time < bestTime) {
      bestTime = time;
      bestIdx = i;
    }
  }
  return bestIdx;
}
