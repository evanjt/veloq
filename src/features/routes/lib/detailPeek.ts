import type { TFunction } from 'i18next';

import { formatDistance, formatDuration, formatFullDate } from '@/shared/format/format';
import type { HeroStat } from '@/shared/ui/DetailHero';
import { scopeLabels, type HeroScope } from './heroStats';

/** What a route or section card's Peek row says under the name. */
export interface DetailPeekInput {
  /** Whose card it is, which words the count: a route's activities, a section's traversals. */
  kind: 'route' | 'section';
  /** The length of the line drawn: a route's representative, a section's own. */
  distanceMeters: number;
  /** What the attempts are narrowed to, with their count, absent until they are read. */
  scope: HeroScope;
  /** The fastest attempt's time, in seconds, absent until the attempts are read. */
  bestTimeSecs: number | undefined;
  /** The oldest and newest attempt in the range. */
  firstDate: Date | null;
  lastDate: Date | null;
}

/** The separator a Peek line draws between its parts. */
export const PEEK_SEPARATOR = ' · ';

/**
 * The line under a card's name: what the attempts are narrowed to, when the sport or the range
 * narrows them, then the first and the last attempt's dates, joined by middle dots. Empty while
 * nothing is known.
 */
export function detailDateLine(input: DetailPeekInput, t: TFunction): string {
  return [
    ...scopeLabels(input.scope, t),
    ...(input.firstDate
      ? [`${t('sections.firstVisited')} ${formatFullDate(input.firstDate)}`]
      : []),
    ...(input.lastDate ? [`${t('sections.lastVisited')} ${formatFullDate(input.lastDate)}`] : []),
  ].join(PEEK_SEPARATOR);
}

/**
 * The three numbers a card's Peek row shows: the distance, the attempts the chart plots and the
 * fastest of them. The two read with the attempts are left out until they are read. Each carries
 * the words a screen reader says for it.
 */
export function detailPeekStats(input: DetailPeekInput, t: TFunction, isMetric = true): HeroStat[] {
  const distance = formatDistance(input.distanceMeters, isMetric);
  const stats: HeroStat[] = [{ text: distance, label: `${t('activity.distance')}: ${distance}` }];
  if (input.scope.count != null) {
    const countKey = input.kind === 'section' ? 'sections.traversalsCount' : 'maps.activitiesCount';
    const visits = t(countKey, { count: input.scope.count });
    stats.push({ text: visits, label: visits });
  }
  if (input.bestTimeSecs != null) {
    const best = t('routes.prTime', { time: formatDuration(input.bestTimeSecs) });
    stats.push({ text: best, label: best });
  }
  return stats;
}
