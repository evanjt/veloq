import { getIntlLocale } from '@/shared/format/format';
import type { SectionRankingScores } from '../types';

export type RankingFactorKind = 'recency' | 'improvement' | 'anomaly' | 'engagement';
export type ImprovementBasisKind = 'medianOfThree' | 'firstToLast';

/**
 * One reason a card was chosen. A bounded factor carries `score`, the
 * improvement carries `change` and `basis`, and an improvement the engine did
 * not measure carries neither, which is not a 0% change.
 */
export interface RankingFactor {
  kind: RankingFactorKind;
  score?: string;
  change?: string;
  basis?: ImprovementBasisKind;
}

// `FfiImprovementBasis` is a numeric enum from the native module; matching its
// values here keeps this file free of a runtime import of that module.
const MEDIAN_OF_THREE = 0;
const FIRST_TO_LAST = 1;

/** A signed fraction as a whole percentage: +14%, 0%, -150%. A rounded zero has no sign. */
export function formatSignedPercent(fraction: number): string {
  const rounded = Math.round(fraction * 100);
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded)}%`;
}

/** A bounded engine score on its 0 to 1 scale, to two decimal places. */
function formatScore(score: number): string {
  return score.toLocaleString(getIntlLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function basisKind(basis: SectionRankingScores['improvementBasis']): ImprovementBasisKind | null {
  if (basis === MEDIAN_OF_THREE) return 'medianOfThree';
  if (basis === FIRST_TO_LAST) return 'firstToLast';
  return null;
}

/**
 * The four card-selection factors behind a ranking. The composite relevance is
 * not one of them. The improvement is read from the signed change and its
 * basis, never from the clamped `improvement` score.
 */
export function rankingFactors(ranking: SectionRankingScores): RankingFactor[] {
  const basis = basisKind(ranking.improvementBasis);
  const improvement: RankingFactor =
    ranking.improvementChange != null && basis != null
      ? { kind: 'improvement', change: formatSignedPercent(ranking.improvementChange), basis }
      : { kind: 'improvement' };
  return [
    { kind: 'recency', score: formatScore(ranking.recency) },
    improvement,
    { kind: 'anomaly', score: formatScore(ranking.anomaly) },
    { kind: 'engagement', score: formatScore(ranking.engagement) },
  ];
}
