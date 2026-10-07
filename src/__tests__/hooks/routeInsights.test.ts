/**
 * Scenario: the engine's insights read carries a row for every route bucket
 * that holds a recent record or a trend, with the counts of each. The panel
 * shows them as one `route` card, a single card for one row and a group card
 * for two or more, and counts nothing itself.
 *
 * Expected behaviour: the card states the engine's counts, lists every row with
 * a route page to open, keeps a route ridden and run as two rows, and ranks
 * under the existing caps.
 */

import { generateInsights, type InsightInputData } from '@/features/insights/lib/generateInsights';
import { generateRouteInsights } from '@/features/insights/generators/routeInsights';
import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import type { FfiRouteInsight } from 'veloqrs';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const NOW = Date.now();

function row(overrides: Partial<FfiRouteInsight>): FfiRouteInsight {
  return {
    routeId: 'r1',
    routeName: 'Lakeside loop',
    sportType: 'Run',
    isReverse: false,
    isRecentRecord: false,
    trend: 0,
    bestTime: 1500,
    daysSinceLast: 3,
    attemptCount: 8,
    recentEfforts: [],
    ...overrides,
  };
}

const THREE_ROUTES = [
  row({ routeId: 'r1', routeName: 'Lakeside loop', isRecentRecord: true, daysSinceLast: 2 }),
  row({ routeId: 'r2', routeName: 'Orchard lane', trend: 1, daysSinceLast: 5, attemptCount: 12 }),
  row({ routeId: 'r3', routeName: 'Mill road', trend: 1, daysSinceLast: 9, attemptCount: 7 }),
];

const COUNTS = { records: 1, faster: 2, slower: 0 };

const EMPTY_INPUT: InsightInputData = {
  currentPeriod: null,
  previousPeriod: null,
  ftpTrend: null,
  paceTrend: null,
  recentPRs: [],
  sectionTrends: [],
};

describe('generateRouteInsights', () => {
  it('gives no card for no rows', () => {
    expect(generateRouteInsights([], { records: 0, faster: 0, slower: 0 }, NOW, t)).toEqual([]);
    expect(generateRouteInsights(undefined, undefined, NOW, t)).toEqual([]);
  });

  it('names the route and its sport on a single row and opens that route', () => {
    const [card, ...rest] = generateRouteInsights(
      [THREE_ROUTES[0]],
      { records: 1, faster: 0, slower: 0 },
      NOW,
      t
    );

    expect(rest).toEqual([]);
    expect(card.category).toBe('route');
    expect(card.id).toBe('route-r1-Run-forward');
    expect(card.title).toContain('Lakeside loop');
    expect(card.title).toContain('Run');
    expect(card.title).toContain('insights.route.recordTitle');
    expect(card.navigationTarget).toBe('/route/r1');
  });

  it('titles a single trend row faster or slower', () => {
    const faster = generateRouteInsights(
      [row({ trend: 1 })],
      { records: 0, faster: 1, slower: 0 },
      NOW,
      t
    )[0];
    const slower = generateRouteInsights(
      [row({ trend: -1 })],
      { records: 0, faster: 0, slower: 1 },
      NOW,
      t
    )[0];

    expect(faster.title).toContain('insights.route.fasterTitle');
    expect(slower.title).toContain('insights.route.slowerTitle');
  });

  it('carries three routes as one group card stating the engine counts', () => {
    const cards = generateRouteInsights(THREE_ROUTES, COUNTS, NOW, t);

    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.id).toBe('route-group');
    expect(card.category).toBe('route');
    expect(card.title).toContain('insights.route.recordCount {"count":1}');
    expect(card.title).toContain('insights.route.fasterCount {"count":2}');
    expect(card.title).not.toContain('slowerCount');
    expect(card.supportingData?.routes?.map((r) => r.routeId)).toEqual(['r1', 'r2', 'r3']);
    expect(
      card.supportingData?.routes?.every((r) => r.navigationTarget.startsWith('/route/'))
    ).toBe(true);
    expect(card.supportingData?.routes?.map((r) => r.navigationTarget)).toEqual([
      '/route/r1',
      '/route/r2',
      '/route/r3',
    ]);
  });

  it('takes the counts from the engine and does not recount the rows', () => {
    const [card] = generateRouteInsights(
      THREE_ROUTES,
      { records: 4, faster: 5, slower: 6 },
      NOW,
      t
    );

    expect(card.title).toContain('{"count":4}');
    expect(card.title).toContain('{"count":5}');
    expect(card.title).toContain('{"count":6}');
  });

  it('names the first three routes in the body and the rest as a count', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      row({ routeId: id, routeName: `Route ${id}`, trend: 1 })
    );
    const [card] = generateRouteInsights(rows, { records: 0, faster: 5, slower: 0 }, NOW, t);

    expect(card.body).toContain('Route a');
    expect(card.body).toContain('Route c');
    expect(card.body).not.toContain('Route d');
    expect(card.body).toContain('insights.route.groupMore {"n":2}');
    expect(card.supportingData?.routes).toHaveLength(5);
  });

  it('is priority 2 with a record and 3 with trends only', () => {
    expect(generateRouteInsights(THREE_ROUTES, COUNTS, NOW, t)[0].priority).toBe(2);
    expect(
      generateRouteInsights(THREE_ROUTES.slice(1), { records: 0, faster: 2, slower: 0 }, NOW, t)[0]
        .priority
    ).toBe(3);
  });

  it('stands on the thinnest row and the freshest attempt', () => {
    const [card] = generateRouteInsights(THREE_ROUTES, COUNTS, NOW, t);

    expect(card.meta?.repetitionCount).toBe(7);
    expect(card.meta?.sourceTimestamp).toBe(NOW - 2 * 86_400_000);
  });

  it('lists a route ridden and run as two rows, each under its own sport', () => {
    const rows = [
      row({ routeId: 'r9', routeName: 'Harbour path', sportType: 'Ride', trend: 1 }),
      row({ routeId: 'r9', routeName: 'Harbour path', sportType: 'Run', trend: -1 }),
    ];
    const [card] = generateRouteInsights(rows, { records: 0, faster: 1, slower: 1 }, NOW, t);

    const listed = card.supportingData?.routes ?? [];
    expect(listed.map((r) => r.sportType)).toEqual(['Ride', 'Run']);
    expect(listed.map((r) => r.trend)).toEqual([1, -1]);
    expect(new Set(listed.map((r) => r.rowKey)).size).toBe(2);
  });

  it('labels the direction only where the route has both', () => {
    const rows = [
      row({ routeId: 'r5', routeName: 'Ridge', trend: 1, isReverse: false }),
      row({ routeId: 'r5', routeName: 'Ridge', trend: 1, isReverse: true }),
      row({ routeId: 'r6', routeName: 'Dune', trend: 1, isReverse: false }),
    ];
    const [card] = generateRouteInsights(rows, { records: 0, faster: 3, slower: 0 }, NOW, t);

    const listed = card.supportingData?.routes ?? [];
    expect(listed.map((r) => r.direction)).toEqual(['forward', 'reverse', undefined]);
  });

  it('gives each direction its own id on a single row', () => {
    const forward = generateRouteInsights(
      [row({ trend: 1 })],
      { records: 0, faster: 1, slower: 0 },
      NOW,
      t
    )[0];
    const reverse = generateRouteInsights(
      [row({ trend: 1, isReverse: true })],
      { records: 0, faster: 1, slower: 0 },
      NOW,
      t
    )[0];

    expect(forward.id).toBe('route-r1-Run-forward');
    expect(reverse.id).toBe('route-r1-Run-reverse');
  });
});

describe('generateInsights with route rows', () => {
  it('returns one route card with every route listed', () => {
    const insights = generateInsights(
      { ...EMPTY_INPUT, routeInsights: THREE_ROUTES, routeInsightCounts: COUNTS },
      t
    );

    const routeCards = insights.filter((i) => i.category === 'route');
    expect(routeCards).toHaveLength(1);
    expect(routeCards[0].supportingData?.routes).toHaveLength(3);
  });

  it('returns no route card without rows', () => {
    const insights = generateInsights(
      {
        ...EMPTY_INPUT,
        routeInsights: [],
        routeInsightCounts: { records: 0, faster: 0, slower: 0 },
      },
      t
    );

    expect(insights.filter((i) => i.category === 'route')).toEqual([]);
  });

  it('ranks the card under the existing caps beside eight stronger cards', () => {
    const maxTotalBefore = INSIGHTS_CONFIG.surface.maxTotal;
    const prs = Array.from({ length: 8 }, (_, i) => ({
      sectionId: `s${i}`,
      sectionName: `Climb ${i}`,
      bestTime: 300,
      daysAgo: 1,
      traversalCount: 12,
    }));

    const insights = generateInsights(
      {
        ...EMPTY_INPUT,
        recentPRs: prs,
        routeInsights: THREE_ROUTES,
        routeInsightCounts: COUNTS,
      },
      t
    );

    expect(INSIGHTS_CONFIG.surface.maxTotal).toBe(maxTotalBefore);
    expect(insights.length).toBeLessThanOrEqual(maxTotalBefore);
    expect(insights.filter((i) => i.category === 'route').length).toBeLessThanOrEqual(
      INSIGHTS_CONFIG.surface.maxPerCategory
    );
  });
});
