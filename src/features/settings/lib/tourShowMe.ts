import type { WhatsNewSlideDefinition } from '../components/whatsNew/slides';

export const SECTIONS_LIST_ROUTE = '/insights?tab=sections';
export const ROUTES_LIST_ROUTE = '/insights?tab=routes';

/** Fewest visits for a section or route to be worth opening: one attempt compares with nothing. */
export const SHOW_ME_MIN_VISITS = 2;

/** What the library holds, as far as a tour Show Me needs to know. */
export interface TourLibrary {
  /** Whether the library holds at least one activity. */
  hasActivities: boolean;
  /** The athlete's section with the most visits, as the routes screen reads rank them. */
  sectionId?: string;
  /** The athlete's route with the most activities. */
  routeId?: string;
  /** Whether a finished section re-analysis left changes to preview. */
  cutoverChanged: boolean;
  /** Whether the athlete's intervals.icu uses Garmin. */
  usesGarmin: boolean;
}

/**
 * Where a slide's Show Me goes, or undefined when the slide offers none. A slide offers Show Me
 * only once the screen it lands on holds something to try, so a tour opened over an empty or
 * still-loading library never lands on an empty screen. The sections and routes slides open the
 * athlete's own section or route with the most visits, so the page the slide describes is one with
 * attempts to compare, and offer nothing while there is none.
 */
export function resolveShowMeRoute(
  slide: WhatsNewSlideDefinition,
  library: TourLibrary
): string | undefined {
  if (slide.showMeRoute === undefined) return undefined;
  if (slide.showMeWhen === 'hasActivities' && !library.hasActivities) return undefined;
  if (slide.showMeWhen === 'cutoverChanged' && !library.cutoverChanged) return undefined;
  if (slide.showMeWhen === 'usesGarmin' && !library.usesGarmin) return undefined;
  if (slide.showMeAction === 'openBusiestSection') {
    return library.sectionId ? `/section/${library.sectionId}` : undefined;
  }
  if (slide.showMeAction === 'openBusiestRoute') {
    return library.routeId ? `/route/${library.routeId}` : undefined;
  }
  return slide.showMeRoute;
}
