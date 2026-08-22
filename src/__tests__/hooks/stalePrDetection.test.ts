import {
  detectStalePROpportunities,
  stalePROpportunityToInsight,
  StalePRInput,
  StalePROpportunity,
} from '@/features/insights/generators/stalePr';

// Mock translation function - returns key with interpolated params
const mockT = (key: string, params?: Record<string, string | number>): string => {
  if (!params) return key;
  const paramStr = Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `${key} {${paramStr}}`;
};

const NOW_TS = Math.floor(Date.now() / 1000);
const DAYS = 86400; // seconds in a day

describe('detectStalePROpportunities', () => {
  // ============================================================
  // NO OPPORTUNITIES
  // ============================================================

  it('returns no opportunities across all non-qualifying inputs', () => {
    const rideSection = (overrides: Record<string, unknown> = {}) => ({
      sectionId: 's1',
      sectionName: 'Hill Climb',
      bestTimeSecs: 300,
      traversalCount: 10,
      daysSinceLast: 60,
      sportType: 'Ride' as const,
      ...overrides,
    });
    const ftpGain = {
      latestFtp: 220,
      latestDate: NOW_TS,
      previousFtp: 200,
      previousDate: NOW_TS - 90 * DAYS,
    };

    const cases: { name: string; input: StalePRInput }[] = [
      {
        name: 'ftpTrend is null',
        input: { sections: [rideSection()], ftpTrend: null, paceTrend: null },
      },
      {
        name: 'FTP has not changed',
        input: {
          sections: [rideSection()],
          ftpTrend: { ...ftpGain, latestFtp: 200 },
          paceTrend: null,
        },
      },
      {
        name: 'FTP decreased',
        input: {
          sections: [rideSection()],
          ftpTrend: { ...ftpGain, latestFtp: 180 },
          paceTrend: null,
        },
      },
      {
        name: 'FTP gain is below 3% threshold (2%)',
        input: {
          sections: [rideSection()],
          ftpTrend: { ...ftpGain, latestFtp: 204 },
          paceTrend: null,
        },
      },
      {
        name: 'there are no sections',
        input: { sections: [], ftpTrend: ftpGain, paceTrend: null },
      },
      {
        name: 'section had a recent PR (within 30 days)',
        input: {
          sections: [rideSection({ daysSinceLast: 5 })],
          ftpTrend: ftpGain,
          paceTrend: null,
        },
      },
      {
        name: 'section was visited recently (within 30 days)',
        input: {
          sections: [rideSection({ daysSinceLast: 10 })],
          ftpTrend: ftpGain,
          paceTrend: null,
        },
      },
      {
        name: 'unsupported section sport from cycling FTP alone',
        input: {
          sections: [
            rideSection({
              sectionId: 'h1',
              sectionName: 'Alpine Hike',
              bestTimeSecs: 1800,
              traversalCount: 6,
              sportType: 'Hike',
            }),
          ],
          ftpTrend: ftpGain,
          paceTrend: null,
        },
      },
      {
        name: 'latestFtp is undefined',
        input: {
          sections: [rideSection()],
          ftpTrend: { ...ftpGain, latestFtp: undefined },
          paceTrend: null,
        },
      },
      {
        name: 'previousFtp is undefined',
        input: {
          sections: [rideSection()],
          ftpTrend: { ...ftpGain, previousFtp: undefined },
          paceTrend: null,
        },
      },
      {
        name: 'FTP values are NaN',
        input: {
          sections: [rideSection()],
          ftpTrend: { ...ftpGain, latestFtp: NaN },
          paceTrend: null,
        },
      },
      {
        name: 'section has zero traversals',
        input: {
          sections: [rideSection({ traversalCount: 0 })],
          ftpTrend: ftpGain,
          paceTrend: null,
        },
      },
    ];

    for (const { name, input } of cases) {
      expect({ name, result: detectStalePROpportunities(input) }).toEqual({ name, result: [] });
    }
  });

  // ============================================================
  // OPPORTUNITY FOUND
  // ============================================================

  describe('finds opportunities when', () => {
    it('FTP increased and section is stale (>30 days)', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            daysSinceLast: 60,
            sportType: 'Ride',
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        paceTrend: null,
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
      expect(result[0].sectionId).toBe('s1');
      expect(result[0].sectionName).toBe('Hill Climb');
      expect(result[0].currentValue).toBe(220);
      expect(result[0].previousValue).toBe(200);
      expect(result[0].gainPercent).toBe(10);
      expect(result[0].bestTimeSecs).toBe(300);
      expect(result[0].fitnessMetric).toBe('power');
      expect(result[0].unit).toBe('W');
    });

    it('section with no known age is not treated as stale', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'River Path',
            bestTimeSecs: 600,
            traversalCount: 5,
            sportType: 'Ride',
            // no daysSinceLast
          },
        ],
        ftpTrend: {
          latestFtp: 250,
          latestDate: NOW_TS,
          previousFtp: 230,
          previousDate: NOW_TS - 90 * DAYS,
        },
        paceTrend: null,
      };
      // Fails closed: an unknown age cannot establish staleness, and the
      // engine reports an age for every section it returns.
      expect(detectStalePROpportunities(input)).toHaveLength(0);
    });

    it('excludes a recently PRd section on age alone', () => {
      // A PR is set on a traversal, so a PR within the window implies a
      // traversal within it. The age floor already covers the case, which is
      // why the engine path not sharing the recent-PR set does not diverge.
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'River Path',
            bestTimeSecs: 600,
            traversalCount: 5,
            daysSinceLast: 20,
            sportType: 'Ride',
          },
        ],
        ftpTrend: {
          latestFtp: 250,
          latestDate: NOW_TS,
          previousFtp: 230,
          previousDate: NOW_TS - 90 * DAYS,
        },
        paceTrend: null,
      };
      expect(detectStalePROpportunities(input)).toHaveLength(0);
    });

    it('limits results to 3 opportunities', () => {
      const sections = Array.from({ length: 5 }, (_, i) => ({
        sectionId: `s${i}`,
        sectionName: `Section ${i}`,
        bestTimeSecs: 300 + i * 60,
        traversalCount: 10 - i,
        daysSinceLast: 40 + i * 10,
        sportType: 'Ride' as const,
      }));
      const input: StalePRInput = {
        sections,
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        paceTrend: null,
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(3);
    });

    it('sorts by traversal count (most visited first)', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Rarely visited',
            bestTimeSecs: 300,
            traversalCount: 2,
            daysSinceLast: 60,
            sportType: 'Ride',
          },
          {
            sectionId: 's2',
            sectionName: 'Often visited',
            bestTimeSecs: 600,
            traversalCount: 20,
            daysSinceLast: 45,
            sportType: 'Ride',
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        paceTrend: null,
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(2);
      expect(result[0].sectionId).toBe('s2'); // more visited first
      expect(result[1].sectionId).toBe('s1');
    });

    it('handles bigint FTP dates gracefully', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            daysSinceLast: 60,
            sportType: 'Ride',
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: BigInt(NOW_TS),
          previousFtp: 200,
          previousDate: BigInt(NOW_TS - 90 * DAYS),
        },
        paceTrend: null,
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
    });

    it('rounds gainPercent to one decimal', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill',
            bestTimeSecs: 300,
            traversalCount: 5,
            daysSinceLast: 60,
            sportType: 'Ride',
          },
        ],
        ftpTrend: {
          latestFtp: 213,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        paceTrend: null,
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
      // (213-200)/200 = 6.5%
      expect(result[0].gainPercent).toBe(6.5);
    });
  });

  // ============================================================
  // RUNNING SECTIONS (sport-aware)
  // ============================================================

  describe('running sections', () => {
    it('finds opportunity when pace improved for a running section', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 'r1',
            sectionName: 'Park Loop',
            bestTimeSecs: 420,
            traversalCount: 8,
            daysSinceLast: 50,
            sportType: 'Run',
          },
        ],
        ftpTrend: null,
        paceTrend: {
          latestPace: 3.3,
          latestDate: NOW_TS,
          previousPace: 3.0,
          previousDate: NOW_TS - 90 * DAYS,
        },
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
      expect(result[0].sectionId).toBe('r1');
      expect(result[0].fitnessMetric).toBe('pace');
      expect(result[0].currentValue).toBe(3.3);
      expect(result[0].previousValue).toBe(3.0);
      expect(result[0].gainPercent).toBe(10);
      expect(result[0].unit).toBe('/km');
    });

    it('does not flag running section when only FTP improved (wrong sport)', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 'r1',
            sectionName: 'Park Loop',
            bestTimeSecs: 420,
            traversalCount: 8,
            daysSinceLast: 50,
            sportType: 'Run',
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        paceTrend: null,
      };
      const result = detectStalePROpportunities(input);
      expect(result).toEqual([]);
    });

    it('assigns FTP to cycling and pace to running in mixed sections', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 'c1',
            sectionName: 'Mountain Pass',
            bestTimeSecs: 600,
            traversalCount: 12,
            daysSinceLast: 45,
            sportType: 'Ride',
          },
          {
            sectionId: 'r1',
            sectionName: 'River Trail',
            bestTimeSecs: 360,
            traversalCount: 15,
            daysSinceLast: 40,
            sportType: 'Run',
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        paceTrend: {
          latestPace: 3.25,
          latestDate: NOW_TS,
          previousPace: 2.95,
          previousDate: NOW_TS - 90 * DAYS,
        },
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(2);
      // Sorted by traversal count: r1 (15) before c1 (12)
      const cycling = result.find((r) => r.sectionId === 'c1')!;
      const running = result.find((r) => r.sectionId === 'r1')!;

      expect(cycling.fitnessMetric).toBe('power');
      expect(cycling.currentValue).toBe(220);
      expect(cycling.previousValue).toBe(200);
      expect(cycling.unit).toBe('W');

      expect(running.fitnessMetric).toBe('pace');
      expect(running.currentValue).toBe(3.25);
      expect(running.previousValue).toBe(2.95);
      expect(running.unit).toBe('/km');
    });
  });

  describe('swimming sections', () => {
    it('finds opportunity when swim pace improved for a swimming section', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 'sw1',
            sectionName: 'Pool Set',
            bestTimeSecs: 95,
            traversalCount: 7,
            daysSinceLast: 50,
            sportType: 'Swim',
          },
        ],
        ftpTrend: null,
        runPaceTrend: null,
        swimPaceTrend: {
          latestPace: 1.1,
          latestDate: NOW_TS,
          previousPace: 1.0,
          previousDate: NOW_TS - 90 * DAYS,
        },
      };

      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
      expect(result[0].sectionId).toBe('sw1');
      expect(result[0].fitnessMetric).toBe('pace');
      expect(result[0].currentValue).toBe(1.1);
      expect(result[0].previousValue).toBe(1.0);
      expect(result[0].gainPercent).toBe(10);
      expect(result[0].unit).toBe('/100m');
    });
  });

  // ============================================================
  // INSIGHT FORMATTING
  // ============================================================

  describe('stalePROpportunityToInsight', () => {
    const opportunity: StalePROpportunity = {
      sectionId: 's1',
      sectionName: 'Hill Climb',
      bestTimeSecs: 263,
      daysSinceLast: 60,
      traversalCount: 5,
      fitnessMetric: 'power',
      currentValue: 220,
      previousValue: 200,
      gainPercent: 10,
      unit: 'W',
    };

    it('produces a valid Insight object', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT, 1700000000000);

      expect(insight.id).toBe('stale_pr-s1');
      expect(insight.category).toBe('stale_pr');
      expect(insight.priority).toBe(2);
      expect(insight.icon).toBe('lightning-bolt');
      expect(insight.iconColor).toBe('#FF9800');
      expect(insight.navigationTarget).toBe('/section/s1');
      expect(insight.isNew).toBe(true);
      expect(insight.timestamp).toBe(1700000000000);
    });

    it('includes section name in title', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      expect(insight.title).toContain('Hill Climb');
    });

    it('includes fitness values in subtitle', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      expect(insight.subtitle).toContain('200');
      expect(insight.subtitle).toContain('220');
    });

    it('includes supporting data with FTP comparison', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      expect(insight.supportingData!.dataPoints).toHaveLength(4);
      expect(insight.supportingData!.formula).toContain('220');
      expect(insight.supportingData!.formula).toContain('200');
      expect(insight.supportingData!.formula).toContain('+10%');
    });

    it('includes methodology', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      expect(insight.methodology!.name).toBe(
        'insights.methodology.stalePrCrossRefName {metric: insights.stalePr.metricCyclingFtp}'
      );
    });

    it('includes fitness values in body', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      expect(insight.body).toContain('200W');
      expect(insight.body).toContain('220W');
      expect(insight.body).toContain('Hill Climb');
    });

    it('uses Date.now() when no timestamp provided', () => {
      const before = Date.now();
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      const after = Date.now();
      expect(insight.timestamp).toBeGreaterThanOrEqual(before);
      expect(insight.timestamp).toBeLessThanOrEqual(after);
    });

    it('dates the card by the traversal, not by when it was built', () => {
      const now = Date.UTC(2026, 7, 22, 9, 0, 0);
      const insight = stalePROpportunityToInsight(opportunity, mockT, now);

      // The recency gate reads sourceTimestamp. Stamping it with `now` would
      // report every card as zero days old and fail the minimum-age check.
      const ageDays = (now - insight.meta!.sourceTimestamp!) / 86_400_000;
      expect(ageDays).toBeCloseTo(opportunity.daysSinceLast, 6);
      expect(insight.meta!.repetitionCount).toBe(opportunity.traversalCount);
    });

    it('formats pace-based opportunity correctly', () => {
      const paceOpportunity: StalePROpportunity = {
        sectionId: 'r1',
        sectionName: 'Park Loop',
        bestTimeSecs: 420,
        daysSinceLast: 45,
        traversalCount: 4,
        fitnessMetric: 'pace',
        currentValue: 3.3,
        previousValue: 3.0,
        gainPercent: 10,
        unit: '/km',
      };
      const insight = stalePROpportunityToInsight(paceOpportunity, mockT);
      expect(insight.methodology!.name).toBe(
        'insights.methodology.stalePrCrossRefName {metric: insights.stalePr.metricRunningThreshold}'
      );
      expect(insight.body).toContain('insights.stalePr.metricRunningThreshold');
      expect(insight.body).not.toContain('metricCyclingFtp');
    });
  });
});
