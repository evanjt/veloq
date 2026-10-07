import { EfficiencyDirection, type EfficiencyTrend } from 'veloqrs';

import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { makeInsight } from '@/features/insights/lib/insightBuilder';
import { applyMixAndCap, scoreInsight } from '@/features/insights/lib/rules';
import type { FtpTrend, PaceTrend } from '@/features/insights/types';

const NOW = 1_700_000_000_000;
const t = (key: string) => key;

function ftp(deltaWatts: number): FtpTrend {
  return { latestFtp: 240, previousFtp: 240 - deltaWatts, deltaWatts, sampleCount: 20 };
}

function pace(gainPercent: number): PaceTrend {
  return {
    latestPace: 3,
    previousPace: 3.5,
    gainPercent,
    deltaSeconds: -47.6,
    sampleCount: 20,
  };
}

function efficiency(
  direction: 'improving' | 'flat' | 'worsening',
  effortCount = 5
): EfficiencyTrend {
  return {
    sectionId: direction,
    sectionName: 'River Rise',
    sportType: 'Ride',
    points: [],
    trendSlope: direction === 'worsening' ? 20 : direction === 'improving' ? -20 : 0,
    direction: {
      improving: EfficiencyDirection.Improving,
      flat: EfficiencyDirection.Flat,
      worsening: EfficiencyDirection.Worsening,
    }[direction],
    hrChangeBpm: direction === 'worsening' ? 6 : -6,
    effortCount,
  } as EfficiencyTrend;
}

it('reports a fall at twice the rising eFTP floor and rejects one just below it', () => {
  const [decline] = generateFitnessMilestoneInsights(ftp(-10), null, null, NOW, t);

  expect(decline.title).toBe('insights.ftpChange');
  expect(
    decline.supportingData?.dataPoints?.find((point) => point.label === 'insights.data.change')
      ?.value
  ).toBe('-10');
  expect(generateFitnessMilestoneInsights(ftp(-22), null, null, NOW, t)).toHaveLength(1);
  expect(generateFitnessMilestoneInsights(ftp(-9), null, null, NOW, t)).toHaveLength(0);
});

it('reports a critical speed fall at twice the rising pace floor', () => {
  const [decline] = generateFitnessMilestoneInsights(null, pace(-2), null, NOW, t);

  expect(decline.title).toBe('insights.paceChange');
  expect(generateFitnessMilestoneInsights(null, pace(-1.9), null, NOW, t)).toHaveLength(0);
});

it('requires five efforts for worsening efficiency and ignores a flat trend', () => {
  const [decline] = generateEfficiencyTrendInsights([efficiency('worsening')], NOW, t);

  expect(decline.title).toBe('insights.efficiencyTrend.changeTitle');
  expect(decline.supportingData?.trend?.verdict).toBe('declined');
  expect(generateEfficiencyTrendInsights([efficiency('worsening', 4)], NOW, t)).toHaveLength(0);
  expect(generateEfficiencyTrendInsights([efficiency('flat')], NOW, t)).toHaveLength(0);
});

it('drops a decline before an improvement when the category is full', () => {
  const decline = generateEfficiencyTrendInsights([efficiency('worsening')], NOW, t)[0];
  const improvements = generateEfficiencyTrendInsights(
    [
      { ...efficiency('improving'), sectionId: 'east' },
      { ...efficiency('improving'), sectionId: 'west' },
    ],
    NOW,
    t
  );
  const { kept } = applyMixAndCap(
    [decline, ...improvements].map((insight) => scoreInsight(insight))
  );

  expect(kept.map((insight) => insight.id)).toEqual(improvements.map((insight) => insight.id));
});

it('keeps a well-founded decline ahead of lower-scoring cards from other categories', () => {
  const [decline] = generateFitnessMilestoneInsights(ftp(-10), null, null, NOW, t);
  const categories = [
    'section_changed',
    'section_changed',
    'route',
    'route',
    'strength_balance',
    'strength_balance',
    'hrv_trend',
    'stale_pr',
  ] as const;
  const others = categories.map((category, index) =>
    makeInsight({
      id: `other-${index}`,
      category,
      priority: 5,
      icon: 'information-outline',
      iconTone: 'neutral',
      title: 'A neutral observation',
      timestamp: NOW,
      confidence: null,
    })
  );
  const declineScore = scoreInsight(decline);
  const otherScores = others.map((insight) => scoreInsight(insight));
  expect(otherScores.every(({ score }) => score < declineScore.score)).toBe(true);

  const { kept, dropped } = applyMixAndCap([...otherScores, declineScore]);

  expect(kept).toHaveLength(8);
  expect(kept[0].id).toBe(decline.id);
  expect(dropped).not.toContainEqual(
    expect.objectContaining({ insight: decline, reason: 'surface_cap' })
  );
});
