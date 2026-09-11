/**
 * Scenario: a section traversed both ways produced two cards on the activity
 * Sections tab, so one section occupied two index numbers.
 *
 * Expected behaviour: encounters group by section identity, never by display
 * name, and each group keeps the order the engine handed them in.
 */

import { groupSectionEncounters } from '@/features/activity/lib/groupSectionEncounters';
import type { SectionEncounter } from 'veloqrs';

function encounter(overrides: Partial<SectionEncounter> & { sectionId: string }): SectionEncounter {
  return {
    sectionName: `Section ${overrides.sectionId}`,
    direction: 'same',
    distanceMeters: 1000,
    lapTime: 120,
    lapPace: 2,
    isPr: false,
    visitCount: 3,
    historyTimes: [],
    historyActivityIds: [],
    ...overrides,
  };
}

describe('groupSectionEncounters', () => {
  it('returns no groups for an empty list', () => {
    expect(groupSectionEncounters([])).toEqual([]);
  });

  it('puts forward and reverse traversals of one section in a single group', () => {
    const groups = groupSectionEncounters([
      encounter({ sectionId: 'sec-63', direction: 'same' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sectionId).toBe('sec-63');
    expect(groups[0].encounters.map((e) => e.direction)).toEqual(['same', 'reverse']);
  });

  it('keeps a single-direction section as its own group', () => {
    const groups = groupSectionEncounters([encounter({ sectionId: 'sec-70' })]);

    expect(groups).toHaveLength(1);
    expect(groups[0].encounters).toHaveLength(1);
  });

  it('keeps distinct sections that share a display name separate', () => {
    const groups = groupSectionEncounters([
      encounter({ sectionId: 'sec-a', sectionName: 'Climb' }),
      encounter({ sectionId: 'sec-b', sectionName: 'Climb' }),
    ]);

    expect(groups.map((g) => g.sectionId)).toEqual(['sec-a', 'sec-b']);
  });

  it('orders groups by where each section first appears', () => {
    const groups = groupSectionEncounters([
      encounter({ sectionId: 'sec-63' }),
      encounter({ sectionId: 'sec-64' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
    ]);

    expect(groups.map((g) => g.sectionId)).toEqual(['sec-63', 'sec-64']);
    expect(groups[0].encounters).toHaveLength(2);
    expect(groups[1].encounters).toHaveLength(1);
  });

  it('names the group from its first encounter', () => {
    const groups = groupSectionEncounters([
      encounter({ sectionId: 'sec-63', sectionName: 'Mont d’Orge' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse', sectionName: 'Mont d’Orge' }),
    ]);

    expect(groups[0].sectionName).toBe('Mont d’Orge');
  });

  it('reports whether a group carries more than one direction', () => {
    const [both, one] = groupSectionEncounters([
      encounter({ sectionId: 'sec-63', direction: 'same' }),
      encounter({ sectionId: 'sec-63', direction: 'reverse' }),
      encounter({ sectionId: 'sec-64', direction: 'reverse' }),
    ]);

    expect(both.hasBothDirections).toBe(true);
    expect(one.hasBothDirections).toBe(false);
  });

  it('collapses a repeated direction into the same group rather than dropping it', () => {
    const groups = groupSectionEncounters([
      encounter({ sectionId: 'sec-63', direction: 'same', lapTime: 100 }),
      encounter({ sectionId: 'sec-63', direction: 'same', lapTime: 110 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].encounters.map((e) => e.lapTime)).toEqual([100, 110]);
    expect(groups[0].hasBothDirections).toBe(false);
  });
});
