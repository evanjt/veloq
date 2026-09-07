/**
 * Scenario: `confidence` was computed by two emit sites out of fifteen, and the
 * ranker gave the other thirteen a flat 0.5. A generator that measured nothing
 * therefore outscored one that measured its own thinness, which is live on the
 * tab since the score became the sort key.
 *
 * Expected behaviour: every generator either computes a confidence from the
 * population it has, or says it has none. The two are not the same to the
 * ranker, and neither is a default.
 */

import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import { confidenceScore, scoreInsight } from '@/features/insights/lib/rules';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateSectionChangedInsights } from '@/features/insights/generators/sectionChanged';
import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';
import type { Insight } from '@/features/insights/types';

const NOW = 1_700_000_000_000;
const t = (key: string) => key;

// Two days of seven: the thin-but-honest reading Q77 measured the inversion on.
const mockComputeHrvTrend = jest.fn(() => ({ avg: 62, dataPoints: 2, label: 'trendingUp' }));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ computeHrvTrend: mockComputeHrvTrend }),
}));

/** Every insight this suite reaches, from the generators that take fixtures. */
function everyInsight(): Insight[] {
  return [
    ...generateEfficiencyTrendInsights(
      [
        {
          sectionId: 's1',
          sectionName: 'Climb',
          isImproving: true,
          effortCount: 4,
          hrChangeBpm: -6,
          trendSlope: -0.0123,
          points: [],
        } as never,
      ],
      NOW,
      t
    ),
    ...generateHrvTrendInsight(NOW, t),
    ...generatePeriodComparisonInsights(
      { count: 6, totalDuration: 21_600, totalDistance: 120_000, totalTss: 400 },
      { count: 3, totalDuration: 9_000, totalDistance: 50_000, totalTss: 160 },
      null,
      NOW,
      t
    ),
    ...generateSectionChangedInsights(
      [{ sectionId: 's2', sectionName: 'Bridge', kind: 'recut', at: NOW - 1000 }],
      NOW,
      t
    ),
    ...generateSectionPRInsights(
      [{ sectionId: 's3', sectionName: 'Sprint', bestTime: 90, daysAgo: 2 }],
      NOW,
      t
    ),
    ...generateSectionTrendInsights(
      [
        {
          sectionId: 's4',
          sectionName: 'Loop',
          trend: 1,
          medianRecentSecs: 120,
          bestTimeSecs: 110,
          traversalCount: 5,
          daysSinceLast: 3,
          latestIsPr: false,
        },
      ],
      new Set<string>(),
      NOW,
      t
    ),
  ];
}

it('leaves no generator with an uncomputed confidence', () => {
  const insights = everyInsight();
  expect(insights.length).toBeGreaterThan(0);

  for (const insight of insights) {
    expect(insight).toHaveProperty('confidence');
    const { confidence } = insight;
    if (confidence !== null) {
      expect(typeof confidence).toBe('number');
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  }
});

it('scores a declared absence differently from a computed confidence', () => {
  const declared = { confidence: null } as Insight;
  const computed = { confidence: 0.5 } as Insight;

  expect(confidenceScore(declared)).toBe(0);
  expect(confidenceScore(computed)).toBeGreaterThan(0);
  expect(confidenceScore(computed)).not.toBe(confidenceScore(declared));
});

it('does not substitute a default for a confidence nobody computed', () => {
  const uncomputed = {} as Insight;
  expect(confidenceScore(uncomputed)).toBe(0);
});

/** A week against a week, from `count` activities in each. */
function periodComparison(count: number) {
  const insight = generatePeriodComparisonInsights(
    { count, totalDuration: 3600 * count, totalDistance: 20_000 * count, totalTss: 60 * count },
    { count, totalDuration: 1800 * count, totalDistance: 10_000 * count, totalTss: 30 * count },
    null,
    NOW,
    t
  )[0];
  expect(insight).toBeDefined();
  return insight;
}

it('ranks a thin comparison below a thinner-but-honest trend, and a solid one above it', () => {
  // Q77's acceptance evidence: an HRV trend on two of seven days computed 8.6
  // points and lost to a period comparison that computed nothing and took the
  // flat 15. Now both count, so the one standing on more wins and the one
  // standing on less loses. Same priority throughout, so confidence and the
  // category base are what separate them.
  const hrv = generateHrvTrendInsight(NOW, t)[0];
  const thin = periodComparison(1);
  const solid = periodComparison(6);

  expect(hrv).toBeDefined();
  expect(hrv.priority).toBe(thin.priority);
  expect(scoreInsight(hrv).score).toBeGreaterThan(scoreInsight(thin).score);
  expect(scoreInsight(solid).score).toBeGreaterThan(scoreInsight(hrv).score);
});

it('never lets a generator that counted nothing outrank one that counted something', () => {
  const counted = { priority: 2, category: 'period_comparison', confidence: 0.1 } as Insight;
  const silent = { priority: 2, category: 'period_comparison', confidence: null } as Insight;

  expect(scoreInsight(counted).score).toBeGreaterThan(scoreInsight(silent).score);
});

it('reports confidence as its own term, not folded into the priority base', () => {
  const scored = scoreInsight({ priority: 2, category: 'hrv_trend', confidence: 1 } as Insight);

  expect(scored.breakdown.confidence).toBe(INSIGHTS_CONFIG.scoring.confidenceWeight);
  expect(scored.breakdown.base).toBe((6 - 2) * 50);
});
