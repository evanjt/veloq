/**
 * Scenario: the Routes tab sentence for where this attempt sits on the route.
 * Expected behaviour: nothing at all when the activity is not on the route or
 * it is the only attempt, a rank and a gap under five attempts, and the
 * percentile as well at five or more.
 */

import { formatRouteStanding } from '@/features/routes/lib/routeStanding';

const t = ((key: string, vars?: Record<string, unknown>) =>
  `${key}|${JSON.stringify(vars ?? {})}`) as never;

describe('formatRouteStanding', () => {
  it('says nothing when the activity is not on the route', () => {
    expect(
      formatRouteStanding(
        { currentRank: null, attemptCount: 4, percentileRank: null, gapToBestSeconds: null },
        t
      )
    ).toBeNull();
  });

  it('says nothing for a lone attempt', () => {
    expect(
      formatRouteStanding(
        { currentRank: 1, attemptCount: 1, percentileRank: null, gapToBestSeconds: 0 },
        t
      )
    ).toBeNull();
  });

  it('names the best without a gap or a percentile', () => {
    expect(
      formatRouteStanding(
        { currentRank: 1, attemptCount: 4, percentileRank: 75, gapToBestSeconds: 0 },
        t
      )
    ).toBe('routes.standingBest|{"total":4}');
  });

  it('gives rank and gap under five attempts', () => {
    expect(
      formatRouteStanding(
        { currentRank: 3, attemptCount: 4, percentileRank: 25, gapToBestSeconds: 14 },
        t
      )
    ).toBe('routes.standingRank|{"rank":3,"total":4,"gap":"14s"}');
  });

  it('adds the percentile at five or more attempts', () => {
    expect(
      formatRouteStanding(
        { currentRank: 5, attemptCount: 20, percentileRank: 75.4, gapToBestSeconds: 95 },
        t
      )
    ).toBe('routes.standingRankPercentile|{"rank":5,"total":20,"gap":"1:35","percent":75}');
  });

  it('falls back to rank and gap when the percentile is missing', () => {
    expect(
      formatRouteStanding(
        { currentRank: 5, attemptCount: 20, percentileRank: null, gapToBestSeconds: 95 },
        t
      )
    ).toBe('routes.standingRank|{"rank":5,"total":20,"gap":"1:35"}');
  });

  it('says nothing when the rank cannot belong to the counted attempts', () => {
    expect(
      formatRouteStanding(
        { currentRank: 5, attemptCount: 4, percentileRank: null, gapToBestSeconds: 14 },
        t
      )
    ).toBeNull();
  });

  it('says nothing when the gap to best is unknown', () => {
    expect(
      formatRouteStanding(
        { currentRank: 2, attemptCount: 4, percentileRank: 50, gapToBestSeconds: null },
        t
      )
    ).toBeNull();
  });
});
