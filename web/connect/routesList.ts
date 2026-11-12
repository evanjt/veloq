// The routes and sections pages without a screen: the list's sort, search and
// chips as the engine's query and as the address, and the pass table's order.
// Pure, so a test drives it without a browser. The engine orders and filters
// the list; this only says which question to ask it.

import type { Route } from './router';
import type { Methods } from './schema';

/** The ask: every field the engine's query has, bar the place `nearby` needs, which the page has none of. */
export type Query = Omit<Methods['routes.screen']['params'], 'userLat' | 'userLng'>;
export type SectionRow = Methods['section.detail']['result']['activityRows'][number];

export type Kind = 'routes' | 'sections';

/** The orders each list offers, the phone's, first being the one it opens in. */
export const ROUTE_SORTS = ['activities', 'distance', 'name', 'nearby'] as const;
export const SECTION_SORTS = ['visits', 'signature', 'distance', 'name', 'nearby'] as const;

export type RouteSort = (typeof ROUTE_SORTS)[number];
export type SectionSort = (typeof SECTION_SORTS)[number];

/**
 * The sections chips. `custom` keeps only the athlete's own sections,
 * `removed` shows the ones taken out of the list (the phone hides them), and
 * `accepted` keeps only the auto sections the athlete has accepted.
 */
export const CHIPS = ['custom', 'removed', 'accepted'] as const;
export type Chip = (typeof CHIPS)[number];

export type ListState = {
  kind: Kind;
  sort: string;
  search: string;
  chips: Chip[];
  selected: string | null;
};

/** Rows asked of each list at a time. */
export const PAGE_SIZE = 50;

const defaultSort = (kind: Kind) => (kind === 'routes' ? ROUTE_SORTS[0] : SECTION_SORTS[0]);

/** The list as it opens: the phone's first order, nothing searched, no chip on. */
export function opening(kind: Kind, selected: string | null = null): ListState {
  return { kind, sort: defaultSort(kind), search: '', chips: [], selected };
}

const isSort = (kind: Kind, sort: string) =>
  (kind === 'routes' ? (ROUTE_SORTS as readonly string[]) : SECTION_SORTS).includes(sort);

/**
 * The ask for the lists screen read. Both lists come in one read, so the
 * other list's order stays at its default. `nearby` needs a place, which the
 * page does not have, so it is asked of the engine without one.
 */
export function queryFor(state: ListState): Query {
  const sections = state.kind === 'sections';
  return {
    groupLimit: PAGE_SIZE,
    groupOffset: 0,
    sectionLimit: PAGE_SIZE,
    sectionOffset: 0,
    minGroupActivityCount: 0,
    groupSort: !sections && isSort('routes', state.sort) ? (state.sort as RouteSort) : 'activities',
    groupSearch: sections ? '' : state.search,
    sectionSort:
      sections && isSort('sections', state.sort) ? (state.sort as SectionSort) : 'visits',
    sectionSearch: sections ? state.search : '',
    sectionFilters: {
      hideCustom: false,
      hideAuto: sections && state.chips.includes('custom'),
      hideDisabled: !(sections && state.chips.includes('removed')),
      hideUnaccepted: sections && state.chips.includes('accepted'),
    },
    groupSportType: null,
    sectionSportType: null,
  };
}

/** Turn a chip on or off. */
export function toggled(state: ListState, chip: Chip): ListState {
  const chips = state.chips.includes(chip)
    ? state.chips.filter((held) => held !== chip)
    : CHIPS.filter((known) => known === chip || state.chips.includes(known));
  return { ...state, chips };
}

/**
 * The address for a list: `#/routes` or `#/sections` with the sort, the
 * search and the chips in the query, or `#/route/<id>` and `#/section/<id>`
 * when a row is selected. A value at its default is left out.
 */
export function toRoute(state: ListState): Route {
  const query: [string, string][] = [];
  if (state.sort !== defaultSort(state.kind)) query.push(['sort', state.sort]);
  if (state.search !== '') query.push(['q', state.search]);
  if (state.kind === 'sections' && state.chips.length > 0) {
    query.push(['chips', CHIPS.filter((chip) => state.chips.includes(chip)).join(',')]);
  }
  if (state.selected) {
    return { screen: state.kind === 'routes' ? 'route' : 'section', id: state.selected, query };
  }
  return { screen: state.kind, id: null, query };
}

/** The list an address names, or null when it names neither list. */
export function fromRoute(route: Route): ListState | null {
  const kind: Kind | null =
    route.screen === 'routes' || route.screen === 'route'
      ? 'routes'
      : route.screen === 'sections' || route.screen === 'section'
        ? 'sections'
        : null;
  if (!kind) return null;
  const value = (key: string) => route.query.find(([name]) => name === key)?.[1] ?? null;
  const sort = value('sort');
  const named = (value('chips') ?? '').split(',');
  return {
    kind,
    sort: sort !== null && isSort(kind, sort) ? sort : defaultSort(kind),
    search: value('q') ?? '',
    chips: kind === 'sections' ? CHIPS.filter((chip) => named.includes(chip)) : [],
    selected: route.id,
  };
}

export type PassColumn = 'date' | 'time' | 'delta';
export type PassOrder = { column: PassColumn; descending: boolean };

export type Pass = SectionRow & {
  /** Seconds slower than the fastest pass; 0 for it. */
  delta: number;
  /** The fastest pass. */
  pr: boolean;
};

/** The pass table's rows: each with its gap to the fastest pass, ordered as asked. */
export function passes(rows: readonly SectionRow[], order: PassOrder): Pass[] {
  const fastest = rows.reduce((best, row) => Math.min(best, row.movingTime), Infinity);
  const marked = rows.map((row) => ({
    ...row,
    delta: row.movingTime - fastest,
    pr: row.movingTime === fastest,
  }));
  const key = (row: Pass) => (order.column === 'date' ? row.startTime : row.movingTime);
  const sign = order.descending ? -1 : 1;
  return marked.sort((a, b) => sign * (key(a) - key(b)) || a.startTime - b.startTime);
}

/** Press a column head: a new column orders by it, the same one reverses. */
export function pressed(order: PassOrder, column: PassColumn): PassOrder {
  return order.column === column
    ? { column, descending: !order.descending }
    : { column, descending: column === 'date' };
}
