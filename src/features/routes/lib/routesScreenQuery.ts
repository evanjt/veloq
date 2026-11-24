/**
 * The routes screen's own state, as the query the engine answers.
 *
 * The sort, the search term and the four hide flags belong to Rust. Applied
 * after the page they order and count fifty rows and call that the library. A
 * sort replaces the nearest-first order rather than refining it, so `nearby` is
 * itself one of the modes here.
 */
import { FfiGroupSort, FfiSectionSort, type SectionHiddenFilters } from 'veloqrs';

/** The orders the sections list offers. `nearby` is ranked in Rust. */
export type SectionsSortOption = 'signature' | 'visits' | 'distance' | 'name' | 'nearby';

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

/** Whether the flags hide a kind of section the default shows, which narrows the list. */
export function hidesBeyondDefault(hidden: SectionHideFlags): boolean {
  return (Object.keys(DEFAULT_SECTION_HIDE_FLAGS) as (keyof SectionHideFlags)[]).some(
    (kind) => hidden[kind] && !DEFAULT_SECTION_HIDE_FLAGS[kind]
  );
}

export function groupSortFor(option: RoutesSortOption): FfiGroupSort {
  switch (option) {
    case 'nearby':
      return FfiGroupSort.Nearby;
    case 'distance':
      return FfiGroupSort.Distance;
    case 'name':
      return FfiGroupSort.Name;
    default:
      return FfiGroupSort.Activities;
  }
}

export function sectionSortFor(option: SectionsSortOption): FfiSectionSort {
  switch (option) {
    case 'nearby':
      return FfiSectionSort.Nearby;
    case 'signature':
      return FfiSectionSort.Signature;
    case 'distance':
      return FfiSectionSort.Distance;
    case 'name':
      return FfiSectionSort.Name;
    default:
      return FfiSectionSort.Visits;
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

interface SectionCounts {
  total: number;
  shown: number;
  custom: number;
}

/**
 * The engine counts the catalogue, narrows it to the chosen sport and counts
 * the custom sections of what is left, so the header and the Custom chip read
 * those counts as they are.
 */
export function sectionCountsOf(
  page:
    { sectionCount: number; filteredSectionCount?: number; customCount: number } | null | undefined
): SectionCounts {
  const total = page?.sectionCount ?? 0;
  return { total, shown: page?.filteredSectionCount ?? total, custom: page?.customCount ?? 0 };
}
