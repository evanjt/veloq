import type { TFunction } from 'i18next';
import { formatElevation } from '@/shared/format/format';
import type { HeroStat } from '@/shared/ui/DetailHero';
import { PERIOD_LABEL_KEYS, type Period } from '@/shared/app/period';
import type { FrequentSection } from '@/types';
import { sectionElevation } from './sectionElevation';
import { formatPercent } from '@/shared/format';

/** The attempts the chart under the hero plots, and what they are narrowed to. */
export interface HeroScope {
  /** Attempts the chart plots, absent until they are read. */
  count: number | undefined;
  /** The sport the chart plots. */
  sport: string | undefined;
  /** Sports the read offers over the range, so whether the sport narrows the count. */
  sportsOffered: number;
  /** The range the count is over. */
  range: Period;
}

/**
 * The words naming what a list of attempts is narrowed to: the sport when the
 * read offers more than one, then the range when it is not every date. Empty
 * when neither narrows it.
 */
export function scopeLabels(scope: Omit<HeroScope, 'count'>, t: TFunction): string[] {
  return [
    ...(scope.sport && scope.sportsOffered > 1
      ? [t(`activityTypes.${scope.sport}`, scope.sport)]
      : []),
    ...(scope.range !== 'all' ? [t(PERIOD_LABEL_KEYS.long[scope.range])] : []),
  ];
}

/** A grade under this reads as level ground, not as a gradient worth stating. */
const MIN_AVG_GRADE_PERCENT = 1.0;

/**
 * The climbing a section's card shows under its Peek: the gain, or the loss for a descent, then
 * the average grade when the ground is not level and the steepest grade of a climb or descent.
 * Empty for flat ground. Each carries the words a screen reader says for it.
 */
export function sectionClimbStats(
  section: Pick<
    FrequentSection,
    'elevationGainM' | 'elevationLossM' | 'avgGradePercent' | 'maxGradePercent' | 'klass'
  >,
  t: TFunction,
  isMetric = true
): HeroStat[] {
  const elevation = sectionElevation(section);
  const stats: HeroStat[] = [];
  if (elevation) {
    const metres = formatElevation(elevation.metres, isMetric);
    stats.push(
      elevation.direction === 'loss'
        ? { text: `-${metres}`, label: `${t('recording.elevation')}: -${metres}` }
        : { text: metres, label: `${t('sections.elevationGain')}: ${metres}` }
    );
  }
  if (
    elevation &&
    section.avgGradePercent != null &&
    Math.abs(section.avgGradePercent) >= MIN_AVG_GRADE_PERCENT
  ) {
    const grade = formatPercent(section.avgGradePercent, 1);
    stats.push({ text: grade, label: `${t('sections.avgGrade')}: ${grade}` });
  }
  if (
    section.maxGradePercent != null &&
    (section.klass === 'climb' || section.klass === 'descent')
  ) {
    const steepest = t('sections.maxGradeValue', {
      grade: formatPercent(section.maxGradePercent, 1),
    });
    stats.push({ text: steepest, label: steepest });
  }
  return stats;
}
