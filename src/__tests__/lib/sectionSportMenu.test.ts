/**
 * Scenario: a section taken in several sports.
 *
 * Expected behaviour: the sport menu lists every offered sport, the most
 * traversed first.
 */

import { sportMenuOptions, sportCountFor } from '@/features/routes/lib/sectionSport';

describe('sportMenuOptions', () => {
  it('lists the sports by count, the most traversed first', () => {
    expect(
      sportMenuOptions([
        { sportType: 'Walk', count: 2 },
        { sportType: 'Ride', count: 6 },
        { sportType: 'Hike', count: 3 },
      ])
    ).toEqual([
      { type: 'Ride', count: 6 },
      { type: 'Hike', count: 3 },
      { type: 'Walk', count: 2 },
    ]);
  });

  it('keeps the engine order between sports with the same count', () => {
    expect(
      sportMenuOptions([
        { sportType: 'Run', count: 3 },
        { sportType: 'Hike', count: 3 },
        { sportType: 'Walk', count: 3 },
      ]).map((o) => o.type)
    ).toEqual(['Run', 'Hike', 'Walk']);
  });

  it('offers none when the screen read offers no sport', () => {
    expect(sportMenuOptions([])).toEqual([]);
  });
});

describe('sportCountFor', () => {
  const counts = [
    { sportType: 'Run', count: 28 },
    { sportType: 'Ride', count: 3 },
  ];

  it('is the count the dropdown shows for the sport on screen', () => {
    expect(sportCountFor(counts, 'Run')).toBe(28);
    expect(sportCountFor(counts, 'Ride')).toBe(3);
  });

  it('is absent for a sport the page does not offer, and with no sport', () => {
    expect(sportCountFor(counts, 'Walk')).toBeUndefined();
    expect(sportCountFor(counts, undefined)).toBeUndefined();
    expect(sportCountFor([], 'Run')).toBeUndefined();
  });
});
