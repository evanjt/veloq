import type { FfiRouteInsight } from 'veloqrs';
import type { Insight, SupportingRoute, TFunc } from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { confidenceFrom } from '../lib/config';
import { sectionWithSport } from '../lib/cardSport';
import { sparkline } from '../lib/sparkline';

const DAY_MS = 86_400_000;
const MAX_ROUTES_IN_BODY = 3;

/** The engine's counts over every row it returned, which this generator does not recompute. */
export interface RouteInsightCounts {
  records: number;
  faster: number;
  slower: number;
}

const directionOf = (row: FfiRouteInsight) => (row.isReverse ? 'reverse' : 'forward');

const rowKeyOf = (row: FfiRouteInsight) => `${row.routeId}-${row.sportType}-${directionOf(row)}`;

function supportingRoutes(rows: readonly FfiRouteInsight[]): SupportingRoute[] {
  // A direction is named where the list holds both of a route's, or the row is
  // the reverse one, so a route ridden one way reads as its plain name.
  const bothWays = new Set<string>();
  const seen = new Map<string, boolean>();
  for (const row of rows) {
    const bucket = `${row.routeId}:${row.sportType}`;
    const other = seen.get(bucket);
    if (other !== undefined && other !== row.isReverse) bothWays.add(bucket);
    seen.set(bucket, row.isReverse);
  }
  return rows.map((row) => ({
    rowKey: rowKeyOf(row),
    routeId: row.routeId,
    routeName: row.routeName,
    sportType: row.sportType,
    direction:
      row.isReverse || bothWays.has(`${row.routeId}:${row.sportType}`)
        ? directionOf(row)
        : undefined,
    isRecentRecord: row.isRecentRecord,
    trend: row.trend,
    bestTime: row.bestTime,
    daysSinceLast: row.daysSinceLast,
    attemptCount: row.attemptCount,
    recentEfforts: row.recentEfforts,
    navigationTarget: `/route/${row.routeId}`,
  }));
}

function summaryTitle(counts: RouteInsightCounts, t: TFunc): string {
  const parts = [
    counts.records > 0 ? t('insights.route.recordCount', { count: counts.records }) : null,
    counts.faster > 0 ? t('insights.route.fasterCount', { count: counts.faster }) : null,
    counts.slower > 0 ? t('insights.route.slowerCount', { count: counts.slower }) : null,
  ].filter((part): part is string => part !== null);
  return parts.join(', ');
}

/**
 * Route records and trends as one card: a single card for one row, a group card
 * for two or more, in the stale-PR group's shape.
 *
 * The engine decides which routes qualify and counts them, so the rows and the
 * counts are taken whole and nothing here filters or recounts.
 */
export function generateRouteInsights(
  rows: readonly FfiRouteInsight[] | undefined,
  counts: RouteInsightCounts | undefined,
  now: number,
  t: TFunc
): Insight[] {
  if (!rows || rows.length === 0) return [];

  const routes = supportingRoutes(rows);
  const hasRecord = rows.some((r) => r.isRecentRecord);
  const thinnest = Math.min(...rows.map((r) => r.attemptCount));
  const meta = {
    comparisonKind: 'self' as const,
    // The freshest row, so the card is only as stale as its least stale route;
    // and the thinnest, so one thin route does not carry a group through a gate
    // it would fail alone.
    sourceTimestamp: now - Math.min(...rows.map((r) => r.daysSinceLast)) * DAY_MS,
    repetitionCount: thinnest,
  };
  const methodology = {
    name: t('insights.methodology.routeName'),
    description: t('insights.methodology.route'),
  };

  const [row, ...others] = rows;
  if (!row) return [];
  if (others.length === 0) {
    const name = sectionWithSport(row.routeName, row.sportType, t);
    const titleKey = row.isRecentRecord
      ? 'insights.route.recordTitle'
      : row.trend > 0
        ? 'insights.route.fasterTitle'
        : 'insights.route.slowerTitle';
    return [
      makeInsight({
        id: `route-${rowKeyOf(row)}`,
        category: 'route',
        priority: hasRecord ? 2 : 3,
        icon: row.isRecentRecord
          ? 'trophy-outline'
          : row.trend > 0
            ? 'trending-up'
            : 'trending-down',
        iconTone: row.isRecentRecord ? 'record' : row.trend > 0 ? 'positive' : 'negative',
        title: t(titleKey, { name }),
        navigationTarget: `/route/${row.routeId}`,
        timestamp: now,
        confidence: confidenceFrom('route', row.attemptCount),
        supportingData: {
          ...sparkline(row.recentEfforts, t('insights.data.recentEfforts')),
          routes,
        },
        methodology,
        meta: { ...meta, placeName: row.routeName },
      }),
    ];
  }

  // Only a caller with no engine counts (a fixture older than the read) falls
  // back to the rows.
  const summary = counts ?? {
    records: rows.filter((r) => r.isRecentRecord).length,
    faster: rows.filter((r) => r.trend > 0).length,
    slower: rows.filter((r) => r.trend < 0).length,
  };
  const named = rows
    .slice(0, MAX_ROUTES_IN_BODY)
    .map((r) => sectionWithSport(r.routeName, r.sportType, t))
    .join(', ');
  const more =
    rows.length > MAX_ROUTES_IN_BODY
      ? ` ${t('insights.route.groupMore', { n: rows.length - MAX_ROUTES_IN_BODY })}`
      : '';
  const improving = summary.records + summary.faster >= summary.slower;

  return [
    makeInsight({
      id: 'route-group',
      category: 'route',
      priority: hasRecord ? 2 : 3,
      icon: hasRecord ? 'trophy-outline' : improving ? 'trending-up' : 'trending-down',
      iconTone: hasRecord ? 'record' : improving ? 'positive' : 'negative',
      title: summaryTitle(summary, t),
      body: named + more,
      navigationTarget: `/route/${row.routeId}`,
      timestamp: now,
      confidence: confidenceFrom('route', thinnest),
      supportingData: { routes },
      methodology,
      meta,
    }),
  ];
}
