import type { TFunction } from 'i18next';
import { formatDistance, formatElevation } from '@/shared/format/format';
import { PERIOD_LABEL_KEYS, type Period } from '@/shared/app/period';
import type { FrequentSection } from '@/types';
import { sectionElevation } from './sectionElevation';

/** What a hero describes: a section with its grades, or a route. */
export type HeroSubject =
  | {
      kind: 'section';
      section: Pick<
        FrequentSection,
        | 'distanceMeters'
        | 'elevationGainM'
        | 'elevationLossM'
        | 'avgGradePercent'
        | 'maxGradePercent'
        | 'klass'
      >;
    }
  | {
      kind: 'route';
      /** The representative's length, which describes the line drawn. */
      distanceMeters: number;
      /** The representative's climbing. */
      elevationGainMeters: number;
    };

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

/** A grade under this reads as level ground, not as a gradient worth stating. */
const MIN_AVG_GRADE_PERCENT = 1.0;

/**
 * The stats a section or route hero shows under its name: the distance, the
 * attempts the chart plots labelled with the sport and range when either
 * narrows them, then the climbing. The grades describe a climb or descent
 * class, which only a section has.
 */
export function heroStats(
  subject: HeroSubject,
  scope: HeroScope,
  t: TFunction,
  isMetric = true
): string[] {
  const section = subject.kind === 'section' ? subject.section : undefined;
  const distance =
    subject.kind === 'section' ? subject.section.distanceMeters : subject.distanceMeters;
  const elevation = sectionElevation(
    subject.kind === 'section' ? subject.section : { elevationGainM: subject.elevationGainMeters }
  );

  const stats = [formatDistance(distance, isMetric)];
  if (scope.count != null) {
    const countKey = section ? 'sections.traversalsCount' : 'maps.activitiesCount';
    stats.push(
      [
        t(countKey, { count: scope.count }),
        ...(scope.sport && scope.sportsOffered > 1
          ? [t(`activityTypes.${scope.sport}`, scope.sport)]
          : []),
        ...(scope.range !== 'all' ? [t(PERIOD_LABEL_KEYS.long[scope.range])] : []),
      ].join(' · ')
    );
  }
  if (elevation) {
    const metres = formatElevation(elevation.metres, isMetric);
    stats.push(elevation.direction === 'loss' ? `-${metres}` : metres);
  }
  if (
    section &&
    elevation &&
    section.avgGradePercent != null &&
    Math.abs(section.avgGradePercent) >= MIN_AVG_GRADE_PERCENT
  ) {
    stats.push(`${section.avgGradePercent.toFixed(1)}%`);
  }
  if (
    section?.maxGradePercent != null &&
    (section.klass === 'climb' || section.klass === 'descent')
  ) {
    stats.push(`${t('sections.maxGrade')} ${section.maxGradePercent.toFixed(1)}%`);
  }
  return stats;
}
