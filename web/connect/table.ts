// The feed as a table: its columns, the sort over the rows held, the range
// presets, and the feed's state in the hash query. Pure, so a test drives it
// without a browser.

import type { ParseKeys } from 'i18next';

import type { Route } from './router';
import { readIds, writeIds } from './compare';
import type { Card } from './session';
import type { SportFamily } from './link';

export type Row = Card;

export type ColumnKey =
  'date' | 'name' | 'sport' | 'distance' | 'time' | 'climb' | 'load' | 'hr' | 'power';

type Value = string | number | null | undefined;

export const COLUMNS: {
  key: ColumnKey;
  label: ParseKeys;
  numeric: boolean;
  value: (row: Row) => Value;
}[] = [
  {
    key: 'date',
    label: 'connectPage.columns.date',
    numeric: false,
    value: (r) => r.startDateLocal,
  },
  { key: 'name', label: 'connectPage.columns.name', numeric: false, value: (r) => r.name },
  { key: 'sport', label: 'connectPage.columns.sport', numeric: false, value: (r) => r.sportType },
  {
    key: 'distance',
    label: 'connectPage.columns.distance',
    numeric: true,
    value: (r) => r.distance,
  },
  { key: 'time', label: 'connectPage.columns.time', numeric: true, value: (r) => r.movingTime },
  {
    key: 'climb',
    label: 'connectPage.columns.climb',
    numeric: true,
    value: (r) => r.elevationGain,
  },
  { key: 'load', label: 'connectPage.columns.load', numeric: true, value: (r) => r.trainingLoad },
  { key: 'hr', label: 'connectPage.columns.hr', numeric: true, value: (r) => r.avgHr },
  { key: 'power', label: 'connectPage.columns.power', numeric: true, value: (r) => r.avgPower },
];

export type Sort = { column: ColumnKey; dir: 'asc' | 'desc' };

const missing = (value: Value) => value == null || value === '';

/**
 * The rows in the sort's order. A row with no value in the column stays last
 * in either direction. The sort is stable and leaves the input alone; with no
 * sort the rows keep the order the phone sent them in.
 */
export function sortRows<R extends Row>(rows: readonly R[], sort: Sort | null): R[] {
  if (!sort) return [...rows];
  const column = COLUMNS.find((c) => c.key === sort.column);
  if (!column) return [...rows];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, at) => ({ row, at, value: column.value(row) }))
    .sort((a, b) => {
      const gone = Number(missing(a.value)) - Number(missing(b.value));
      if (gone !== 0) return gone;
      if (missing(a.value)) return a.at - b.at;
      const order =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value), undefined, { sensitivity: 'base' });
      return order !== 0 ? sign * order : a.at - b.at;
    })
    .map((entry) => entry.row);
}

export const RANGES = ['last90Days', 'thisYear', 'lastYear'] as const;
export type RangePreset = (typeof RANGES)[number];

/** The key of each preset's chip. */
export const RANGE_LABELS: Record<RangePreset, ParseKeys> = {
  last90Days: 'connectPage.ranges.last90Days',
  thisYear: 'connectPage.ranges.thisYear',
  lastYear: 'connectPage.ranges.lastYear',
};

/**
 * The span a preset names as of `today`, in the epoch seconds the phone's feed
 * read takes: whole local days, both ends inclusive. No preset is no bound.
 */
export function rangeBounds(
  preset: RangePreset | null,
  today: Date
): { oldestTs: number | null; newestTs: number | null } {
  if (!preset) return { oldestTs: null, newestTs: null };
  const year = today.getFullYear();
  const start = (y: number, m: number, d: number) => new Date(y, m, d).getTime() / 1000;
  const end = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 59).getTime() / 1000;
  const todayEnd = end(year, today.getMonth(), today.getDate());
  switch (preset) {
    case 'last90Days':
      return {
        oldestTs: start(year, today.getMonth(), today.getDate() - 89),
        newestTs: todayEnd,
      };
    case 'thisYear':
      return { oldestTs: start(year, 0, 1), newestTs: todayEnd };
    default:
      return { oldestTs: start(year - 1, 0, 1), newestTs: end(year - 1, 11, 31) };
  }
}

export type FeedQuery = {
  range: RangePreset | null;
  families: SportFamily[];
  sort: Sort | null;
  id: string | null;
  /** The rows being compared; two to four, or none. */
  ids: string[];
};

const FAMILY_KEYS: readonly string[] = [
  'ride',
  'run',
  'winter',
  'water',
  'foot',
  'strength',
  'other',
];

/** The feed's state as hash query pairs; a default is not written. */
export function feedQuery(state: FeedQuery): [string, string][] {
  const query: [string, string][] = [];
  if (state.range) query.push(['range', state.range]);
  if (state.families.length) query.push(['sport', state.families.join(',')]);
  if (state.sort) query.push(['sort', `${state.sort.column}:${state.sort.dir}`]);
  if (state.id) query.push(['id', state.id]);
  const ids = writeIds(state.ids);
  if (ids) query.push(['ids', ids]);
  return query;
}

/** The feed's state in a route's query; anything unknown reads as the default. */
export function readFeedQuery(route: Route): FeedQuery {
  const get = (key: string) => route.query.find(([name]) => name === key)?.[1] ?? null;
  const range = get('range');
  const [column, dir] = (get('sort') ?? '').split(':');
  const known = COLUMNS.some((c) => c.key === column);
  return {
    range: RANGES.find((r) => r === range) ?? null,
    families: (get('sport') ?? '')
      .split(',')
      .filter((f): f is SportFamily => FAMILY_KEYS.includes(f)),
    sort: known && (dir === 'asc' || dir === 'desc') ? { column: column as ColumnKey, dir } : null,
    id: get('id'),
    ids: (() => {
      const ids = readIds(get('ids'));
      return ids.length >= 2 ? ids : [];
    })(),
  };
}

/**
 * The id selected after a step through the loaded rows. It stops at either
 * end; with nothing selected, or a row no longer loaded, it lands on the first.
 */
export function selectionAfter(
  ids: readonly string[],
  current: string | null,
  step: 'next' | 'previous'
): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return ids[0] ?? null;
  const to = Math.min(ids.length - 1, Math.max(0, at + (step === 'next' ? 1 : -1)));
  return ids[to] ?? null;
}
