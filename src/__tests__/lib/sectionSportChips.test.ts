/**
 * Scenario: a six-month range holds only runs on the section.
 *
 * Expected behaviour: one chip is shown for that sport and the chart is
 * scoped to it. With no sport offered by the screen read, no chip is shown
 * and nothing is scoped.
 */

import { shouldShowSportChips, sportChipOptions } from '@/features/routes/lib/sectionSport';

describe('shouldShowSportChips', () => {
  it('shows a chip when the range holds one sport', () => {
    expect(shouldShowSportChips([{ sportType: 'Run' }])).toBe(true);
  });

  it('shows the chips when the range holds several sports', () => {
    expect(shouldShowSportChips([{ sportType: 'Run' }, { sportType: 'Ride' }])).toBe(true);
  });

  it('shows none when the screen read offers no sport', () => {
    expect(shouldShowSportChips([])).toBe(false);
  });
});

describe('sportChipOptions', () => {
  it('offers one chip per sport with its count, in the engine order', () => {
    expect(
      sportChipOptions([
        { sportType: 'Run', count: 6 },
        { sportType: 'Hike', count: 3 },
        { sportType: 'Walk', count: 2 },
      ])
    ).toEqual([
      { type: 'Run', count: 6 },
      { type: 'Hike', count: 3 },
      { type: 'Walk', count: 2 },
    ]);
  });

  it('offers none when the screen read offers no sport', () => {
    expect(sportChipOptions([])).toEqual([]);
  });
});
