// The routes and sections pages without a screen: the list's sort, search and
// chips as the engine's query and as the address, and the pass table's order.
// Pure, so a test drives it without a browser. The engine orders and filters
// the list; this only says which question to ask it.

import { readIds, writeIds } from './compare';
import { queryValue, type Route } from './router';
import type { Methods } from './schema';
import { FILTER_KEY } from './ui/filterText';

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
  /** The passes the athlete selected to compare, in selection order; fewer than two is none. */
  ids: string[];
};

/** Rows asked of each list at a time. */
export const PAGE_SIZE = 50;

const defaultSort = (kind: Kind) => (kind === 'routes' ? ROUTE_SORTS[0] : SECTION_SORTS[0]);

/** The list as it opens: the phone's first order, nothing searched, no chip on. */
export function opening(kind: Kind, selected: string | null = null): ListState {
  return { kind, sort: defaultSort(kind), search: '', chips: [], selected, ids: [] };
}

const isSort = (kind: Kind, sort: string) =>
  (kind === 'routes' ? (ROUTE_SORTS as readonly string[]) : SECTION_SORTS).includes(sort);

/** Both lists as the page draws them, and the one the detail pane follows. */
export type PageState = {
  routes: ListState;
  sections: ListState;
  focus: Kind;
  /** The detail pane's pass table order as its query value, or null for the default. */
  order: string | null;
};

/** The page as it opens: both lists at their opening state, the routes list in focus. */
export function pageOpening(): PageState {
  return { routes: opening('routes'), sections: opening('sections'), focus: 'routes', order: null };
}

/**
 * The ask for the lists screen read. Both lists come in one read, so each
 * list's own sort, search and chips go in it. `nearby` needs a place, which
 * the page does not have, so it is asked of the engine without one.
 */
export function queryFor(page: PageState): Query {
  const { routes, sections } = page;
  return {
    groupLimit: PAGE_SIZE,
    groupOffset: 0,
    sectionLimit: PAGE_SIZE,
    sectionOffset: 0,
    minGroupActivityCount: 0,
    groupSort: routes.sort as RouteSort,
    groupSearch: routes.search,
    sectionSort: sections.sort as SectionSort,
    sectionSearch: sections.search,
    sectionFilters: {
      hideCustom: false,
      hideAuto: sections.chips.includes('custom'),
      hideDisabled: !sections.chips.includes('removed'),
      hideUnaccepted: sections.chips.includes('accepted'),
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
 * The address for the page: `#/routes` or `#/sections` with each list's sort,
 * search and chips in the query. The text of the list in focus is the page's filter, `q`; the
 * other list keeps its text under `rq` or `sq` while it is out of focus. The list in focus names its selected row in
 * the path (`#/route/<id>`, `#/section/<id>`); the other list's selection is
 * the `route` or `section` query value. A value at its default is left out.
 */
export function toRoute(page: PageState): Route {
  const { routes, sections, focus } = page;
  const query: [string, string][] = [];
  if (routes.sort !== defaultSort('routes')) query.push(['rsort', routes.sort]);
  if (routes.search !== '') query.push([focus === 'routes' ? FILTER_KEY : 'rq', routes.search]);
  if (sections.sort !== defaultSort('sections')) query.push(['ssort', sections.sort]);
  if (sections.search !== '') {
    query.push([focus === 'sections' ? FILTER_KEY : 'sq', sections.search]);
  }
  if (sections.chips.length > 0) {
    query.push(['chips', CHIPS.filter((chip) => sections.chips.includes(chip)).join(',')]);
  }
  if (page.order) query.push(['psort', page.order]);
  const focused = page[focus];
  const ids = writeIds(focused.ids);
  if (ids) query.push(['ids', ids]);
  const other = focus === 'routes' ? sections : routes;
  if (other.selected) query.push([other.kind === 'routes' ? 'route' : 'section', other.selected]);
  if (focused.selected) {
    return { screen: focus === 'routes' ? 'route' : 'section', id: focused.selected, query };
  }
  return { screen: focus, id: null, query };
}

/** The page an address names, or null when it names neither list. */
export function fromRoute(route: Route): PageState | null {
  const focus: Kind | null =
    route.screen === 'routes' || route.screen === 'route'
      ? 'routes'
      : route.screen === 'sections' || route.screen === 'section'
        ? 'sections'
        : null;
  if (!focus) return null;
  const value = (key: string) => queryValue(route, key);
  const sortOf = (kind: Kind, key: string) => {
    const sort = value(key);
    return sort !== null && isSort(kind, sort) ? sort : defaultSort(kind);
  };
  const named = (value('chips') ?? '').split(',');
  const ids = readIds(value('ids'));
  const selected = (kind: Kind) =>
    kind === focus ? route.id : value(kind === 'routes' ? 'route' : 'section');
  return {
    focus,
    order: value('psort'),
    routes: {
      kind: 'routes',
      sort: sortOf('routes', 'rsort'),
      search: value(focus === 'routes' ? FILTER_KEY : 'rq') ?? '',
      chips: [],
      selected: selected('routes'),
      ids: focus === 'routes' && ids.length >= 2 ? ids : [],
    },
    sections: {
      kind: 'sections',
      sort: sortOf('sections', 'ssort'),
      search: value(focus === 'sections' ? FILTER_KEY : 'sq') ?? '',
      chips: CHIPS.filter((chip) => named.includes(chip)),
      selected: selected('sections'),
      ids: focus === 'sections' && ids.length >= 2 ? ids : [],
    },
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
