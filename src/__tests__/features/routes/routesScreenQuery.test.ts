/**
 * Scenario: the routes screen holds a sort chip, a search box and four hide
 * toggles, and the engine pages the catalogue.
 *
 * Expected behaviour: every one of those reaches the engine as part of the
 * query, so the order, the search and the filters run over the library rather
 * than over the fifty rows already loaded.
 */
import { GroupSort, SectionSort } from 'veloqrs';
import {
  groupSortFor,
  sectionSortFor,
  sectionFiltersFor,
  sectionCountsOf,
  DEFAULT_SECTION_HIDE_FLAGS,
  type RoutesSortOption,
  type SectionsSortOption,
} from '@/features/routes/lib/routesScreenQuery';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

describe('routesScreenQuery', () => {
  it('maps every routes order the screen offers', () => {
    const expected: Record<RoutesSortOption, GroupSort> = {
      nearby: GroupSort.Nearby,
      activities: GroupSort.Activities,
      distance: GroupSort.Distance,
      name: GroupSort.Name,
    };

    for (const [option, sort] of Object.entries(expected)) {
      expect(groupSortFor(option as RoutesSortOption)).toBe(sort);
    }
  });

  it('maps every sections order the screen offers', () => {
    const expected: Record<SectionsSortOption, SectionSort> = {
      nearby: SectionSort.Nearby,
      signature: SectionSort.Signature,
      visits: SectionSort.Visits,
      distance: SectionSort.Distance,
      name: SectionSort.Name,
    };

    for (const [option, sort] of Object.entries(expected)) {
      expect(sectionSortFor(option as SectionsSortOption)).toBe(sort);
    }
  });

  it('carries all four hide flags, not just the ones the default sets', () => {
    expect(
      sectionFiltersFor({ custom: true, auto: false, disabled: true, unaccepted: true })
    ).toEqual({
      hideCustom: true,
      hideAuto: false,
      hideDisabled: true,
      hideUnaccepted: true,
    });
  });

  it('hides retired sections by default and nothing else', () => {
    expect(sectionFiltersFor(DEFAULT_SECTION_HIDE_FLAGS)).toEqual({
      hideCustom: false,
      hideAuto: false,
      hideDisabled: true,
      hideUnaccepted: false,
    });
  });

  describe('sectionCountsOf', () => {
    it('reads every count from the engine page, so a sport filter narrows the header and the Custom chip', () => {
      expect(
        sectionCountsOf({ sectionCount: 40, filteredSectionCount: 12, customCount: 2 })
      ).toEqual({ total: 40, shown: 12, custom: 2 });
    });

    it('shows the whole catalogue when the page has no filtered count', () => {
      expect(sectionCountsOf({ sectionCount: 40, customCount: 5 })).toEqual({
        total: 40,
        shown: 40,
        custom: 5,
      });
    });

    it('is zero before the first page has been read', () => {
      expect(sectionCountsOf(undefined)).toEqual({ total: 0, shown: 0, custom: 0 });
    });
  });
});
