import type { TFunction } from 'i18next';
import type { HeroStat } from '@/shared/ui';
import type { ActivityRecord } from 'veloqrs';
import { cardPrimaryStats } from './cardPrimaryStats';

/**
 * The distance, time and climb under an activity's name, with or without a
 * map behind them. Always three slots in that order, null where the activity
 * has none, so a caller can pair each with its test id.
 *
 * The climb is drawn with a mark so it never reads as a second distance, and
 * spoken by its name rather than the mark.
 */
export function activityHeroStats(
  activity: Pick<ActivityRecord, 'distance' | 'movingTime' | 'elevationGain' | 'streamTypes'>,
  isMetric: boolean,
  t: TFunction
): [HeroStat | null, HeroStat, HeroStat | null] {
  const stats = cardPrimaryStats(
    {
      distance: activity.distance,
      movingTime: activity.movingTime,
      elevationGain: activity.elevationGain,
      hasAltitude: activity.streamTypes.includes('altitude'),
    },
    isMetric
  );
  return [
    stats.distance != null ? labelled(t('activity.distance'), stats.distance) : null,
    labelled(t('activity.duration'), stats.duration),
    stats.elevation != null
      ? {
          text: t('activity.gainStat', { value: stats.elevation }),
          label: `${t('sections.elevationGain')}: ${stats.elevation}`,
        }
      : null,
  ];
}

/** A stat drawn as its value and read with the name of what it is. */
function labelled(name: string, text: string): HeroStat {
  return { text, label: `${name}: ${text}` };
}
