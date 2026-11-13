// The chips under a feed row, as the phone words them: a route or section name,
// with PR for a record and an arrow for a faster or slower trend. The
// indicator's stored kind is a database key and is never shown.

export type RouteHighlight = { routeName: string; isPr: boolean };

export type IndicatorHighlight = {
  indicatorType: string;
  targetName: string;
  /** -1 slower, 0 steady, 1 faster. */
  trend: number;
};

export function routeChip(route: RouteHighlight): string {
  return route.isPr ? `${route.routeName} PR` : route.routeName;
}

export function indicatorChip(indicator: IndicatorHighlight): string {
  if (indicator.indicatorType === 'section_pr') return `${indicator.targetName} PR`;
  if (indicator.trend > 0) return `${indicator.targetName} ↑`;
  if (indicator.trend < 0) return `${indicator.targetName} ↓`;
  return indicator.targetName;
}
