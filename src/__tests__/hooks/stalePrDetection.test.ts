import {
  detectStalePROpportunities,
  stalePROpportunityToInsight,
  StalePRInput,
  StalePROpportunity,
} from '@/hooks/insights/stalePrDetection';

// Mock translation function — returns key with interpolated params
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

  describe('returns no opportunities when', () => {
    it('ftpTrend is null', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: null,
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('FTP has not changed', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 200,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('FTP decreased', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 180,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('FTP gain is below 3% threshold', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 204,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      // 2% gain — below threshold
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('there are no sections', () => {
      const input: StalePRInput = {
        sections: [],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('section had a recent PR (within 30 days)', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 5 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [{ sectionId: 's1', sectionName: 'Hill Climb', bestTime: 300, daysAgo: 5 }],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('section was visited recently (within 30 days)', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 10 * DAYS, // only 10 days ago
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('latestFtp is undefined', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: undefined,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('previousFtp is undefined', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: undefined,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('FTP values are NaN', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: NaN,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });

    it('section has zero traversals', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 0,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      expect(detectStalePROpportunities(input)).toEqual([]);
    });
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
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
      expect(result[0].sectionId).toBe('s1');
      expect(result[0].sectionName).toBe('Hill Climb');
      expect(result[0].currentFtp).toBe(220);
      expect(result[0].estimatedPrFtp).toBe(200);
      expect(result[0].ftpGainPercent).toBe(10);
      expect(result[0].bestTimeSecs).toBe(300);
    });

    it('section has no lastTraversalTs but is absent from recent PRs', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'River Path',
            bestTimeSecs: 600,
            traversalCount: 5,
            // no lastTraversalTs
          },
        ],
        ftpTrend: {
          latestFtp: 250,
          latestDate: NOW_TS,
          previousFtp: 230,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
      expect(result[0].sectionId).toBe('s1');
    });

    it('filters out sections with recent PRs but keeps stale ones', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill Climb',
            bestTimeSecs: 300,
            traversalCount: 10,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
          {
            sectionId: 's2',
            sectionName: 'River Path',
            bestTimeSecs: 600,
            traversalCount: 8,
            lastTraversalTs: NOW_TS - 45 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [{ sectionId: 's1', sectionName: 'Hill Climb', bestTime: 300, daysAgo: 5 }],
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
      expect(result[0].sectionId).toBe('s2');
    });

    it('limits results to 3 opportunities', () => {
      const sections = Array.from({ length: 5 }, (_, i) => ({
        sectionId: `s${i}`,
        sectionName: `Section ${i}`,
        bestTimeSecs: 300 + i * 60,
        traversalCount: 10 - i,
        lastTraversalTs: NOW_TS - (40 + i * 10) * DAYS,
      }));
      const input: StalePRInput = {
        sections,
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
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
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
          {
            sectionId: 's2',
            sectionName: 'Often visited',
            bestTimeSecs: 600,
            traversalCount: 20,
            lastTraversalTs: NOW_TS - 45 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
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
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 220,
          latestDate: BigInt(NOW_TS),
          previousFtp: 200,
          previousDate: BigInt(NOW_TS - 90 * DAYS),
        },
        recentPRs: [],
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
    });

    it('rounds ftpGainPercent to one decimal', () => {
      const input: StalePRInput = {
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Hill',
            bestTimeSecs: 300,
            traversalCount: 5,
            lastTraversalTs: NOW_TS - 60 * DAYS,
          },
        ],
        ftpTrend: {
          latestFtp: 213,
          latestDate: NOW_TS,
          previousFtp: 200,
          previousDate: NOW_TS - 90 * DAYS,
        },
        recentPRs: [],
      };
      const result = detectStalePROpportunities(input);
      expect(result).toHaveLength(1);
      // (213-200)/200 = 6.5%
      expect(result[0].ftpGainPercent).toBe(6.5);
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
      currentFtp: 220,
      estimatedPrFtp: 200,
      ftpGainPercent: 10,
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

    it('includes FTP values in subtitle', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      expect(insight.subtitle).toContain('200');
      expect(insight.subtitle).toContain('220');
    });

    it('includes supporting data with FTP comparison', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      expect(insight.supportingData).toBeDefined();
      expect(insight.supportingData!.dataPoints).toHaveLength(4);
      expect(insight.supportingData!.formula).toContain('220');
      expect(insight.supportingData!.formula).toContain('200');
      expect(insight.supportingData!.formula).toContain('+10%');
    });

    it('includes methodology', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      expect(insight.methodology).toBeDefined();
      expect(insight.methodology!.name).toBe('FTP-PR cross-reference');
    });

    it('formats best time using formatDuration', () => {
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      // 263 seconds = 4:23
      expect(insight.body).toContain('4:23');
    });

    it('uses Date.now() when no timestamp provided', () => {
      const before = Date.now();
      const insight = stalePROpportunityToInsight(opportunity, mockT);
      const after = Date.now();
      expect(insight.timestamp).toBeGreaterThanOrEqual(before);
      expect(insight.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
