import type { SectionEncounter } from 'veloqrs';

/** One section on the activity Sections tab, with every traversal of it. */
export interface SectionEncounterGroup {
  sectionId: string;
  sectionName: string;
  encounters: SectionEncounter[];
  /** True when the activity crossed the section in both directions. */
  hasBothDirections: boolean;
}

/**
 * Collapse per-direction encounters into one group per section.
 *
 * Grouping is on `sectionId`, never the display name: two distinct sections
 * can share a name and must keep their own card and index. Groups come out in
 * first-appearance order so the card index follows the engine's ordering.
 */
export function groupSectionEncounters(encounters: SectionEncounter[]): SectionEncounterGroup[] {
  const groups: SectionEncounterGroup[] = [];
  const bySectionId = new Map<string, SectionEncounterGroup>();

  for (const encounter of encounters) {
    const existing = bySectionId.get(encounter.sectionId);
    if (existing) {
      existing.encounters.push(encounter);
      existing.hasBothDirections = existing.encounters.some(
        (e) => e.direction !== existing.encounters[0].direction
      );
      continue;
    }

    const group: SectionEncounterGroup = {
      sectionId: encounter.sectionId,
      sectionName: encounter.sectionName,
      encounters: [encounter],
      hasBothDirections: false,
    };
    bySectionId.set(encounter.sectionId, group);
    groups.push(group);
  }

  return groups;
}
