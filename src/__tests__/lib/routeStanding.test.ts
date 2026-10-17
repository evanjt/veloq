/**
 * Scenario: the Routes tab sentence for where this attempt sits on the route.
 * Expected behaviour: nothing at all when the activity is not on the route or
 * it is the only attempt, a rank and a gap under five attempts, and the
 * percentile as well at five or more. A record states how much it beat the
 * previous best by, since the page is the one place the screen says it.
 */

import { formatRouteStanding } from '@/features/routes/lib/routeStanding';

const t = ((key: string, vars?: Record<string, unknown>) =>
  `${key}|${JSON.stringify(vars ?? {})}`) as never;

describe('formatRouteStanding', () => {
  it('says nothing when the activity is not on the route', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: null,
          attemptCount: 4,
          percentileRank: null,
          gapToBestSeconds: null,
          improvementSeconds: null,
        },
        t
      )
    ).toBeNull();
  });

  it('says nothing for a lone attempt', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 1,
          attemptCount: 1,
          percentileRank: null,
          gapToBestSeconds: 0,
          improvementSeconds: null,
        },
        t
      )
    ).toBeNull();
  });

  it('names the best without a gap or a percentile', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 1,
          attemptCount: 4,
          percentileRank: 75,
          gapToBestSeconds: 0,
          improvementSeconds: null,
        },
        t
      )
    ).toBe('routes.standingBest|{"total":4}');
  });

  it('states how much a record beat the previous best by', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 1,
          attemptCount: 5,
          percentileRank: 100,
          gapToBestSeconds: 0,
          improvementSeconds: 14,
        },
        t
      )
    ).toBe('routes.standingBestBy|{"total":5,"improvement":"14 s"}');
  });

  it('states an improvement of a minute or more in minutes', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 1,
          attemptCount: 3,
          percentileRank: null,
          gapToBestSeconds: 0,
          improvementSeconds: 95,
        },
        t
      )
    ).toBe('routes.standingBestBy|{"total":3,"improvement":"1:35"}');
  });

  it('names the best alone when the improvement rounds to nothing', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 1,
          attemptCount: 3,
          percentileRank: null,
          gapToBestSeconds: 0,
          improvementSeconds: 0.4,
        },
        t
      )
    ).toBe('routes.standingBest|{"total":3}');
  });

  it('never states an improvement for an attempt that is not the best', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 2,
          attemptCount: 4,
          percentileRank: 50,
          gapToBestSeconds: 14,
          improvementSeconds: 14,
        },
        t
      )
    ).toBe('routes.standingRank|{"rank":2,"total":4,"gap":"14 s"}');
  });

  it('gives rank and gap under five attempts', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 3,
          attemptCount: 4,
          percentileRank: 25,
          gapToBestSeconds: 14,
          improvementSeconds: null,
        },
        t
      )
    ).toBe('routes.standingRank|{"rank":3,"total":4,"gap":"14 s"}');
  });

  it('adds the percentile at five or more attempts', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 5,
          attemptCount: 20,
          percentileRank: 75.4,
          gapToBestSeconds: 95,
          improvementSeconds: null,
        },
        t
      )
    ).toBe('routes.standingRankPercentile|{"rank":5,"total":20,"gap":"1:35","percent":75}');
  });

  it('falls back to rank and gap when the percentile is missing', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 5,
          attemptCount: 20,
          percentileRank: null,
          gapToBestSeconds: 95,
          improvementSeconds: null,
        },
        t
      )
    ).toBe('routes.standingRank|{"rank":5,"total":20,"gap":"1:35"}');
  });

  it('says nothing when the rank cannot belong to the counted attempts', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 5,
          attemptCount: 4,
          percentileRank: null,
          gapToBestSeconds: 14,
          improvementSeconds: null,
        },
        t
      )
    ).toBeNull();
  });

  it('says nothing when the gap to best is unknown', () => {
    expect(
      formatRouteStanding(
        {
          currentRank: 2,
          attemptCount: 4,
          percentileRank: 50,
          gapToBestSeconds: null,
          improvementSeconds: null,
        },
        t
      )
    ).toBeNull();
  });
});
