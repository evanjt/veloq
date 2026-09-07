/**
 * Scenario: the engine computes four ML scores per section and blends them into
 * a relevance composite. They reach TypeScript, the sections tab ranks on them,
 * and the insights tab shows them as data points while no ranking term reads
 * one.
 *
 * Expected behaviour: a section insight is ranked by what the engine says the
 * section is worth. An insight with no section has no such score and says so,
 * rather than taking a middle the way `confidence` used to.
 */

import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import { mlScore, scoreInsight } from '@/features/insights/lib/rules';
import type { Insight, SectionRankingScores } from '@/features/insights/types';

const { rankingWeight } = INSIGHTS_CONFIG.scoring;

function ranked(ranking?: SectionRankingScores): Insight {
  return {
    id: 'i',
    category: 'section_trend',
    priority: 2,
    title: 'Sunday Climb getting faster',
    icon: 'x',
    iconColor: '#000',
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
  expect(mlScore(ranked(flat(0.9)))).toBeGreaterThan(mlScore(ranked(flat(0.2))));
});

it('gives a section the engine rates at its ceiling the whole term', () => {
  expect(mlScore(ranked(flat(1)))).toBeCloseTo(rankingWeight);
  expect(mlScore(ranked(flat(0)))).toBe(0);
});

it('scores an insight with no section at zero, not at a middle', () => {
  expect(mlScore(ranked(undefined))).toBe(0);
});

it('never counts a component twice through the relevance composite', () => {
  // `relevance` is exactly 0.35*recency + 0.30*improvement + 0.20*anomaly +
  // 0.15*engagement (`persistence/sections/ranking.rs`). A term that read it
  // beside its own components would weigh every component twice.
  const components = { recency: 1, improvement: 1, anomaly: 1, engagement: 1 };
  const honest = { ...components, relevance: 1 } as SectionRankingScores;
  const lying = { ...components, relevance: 0 } as SectionRankingScores;

  expect(mlScore(ranked(honest))).toBe(mlScore(ranked(lying)));
});

it('lets the engine score separate two insights the other terms tie', () => {
  const strong = scoreInsight(ranked(flat(1)));
  const weak = scoreInsight(ranked(flat(0)));

  expect(strong.insight.priority).toBe(weak.insight.priority);
  expect(strong.score).toBeGreaterThan(weak.score);
  expect(strong.breakdown.ranking).toBeCloseTo(rankingWeight);
  expect(weak.breakdown.ranking).toBe(0);
});
