// The order of a table kept in the address: one query key per table, written
// only when it differs from the table's default, and the rows ordered by it. No
// browser API, so a test drives it.

import { formatOrder, parseOrder, withQuery, type Ordering, type Route } from './router';
import { queryValue } from './router';

export type { Ordering };

/** The query key a table's order is written under. */
export const orderKey = (tableId: string) => `sort-${tableId}`;

/** The order a route holds for a table; an unknown column or direction is the fallback. */
export function readTableOrder<C extends string>(
  route: Route,
  tableId: string,
  columns: readonly C[],
  fallback: Ordering<C>
): Ordering<C> {
  return parseOrder(queryValue(route, orderKey(tableId)), columns, fallback);
}

/** The route with a table's order written; the default is removed, every other key is kept. */
export function writeTableOrder<C extends string>(
  route: Route,
  tableId: string,
  order: Ordering<C>,
  fallback: Ordering<C>
): Route {
  return withQuery(route, { [orderKey(tableId)]: formatOrder(order, fallback) });
}

/** The order a click on a column head asks for: the other way on the same column, else its own first way. */
export function nextOrder<C extends string>(
  current: Ordering<C>,
  column: C,
  firstDescending: boolean
): Ordering<C> {
  return current.column === column
    ? { column, descending: !current.descending }
    : { column, descending: firstDescending };
}

export type OrderValue = number | string | null | undefined;

/**
 * The rows in an order. A row with no value in the column stays last in either
 * direction; equal rows keep the order they came in.
 */
export function orderRows<R, C extends string>(
  rows: readonly R[],
  order: Ordering<C>,
  value: (row: R, column: C) => OrderValue
): R[] {
  const sign = order.descending ? -1 : 1;
  const gone = (v: OrderValue) => v === null || v === undefined || v === '';
  return rows
    .map((row, at) => ({ row, at, v: value(row, order.column) }))
    .sort((a, b) => {
      if (gone(a.v) || gone(b.v)) {
        return gone(a.v) && gone(b.v) ? a.at - b.at : gone(a.v) ? 1 : -1;
      }
      const diff =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v), undefined, { sensitivity: 'base' });
      return diff !== 0 ? sign * diff : a.at - b.at;
    })
    .map(({ row }) => row);
}

/** An order as the table's own sort prop. */
export const sortProp = <C extends string>(order: Ordering<C>) => ({
  key: order.column,
  direction: order.descending ? ('desc' as const) : ('asc' as const),
});
