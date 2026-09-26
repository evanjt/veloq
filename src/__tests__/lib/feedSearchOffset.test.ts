/**
 * Scenario: the feed opens scrolled down by a constant 78 dp to hide its search
 * bar. The header is a search bar and a chip row, so a token change, a longer
 * translation or a larger font scale makes it taller, and the constant then
 * scrolls real content out of view instead of the search bar.
 *
 * Expected behaviour: the header's measured height corrects the offset once per
 * mount, and only while nothing is filtering.
 */

import {
  ESTIMATED_SEARCH_SECTION_HEIGHT,
  searchOffsetCorrection,
} from '@/features/activity/lib/feedSearchOffset';

const applied = ESTIMATED_SEARCH_SECTION_HEIGHT;

describe('searchOffsetCorrection', () => {
  it('corrects to the measured height when the header is taller than the estimate', () => {
    expect(
      searchOffsetCorrection({ measured: 104, applied, filtering: false, corrected: false })
    ).toBe(104);
  });

  it('corrects to the measured height when the header is shorter', () => {
    expect(
      searchOffsetCorrection({ measured: 62, applied, filtering: false, corrected: false })
    ).toBe(62);
  });

  it('leaves the list alone when the estimate was right', () => {
    expect(
      searchOffsetCorrection({ measured: 78.2, applied, filtering: false, corrected: false })
    ).toBeNull();
  });

  it('corrects once per mount', () => {
    expect(
      searchOffsetCorrection({ measured: 104, applied, filtering: false, corrected: true })
    ).toBeNull();
  });

  it('leaves the header on screen while a search or a chip is active', () => {
    expect(
      searchOffsetCorrection({ measured: 104, applied, filtering: true, corrected: false })
    ).toBeNull();
  });

  it('ignores a header that has not been laid out yet', () => {
    for (const measured of [0, -1, Number.NaN]) {
      expect(
        searchOffsetCorrection({ measured, applied, filtering: false, corrected: false })
      ).toBeNull();
    }
  });
});
