import type { WhatsNewSlideDefinition } from '../components/whatsNew/slides';

export const SECTIONS_LIST_ROUTE = '/insights?tab=sections';
export const ROUTES_LIST_ROUTE = '/insights?tab=routes';

/** Fewest visits for a section or route to be worth opening: one attempt compares with nothing. */
export const SHOW_ME_MIN_VISITS = 2;

/** The athlete's section and route with the most visits, as the routes screen reads rank them. */
export interface BusiestPlaces {
  sectionId?: string;
  routeId?: string;
}

/**
 * Where a slide's Show Me goes. The sections and routes slides open the athlete's own section or
 * route with the most visits, so the page the slide describes is one with attempts to compare.
 * With none, or while the read has nothing to give, they land on the list, which shows its own
 * empty or failed state.
 */
export function resolveShowMeRoute(
  slide: WhatsNewSlideDefinition,
  busiest: BusiestPlaces
): string | undefined {
  if (slide.showMeAction === 'openBusiestSection' && busiest.sectionId) {
    return `/section/${busiest.sectionId}`;
  }
  if (slide.showMeAction === 'openBusiestRoute' && busiest.routeId) {
    return `/route/${busiest.routeId}`;
  }
  return slide.showMeRoute;
}
