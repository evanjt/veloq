/**
 * Scenario: the engine computes four section scores per section and blends them into
 * a relevance composite. They reach TypeScript, the sections tab ranks on them,
 * and the insights tab shows them as data points while no ranking term reads
 * one.
 *
 * Expected behaviour: a section insight is ranked by what the engine says the
 * section is worth. An insight with no section has no such score and says so,
 * rather than taking a middle the way `confidence` used to.
 */

import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import { rankingScore, scoreInsight } from '@/features/insights/lib/rules';
import type { Insight, SectionRankingScores } from '@/features/insights/types';

const { rankingWeight } = INSIGHTS_CONFIG.scoring;

function ranked(ranking?: SectionRankingScores): Insight {
  return {
    id: 'i',
    category: 'section_trend',
    priority: 2,
    title: 'Sunday Climb getting faster',
    icon: 'x',
    iconTone: 'neutral',
    timestamp: 0,
    isNew: false,
    confidence: 1,
    meta: { sectionId: 's1', ranking },
  } as Insight;
}

const flat = (v: number): SectionRankingScores => ({
  relevance: v,
  recency: v,
  improvement: v,
  anomaly: v,
  engagement: v,
});

it('scores a section the engine rates highly above one it rates poorly', () => {
  expect(rankingScore(ranked(flat(0.9)))).toBeGreaterThan(rankingScore(ranked(flat(0.2))));
});

it('gives a section the engine rates at its ceiling the whole term', () => {
  expect(rankingScore(ranked(flat(1)))).toBeCloseTo(rankingWeight);
  expect(rankingScore(ranked(flat(0)))).toBe(0);
});

it('scores an insight with no section at zero, not at a middle', () => {
  expect(rankingScore(ranked(undefined))).toBe(0);
});

it('follows the engine relevance and ignores a component changed on its own', () => {
  const base = { relevance: 0.5, recency: 0.5, improvement: 0.5, anomaly: 0.5, engagement: 0.5 };
  const reference = rankingScore(ranked(base));

  expect(reference).toBeCloseTo(rankingWeight * 0.5);
  expect(rankingScore(ranked({ ...base, improvement: 1, recency: 0 }))).toBe(reference);
  expect(rankingScore(ranked({ ...base, relevance: 0.8 }))).toBeCloseTo(rankingWeight * 0.8);
});

it('clamps a relevance outside the unit range and ignores a non-finite one', () => {
  expect(rankingScore(ranked({ ...flat(0), relevance: 2 }))).toBeCloseTo(rankingWeight);
  expect(rankingScore(ranked({ ...flat(0), relevance: -1 }))).toBe(0);
  expect(rankingScore(ranked({ ...flat(0), relevance: Number.NaN }))).toBe(0);
});

it('lets the engine score separate two insights the other terms tie', () => {
  const strong = scoreInsight(ranked(flat(1)));
  const weak = scoreInsight(ranked(flat(0)));

  expect(strong.insight.priority).toBe(weak.insight.priority);
  expect(strong.score).toBeGreaterThan(weak.score);
  expect(strong.breakdown.ranking).toBeCloseTo(rankingWeight);
  expect(weak.breakdown.ranking).toBe(0);
});
