import { onlySport } from '@/shared/activity/sportSet';

/**
 * The sport an insight card labels itself with.
 *
 * Shared ground holds a record in each sport that travels it, so the section
 * has no sport that is the record's: a run PR on a much-ridden climb drew a
 * bicycle until the engine started carrying the record's sport with the row.
 * For a row from a build that carried none, the section's only sport stands
 * in, and ground several sports have taken gives none.
 */
export function cardSportType(
  record?: string,
  sectionSports?: readonly string[]
): string | undefined {
  return record || onlySport(sectionSports);
}

/**
 * The name a claim is shown under: the section's, with the sport the claim
 * was made in when one is known, so a section ridden and run reads as two
 * claims. A row with no sport keeps the plain name.
 */
export function sectionWithSport(
  name: string,
  sportType: string | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (!sportType) return name;
  return t('insights.sectionWithSport', {
    name,
    sport: t(`activityTypes.${sportType}`, { defaultValue: sportType }),
  });
}

/** One row per (section, sport): the React key and the expansion state's key. */
export function sectionRowKey(row: { sectionId: string; sportType?: string | undefined }): string {
  return `${row.sectionId}:${row.sportType ?? ''}`;
}
