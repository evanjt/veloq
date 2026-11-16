// The sections page without a screen: its sort, search, filters, selection and
// retired view as the address, the engine's list read as rows, and the retired
// read as rows with what took each one's ground. The engine orders, filters and
// counts; this only says which question to ask and how to read the answer. Pure,
// so a test drives it without a browser.

import {
  CHIPS,
  SECTION_SORTS,
  opening,
  pageOpening,
  queryFor,
  type Chip,
  type Query,
} from './routesList';
import { queryValue, type Route } from './router';
import type { Methods } from './schema';

export type Screen = Methods['routes.screen']['result'];
export type Retired = Methods['sections.retired']['result'];

export type SectionsView = {
  sort: string;
  search: string;
  chips: Chip[];
  selected: string | null;
  /** The retired list in place of the sections. */
  retired: boolean;
};

const OPEN = opening('sections');

export const OPENING: SectionsView = {
  sort: OPEN.sort,
  search: '',
  chips: [],
  selected: null,
  retired: false,
};

/** The view an address names; an unknown sort or chip is left out. */
export function viewOf(route: Route): SectionsView {
  const sort = queryValue(route, 'ssort');
  const named = (queryValue(route, 'chips') ?? '').split(',');
  return {
    sort:
      sort !== null && (SECTION_SORTS as readonly string[]).includes(sort) ? sort : OPENING.sort,
    search: queryValue(route, 'sq') ?? '',
    chips: CHIPS.filter((chip) => named.includes(chip)),
    selected: queryValue(route, 'selected'),
    retired: queryValue(route, 'view') === 'retired',
  };
}

/** The address of a view; a value at its default is not written. */
export function routeOf(view: SectionsView): Route {
  const query: [string, string][] = [];
  if (view.sort !== OPENING.sort) query.push(['ssort', view.sort]);
  if (view.search !== '') query.push(['sq', view.search]);
  if (view.chips.length > 0) {
    query.push(['chips', CHIPS.filter((chip) => view.chips.includes(chip)).join(',')]);
  }
  if (view.selected) query.push(['selected', view.selected]);
  if (view.retired) query.push(['view', 'retired']);
  return { screen: 'sections', id: null, query };
}

/** The ask for the engine's lists read, with the sections' own sort, search and chips. */
export function queryOf(view: SectionsView): Query {
  const page = pageOpening();
  return queryFor({
    ...page,
    sections: { ...page.sections, sort: view.sort, search: view.search, chips: view.chips },
  });
}

export type Status = 'custom' | 'removed' | 'lift' | 'record';

export type ListRow = {
  id: string;
  name: string | null;
  distance: number;
  grade: number | null;
  passes: number;
  /** Faster (positive) or slower (negative) in the section's main sport, as the engine reports it. */
  trend: number | null;
  status: Status[];
};

/** The statuses the engine reports of a section; a record is on the list's rows only. */
export function statusOf(row: {
  isUserDefined: boolean;
  disabled: boolean;
  isLift: boolean;
  latestIsRecord?: boolean;
}): Status[] {
  return [
    ...(row.isUserDefined ? (['custom'] as const) : []),
    ...(row.disabled ? (['removed'] as const) : []),
    ...(row.isLift ? (['lift'] as const) : []),
    ...(row.latestIsRecord ? (['record'] as const) : []),
  ];
}

/** The list's rows in the engine's order. */
export function listRows(screen: Pick<Screen, 'sections'> | null): ListRow[] {
  return (screen?.sections ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    distance: row.distanceMeters,
    grade: row.avgGradePercent,
    passes: row.visitCount,
    trend: row.trend,
    status: statusOf(row),
  }));
}

export type RetiredRow = {
  id: string;
  name: string | null;
  kind: string;
  /** The day it left, `YYYY-MM-DD`. */
  date: string;
  distance: number | null;
  passes: number | null;
  tookGround: { id: string; name: string | null; overlap: number | null }[];
  restorable: boolean;
};

/** The retired sections, each with the current sections that took its ground. */
export function retiredRows(data: Retired | null): RetiredRow[] {
  if (!data) return [];
  const names = new Map(data.current.map((row) => [row.id, row.name]));
  return data.retired.map(({ section }) => ({
    id: section.sectionId,
    name: section.name,
    kind: section.kind,
    date: section.at.slice(0, 10),
    distance: section.distanceMeters,
    passes: section.visitCount,
    tookGround: data.pairs
      .filter((pair) => pair.retiredId === section.sectionId)
      .map((pair) => ({
        id: pair.currentId,
        name: names.get(pair.currentId) ?? null,
        overlap: pair.overlap,
      })),
    restorable: section.restorableVersion !== null,
  }));
}
