import { isPaceSport } from '@/shared/activity/activityUtils';
import { onlySport } from '@/shared/activity/sportSet';
import type { ActivityType, FrequentSection } from '@/types';

export function useSectionMapData(
  effectiveSportType: string | undefined,
  section: FrequentSection | null
) {
  // A pace or a speed belongs to one sport: the one being read, or the only
  // one that has taken the section. Several with none picked reads as speed.
  const sport = effectiveSportType ?? onlySport(section?.sportTypes);
  const isRunning = sport ? isPaceSport(sport as ActivityType) : false;

  return { isRunning };
}
