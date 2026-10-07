/**
 * Scenario: one loop, ridden four times and walked once. It is one route, and
 * it belongs to both sports.
 *
 * Expected behaviour: the group answers for every sport that has traversed it,
 * not only for the one its representative happens to carry.
 */

import { groupCoversType } from '@/features/routes/lib/routeSportMembership';

describe('groupCoversType', () => {
  it('answers for a sport the representative does not carry', () => {
    const mixed = { sportTypes: ['Ride', 'Walk'] };

    expect(groupCoversType(mixed, 'Walk')).toBe(true);
    expect(groupCoversType(mixed, 'Ride')).toBe(true);
  });

  it('does not claim a sport nothing traversed it in', () => {
    const mixed = { sportTypes: ['Ride', 'Walk'] };

    expect(groupCoversType(mixed, 'Swim')).toBe(false);
  });

  it('does not invent a sport for an empty set', () => {
    const group = { sportTypes: [], sportType: 'Run' };
    expect(groupCoversType(group, 'Run')).toBe(false);
  });
});
