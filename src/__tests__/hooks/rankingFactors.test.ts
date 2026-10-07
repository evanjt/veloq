/**
 * Scenario: the engine's improvement change is a signed fraction, +0.14 for 14%
 * faster and -1.5 for 150% slower, absent when it compared nothing. The ranking
 * factors shown on an insight sheet read it as a signed percentage and never
 * as a score.
 *
 * Expected behaviour: the sign is explicit, a rounded zero reads 0%, a change
 * beyond -100% is kept, and no change is unavailable rather than 0%.
 */

import {
  formatSignedPercent,
  rankingFactors,
  type RankingFactor,
} from '@/features/insights/lib/rankingFactors';
import type { SectionRankingScores } from '@/features/insights/types';

const MEDIAN_OF_THREE = 0;
const FIRST_TO_LAST = 1;

const ranking = (extra: Partial<SectionRankingScores> = {}): SectionRankingScores => ({
  relevance: 0.91,
  recency: 0.8,
  improvement: 0.5,
  anomaly: 0.256,
  engagement: 0.3,
  ...extra,
});

const factor = (r: SectionRankingScores, kind: RankingFactor['kind']) =>
  rankingFactors(r).find((f) => f.kind === kind);

describe('formatSignedPercent', () => {
  it.each([
    [0.14, '+14%'],
    [0, '0%'],
    [-0.14, '-14%'],
    [-1.5, '-150%'],
    [-0.001, '0%'],
    [0.004, '0%'],
    [-0, '0%'],
    [2.5, '+250%'],
  ])('%p reads %s', (fraction, text) => {
    expect(formatSignedPercent(fraction)).toBe(text);
  });
});

describe('rankingFactors', () => {
  it('lists the four factors and never the composite', () => {
    expect(rankingFactors(ranking()).map((f) => f.kind)).toEqual([
      'recency',
      'improvement',
      'anomaly',
      'engagement',
    ]);
  });

  it('gives the three bounded factors a two-decimal score and no percentage', () => {
    expect(factor(ranking(), 'recency')?.score).toBe('0.80');
    expect(factor(ranking(), 'anomaly')?.score).toBe('0.26');
    expect(factor(ranking(), 'engagement')?.score).toBe('0.30');
    expect(factor(ranking(), 'recency')?.change).toBeUndefined();
  });

  it('reads the improvement from the signed change and its basis, not from the clamped score', () => {
    const f = factor(
      ranking({ improvement: 0.57, improvementChange: 0.14, improvementBasis: MEDIAN_OF_THREE }),
      'improvement'
    );
    expect(f).toMatchObject({ change: '+14%', basis: 'medianOfThree' });
    expect(f?.score).toBeUndefined();
  });

  it('names the first-to-last basis', () => {
    const f = factor(
      ranking({ improvementChange: -0.14, improvementBasis: FIRST_TO_LAST }),
      'improvement'
    );
    expect(f).toMatchObject({ change: '-14%', basis: 'firstToLast' });
  });

  it('keeps a change beyond -100%', () => {
    const f = factor(
      ranking({ improvementChange: -1.5, improvementBasis: MEDIAN_OF_THREE }),
      'improvement'
    );
    expect(f?.change).toBe('-150%');
  });

  it('reports a measured zero as 0%', () => {
    const f = factor(
      ranking({ improvementChange: 0, improvementBasis: MEDIAN_OF_THREE }),
      'improvement'
    );
    expect(f?.change).toBe('0%');
  });

  it('marks an absent change unavailable, with no percentage and no basis', () => {
    const f = factor(ranking(), 'improvement');
    expect(f?.change).toBeUndefined();
    expect(f?.basis).toBeUndefined();
  });

  it('marks a change with no basis unavailable', () => {
    const f = factor(ranking({ improvementChange: 0.2 }), 'improvement');
    expect(f?.change).toBeUndefined();
  });
});
