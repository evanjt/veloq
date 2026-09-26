/**
 * The routes screen's own state, as the query the engine answers.
 *
 * The sort, the search term and the four hide flags belong to Rust. Applied
 * after the page they order and count fifty rows and call that the library. A
 * sort replaces the nearest-first order rather than refining it, so `nearby` is
 * itself one of the modes here.
 */
import { GroupSort, SectionSort, type SectionHiddenFilters } from 'veloqrs';
import type { SectionsSortOption } from './sectionRanking';

/** The orders the routes list offers. `nearby` needs a user location. */
export type RoutesSortOption = 'activities' | 'distance' | 'name' | 'nearby';

/** Which kinds of section the list is hiding, as the filter bar holds them. */
export interface SectionHideFlags {
  custom: boolean;
  auto: boolean;
  disabled: boolean;
  unaccepted: boolean;
}

export const DEFAULT_SECTION_HIDE_FLAGS: SectionHideFlags = {
  custom: false,
  auto: false,
  disabled: true,
  unaccepted: false,
};

export function groupSortFor(option: RoutesSortOption): GroupSort {
  switch (option) {
    case 'nearby':
      return GroupSort.Nearby;
    case 'distance':
      return GroupSort.Distance;
    case 'name':
      return GroupSort.Name;
    default:
      return GroupSort.Activities;
  }
}

export function sectionSortFor(option: SectionsSortOption): SectionSort {
  switch (option) {
    case 'nearby':
      return SectionSort.Nearby;
    case 'signature':
      return SectionSort.Signature;
    case 'distance':
      return SectionSort.Distance;
    case 'name':
      return SectionSort.Name;
    default:
      return SectionSort.Visits;
  }
}

export function sectionFiltersFor(hidden: SectionHideFlags): SectionHiddenFilters {
  return {
    hideCustom: hidden.custom,
    hideAuto: hidden.auto,
    hideDisabled: hidden.disabled,
    hideUnaccepted: hidden.unaccepted,
  };
}
