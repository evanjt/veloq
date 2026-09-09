/**
 * Hook for section encounters - one entry per (section, direction) for an activity.
 * This is the canonical data source for the activity sections tab.
 */

import type { SectionEncounter } from 'veloqrs';

export interface UseSectionEncountersResult {
  encounters: SectionEncounter[];
  isLoading: boolean;
}

/**
 * The encounters come from `getActivityDetailData`, which the screen reads
 * before it mounts this hook.
 */
export function useSectionEncounters(encounters: SectionEncounter[]): UseSectionEncountersResult {
  return { encounters, isLoading: false };
}
