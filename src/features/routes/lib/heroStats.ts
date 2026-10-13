import type { TFunction } from 'i18next';
import { formatDistance, formatElevation } from '@/shared/format/format';
import type { HeroStat } from '@/shared/ui/DetailHero';
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
 * class, which only a section has. Each carries the words a screen reader
 * says for it, naming what the value is.
 */
export function heroStats(
  subject: HeroSubject,
  scope: HeroScope,
  t: TFunction,
  isMetric = true
): HeroStat[] {
  const section = subject.kind === 'section' ? subject.section : undefined;
  const distance =
    subject.kind === 'section' ? subject.section.distanceMeters : subject.distanceMeters;
  const elevation = sectionElevation(
    subject.kind === 'section' ? subject.section : { elevationGainM: subject.elevationGainMeters }
  );

  const distanceText = formatDistance(distance, isMetric);
  const stats: HeroStat[] = [
    { text: distanceText, label: `${t('activity.distance')}: ${distanceText}` },
  ];
  if (scope.count != null) {
    const countKey = section ? 'sections.traversalsCount' : 'maps.activitiesCount';
    const parts = [
      t(countKey, { count: scope.count }),
      ...(scope.sport && scope.sportsOffered > 1
        ? [t(`activityTypes.${scope.sport}`, scope.sport)]
        : []),
      ...(scope.range !== 'all' ? [t(PERIOD_LABEL_KEYS.long[scope.range])] : []),
    ];
    stats.push({ text: parts.join(' · '), label: parts.join(', ') });
  }
  if (elevation) {
    const metres = formatElevation(elevation.metres, isMetric);
    stats.push(
      elevation.direction === 'loss'
        ? { text: `-${metres}`, label: `${t('recording.elevation')}: -${metres}` }
        : { text: metres, label: `${t('sections.elevationGain')}: ${metres}` }
    );
  }
  if (
    section &&
    elevation &&
    section.avgGradePercent != null &&
    Math.abs(section.avgGradePercent) >= MIN_AVG_GRADE_PERCENT
  ) {
    const grade = `${section.avgGradePercent.toFixed(1)}%`;
    stats.push({ text: grade, label: `${t('sections.avgGrade')}: ${grade}` });
  }
  if (
    section?.maxGradePercent != null &&
    (section.klass === 'climb' || section.klass === 'descent')
  ) {
    const steepest = t('sections.maxGradeValue', {
      grade: `${section.maxGradePercent.toFixed(1)}%`,
    });
    stats.push({ text: steepest, label: steepest });
  }
  return stats;
}
