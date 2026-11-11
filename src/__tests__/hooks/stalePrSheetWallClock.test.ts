/**
 * Scenario: effort dates are the athlete's wall clock stamped as UTC. The sheet ended its range
 * and its gap band at the true epoch now, offset by the zone from the stamps beside it, so an
 * effort made an hour ago east of Greenwich read as in the future and drew no gap.
 *
 * Expected behaviour: the gap band runs from the last effort to the wall-clock now, and the
 * summary names the record's stamped day.
 */

import { i18n } from '@/i18n';
import type { TFunc } from '@/features/insights/types';
import {
  stalePROpportunityToInsight,
  type StalePROpportunity,
} from '@/features/insights/generators/stalePr';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const t = i18n.t.bind(i18n) as unknown as TFunc;
const HOUR = 3600;

describe('stale PR sheet dates', () => {
  it('runs the gap band from the last effort to the wall-clock now', () => {
    const nowMs = Date.UTC(2026, 2, 5, 12);
    const wallNow = localWallClockToEpochSeconds(new Date(nowMs));
    const lastEffort = wallNow - HOUR;
    const opportunity: StalePROpportunity = {
      sectionId: 's1',
      sectionName: 'Ridge',
      bestTimeSecs: 300,
      fitnessMetric: 'power',
      currentValue: 260,
      previousValue: 240,
      gainPercent: 8,
      unit: 'W',
      daysSinceLast: 0,
      traversalCount: 4,
      prDate: lastEffort - 7 * 86400,
      recentEfforts: [
        { value: 300, date: lastEffort - 7 * 86400 },
        { value: 310, date: lastEffort },
      ],
      fitnessHistory: [{ value: 240, date: lastEffort - 7 * 86400 }],
    };

    const insight = stalePROpportunityToInsight(opportunity, t, nowMs, true);
    const section = insight.supportingData?.stalePrSections?.[0];

    expect(section?.gap).toEqual({ from: lastEffort, to: wallNow });
    expect(section?.range.to).toBe(wallNow);
  });
});
