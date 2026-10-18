/**
 * What a screen reader hears for a feed card.
 *
 * The card is one pressable element, so its label stands in for everything it
 * draws: the name, the date, the headline figures, the secondary stats with
 * their units, the ground badge, the section PR and trend counts and the route
 * chip. Each part is the figure the card draws: a clock-style duration and an
 * abbreviated distance or climb are said through their spoken twins, which
 * reach the same quantity through the same arithmetic, and the rest is the
 * string the card draws, so the spoken card and the drawn card cannot disagree.
 */

import type { TFunction } from 'i18next';

import {
  formatCalories,
  formatHeartRate,
  formatPower,
  formatRelativeDateTime,
  formatTemperature,
  formatLoad,
} from '@/shared/format/format';
import { spokenDistance, spokenDuration, spokenElevation } from '@/shared/format/spoken';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import type { FeedCard } from '@/types';
import type { ActivityNewGround } from '../hooks/useActivitySectionHighlights';
import { cardPrimaryStats } from './cardPrimaryStats';

export interface ActivityCardSpeech {
  activity: FeedCard;
  isMetric: boolean;
  sectionHighlights?: { isPr: boolean; trend: number }[] | undefined;
  routeHighlight?:
    | {
        isPr: boolean;
        trend: number;
        timeDeltaSeconds?: number | null | undefined;
        prImprovementSeconds?: number | null | undefined;
      }
    | undefined;
  newGround?: Pick<ActivityNewGround, 'badge'> | undefined;
}

/**
 * The secondary stats the card draws, each with its name. The formatters carry
 * the unit, so it is not added again.
 */
export function activitySecondaryStatLabels(
  activity: FeedCard,
  isMetric: boolean,
  t: TFunction
): string[] {
  const labels: string[] = [];
  if (activity.trainingLoad) {
    labels.push(`${t('metrics.trainingLoad')}: ${formatLoad(activity.trainingLoad)}`);
  }
  if (activity.avgHr) {
    labels.push(`${t('activity.heartRate')}: ${formatHeartRate(activity.avgHr)}`);
  }
  if (activity.avgPower) {
    labels.push(`${t('activity.power')}: ${formatPower(activity.avgPower)}`);
  }
  if (activity.calories) {
    labels.push(`${t('activity.calories')}: ${formatCalories(activity.calories)}`);
  }
  if (activity.hasWeather && activity.averageWeatherTemp != null) {
    labels.push(
      `${t('activity.stats.temperature')}: ${formatTemperature(activity.averageWeatherTemp, isMetric)}`
    );
  }
  return labels;
}

export function activityCardA11yLabel(speech: ActivityCardSpeech, t: TFunction): string {
  const { activity, isMetric, sectionHighlights, routeHighlight, newGround } = speech;
  // A slot the card leaves out is not spoken either.
  const drawn = cardPrimaryStats(activity, isMetric);
  const distance = drawn.distance != null ? spokenDistance(activity.distance, isMetric) : null;
  const elevation =
    drawn.elevation != null ? spokenElevation(activity.elevationGain, isMetric) : null;

  const ground =
    newGround?.badge === 'entirelyNew'
      ? t('activity.newGround')
      : newGround?.badge === 'mostlyNew'
        ? t('activity.mostlyNewGround')
        : null;

  const highlights = sectionHighlights ?? [];
  const prCount = highlights.filter((h) => h.isPr).length;
  const faster = highlights.filter((h) => h.trend === 1 && !h.isPr).length;
  const slower = highlights.filter((h) => h.trend === -1 && !h.isPr).length;

  return composeAccessibilityLabel(
    activity.name,
    formatRelativeDateTime(activity.startDateLocal),
    distance,
    spokenDuration(activity.movingTime),
    elevation,
    ...activitySecondaryStatLabels(activity, isMetric, t),
    ground,
    prCount > 0 && t('a11y.prs', { n: prCount }),
    faster > 0 && t('a11y.faster', { n: faster }),
    slower > 0 && t('a11y.slower', { n: slower }),
    routeChipSpeech(routeHighlight, t)
  );
}

/** What the route chip says: a PR and its margin, or how far off the PR the ride was. */
export function routeChipSpeech(
  route: ActivityCardSpeech['routeHighlight'],
  t: TFunction
): string | null {
  if (!route) return null;
  if (route.isPr) {
    const gain = route.prImprovementSeconds;
    return gain != null && Math.round(gain) > 0
      ? t('a11y.prImprovement', { delta: spokenDuration(Math.round(gain)) })
      : t('a11y.personalRecord');
  }
  if (route.timeDeltaSeconds != null && route.timeDeltaSeconds > 0) {
    return t('a11y.offPr', { delta: spokenDuration(Math.round(route.timeDeltaSeconds)) });
  }
  return null;
}
