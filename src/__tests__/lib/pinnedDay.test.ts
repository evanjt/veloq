/**
 * Scenario: a card pins a day with no wellness row.
 * Expected behaviour: the readout is empty for that day, never the newest
 * day's or the last scrub's values.
 */
import { displayedDay } from '@/features/fitness/lib/pinnedDay';

const newest = { date: '2026-03-04', fitness: 60 };
const scrubbed = { date: '2026-03-02', fitness: 41 };

describe('displayedDay', () => {
  it('shows the newest day when nothing is pinned or scrubbed', () => {
    expect(displayedDay({ selectedDate: null, isActive: false, selected: null, newest })).toBe(
      newest
    );
  });

  it('shows the pinned day when it has a row', () => {
    expect(
      displayedDay({ selectedDate: scrubbed.date, isActive: false, selected: scrubbed, newest })
    ).toBe(scrubbed);
  });

  it('shows nothing for a pinned day with no row', () => {
    expect(
      displayedDay({ selectedDate: '2026-03-03', isActive: false, selected: null, newest })
    ).toBeNull();
  });

  it('falls back to the newest day while a scrub has not reported yet', () => {
    expect(
      displayedDay({ selectedDate: '2026-03-03', isActive: true, selected: null, newest })
    ).toBe(newest);
  });
});
