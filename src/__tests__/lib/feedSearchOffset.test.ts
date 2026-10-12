/**
 * Scenario: the feed opens scrolled down by a constant to hide its chip row. A
 * token change, a longer translation or a larger font scale makes the row
 * taller, and the constant then scrolls real content out of view instead of
 * the chips.
 *
 * Expected behaviour: the section's measured height corrects the offset once
 * per mount, and only while nothing is filtering.
 */

import {
  ESTIMATED_FILTER_SECTION_HEIGHT,
  searchOffsetCorrection,
} from '@/features/activity/lib/feedSearchOffset';

const applied = ESTIMATED_FILTER_SECTION_HEIGHT;

describe('searchOffsetCorrection', () => {
  it('corrects to the measured height when the section is taller than the estimate', () => {
    expect(
      searchOffsetCorrection({ measured: 104, applied, filtering: false, corrected: false })
    ).toBe(104);
  });

  it('corrects to the measured height when the section is shorter', () => {
    expect(
      searchOffsetCorrection({ measured: 30, applied, filtering: false, corrected: false })
    ).toBe(30);
  });

  it('leaves the list alone when the estimate was right', () => {
    expect(
      searchOffsetCorrection({
        measured: applied + 0.2,
        applied,
        filtering: false,
        corrected: false,
      })
    ).toBeNull();
  });

  it('corrects once per mount', () => {
    expect(
      searchOffsetCorrection({ measured: 104, applied, filtering: false, corrected: true })
    ).toBeNull();
  });

  it('leaves the section on screen while a search or a chip is active', () => {
    expect(
      searchOffsetCorrection({ measured: 104, applied, filtering: true, corrected: false })
    ).toBeNull();
  });

  it('ignores a section that has not been laid out yet', () => {
    for (const measured of [0, -1, Number.NaN]) {
      expect(
        searchOffsetCorrection({ measured, applied, filtering: false, corrected: false })
      ).toBeNull();
    }
  });
});
