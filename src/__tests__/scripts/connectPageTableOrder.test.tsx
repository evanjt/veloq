/**
 * Scenario: a table's order is chosen by a column head and a reload finds it in
 * the hash beside the page's other query keys.
 *
 * Expected behaviour: each table keeps its own key; the default is not written;
 * other keys are kept; a row without a value stays last in both directions;
 * the months and record tables show the order the hash holds, and a head click
 * writes the next one.
 */

import { act, create } from 'react-test-renderer';

import { parse, write, type Route } from '../../../web/connect/router';
import {
  nextOrder,
  orderRows,
  readTableOrder,
  sortProp,
  writeTableOrder,
} from '../../../web/connect/tableOrder';
import { DataTable } from '../../../web/connect/ui/DataTable';
import { MonthsTable } from '../../../web/connect/pages/FitnessPane';

const COLUMNS = ['count', 'load'] as const;
const DEFAULT = { column: 'count', descending: true } as const;
const base: Route = { screen: 'fitness', id: null, query: [['sport', 'Run']] };

describe('table order in the hash', () => {
  it('restores each table order from the hash after a reload', () => {
    const written = writeTableOrder(base, 'months', { column: 'load', descending: false }, DEFAULT);
    const again = writeTableOrder(
      written,
      'efforts',
      { column: 'count', descending: false },
      DEFAULT
    );
    const route = parse(write(again));
    expect(readTableOrder(route, 'months', COLUMNS, DEFAULT)).toEqual({
      column: 'load',
      descending: false,
    });
    expect(readTableOrder(route, 'efforts', COLUMNS, DEFAULT)).toEqual({
      column: 'count',
      descending: false,
    });
    expect(route.query).toContainEqual(['sport', 'Run']);
  });

  it('leaves the default out and clears a key that returns to it', () => {
    const set = writeTableOrder(base, 'months', { column: 'load', descending: true }, DEFAULT);
    expect(set.query).toContainEqual(['sort-months', 'load:desc']);
    const cleared = writeTableOrder(set, 'months', DEFAULT, DEFAULT);
    expect(cleared.query).toEqual(base.query);
  });

  it('reads junk as the default', () => {
    const junk: Route = { ...base, query: [['sort-months', 'nope:up']] };
    expect(readTableOrder(junk, 'months', COLUMNS, DEFAULT)).toEqual(DEFAULT);
  });

  it('flips the same column and starts another in its own first direction', () => {
    expect(nextOrder(DEFAULT, 'count', false)).toEqual({ column: 'count', descending: false });
    expect(nextOrder(DEFAULT, 'load', false)).toEqual({ column: 'load', descending: false });
    expect(nextOrder(DEFAULT, 'load', true)).toEqual({ column: 'load', descending: true });
    expect(sortProp({ column: 'load', descending: true })).toEqual({
      key: 'load',
      direction: 'desc',
    });
  });

  it('keeps rows without a value last in both directions and ties in input order', () => {
    const rows = [
      { id: 'a', v: 2 },
      { id: 'b', v: null },
      { id: 'c', v: 2 },
      { id: 'd', v: 5 },
    ];
    const value = (row: (typeof rows)[number]) => row.v;
    const asc = orderRows(rows, { column: 'v', descending: false }, value).map((r) => r.id);
    const desc = orderRows(rows, { column: 'v', descending: true }, value).map((r) => r.id);
    expect(asc).toEqual(['a', 'c', 'd', 'b']);
    expect(desc).toEqual(['d', 'a', 'c', 'b']);
  });
});

describe('months table', () => {
  const months = [
    {
      year: 2026,
      month: 1,
      stats: { count: 3, totalTss: 50, totalDistance: 10000, totalDuration: 600 },
    },
    {
      year: 2026,
      month: 2,
      stats: { count: 9, totalTss: 20, totalDistance: 90000, totalDuration: 900 },
    },
    {
      year: 2026,
      month: 3,
      stats: { count: 5, totalTss: 80, totalDistance: 50000, totalDuration: 300 },
    },
  ] as never;

  const keys = (root: ReturnType<typeof create>) =>
    root.root
      .findAll((n) => n.type === 'tr' && n.props['data-row'])
      .map((n) => n.props['data-row']);

  it('shows the order the hash holds and writes the next one on a head click', () => {
    const route: Route = { screen: 'fitness', id: null, query: [['sort-months', 'load:desc']] };
    const chosen: Route[] = [];
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <MonthsTable months={months} route={route} onRoute={(next) => chosen.push(next)} />
      );
    });
    expect(keys(root)).toEqual(['2026-03', '2026-01', '2026-02']);
    const head = root.root.findAll(
      (n) => n.type === 'button' && n.props.onClick && String(n.children).includes('Load')
    )[0];
    act(() => head.props.onClick());
    expect(chosen[0]?.query).toContainEqual(['sort-months', 'load:asc']);
  });
});

describe('DataTable cell and head attributes', () => {
  it('puts a head class and a per-row cell attribute on the markup', () => {
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <DataTable
          label="t"
          columns={[
            {
              key: 'a',
              header: 'A',
              headerClass: 'compare-line-0',
              cellProps: (row: { id: string }) => ({ 'data-best': row.id === 'x' }),
              cell: (row: { id: string }) => row.id,
            },
          ]}
          rows={[{ id: 'x' }, { id: 'y' }]}
          rowKey={(row) => row.id}
        />
      );
    });
    expect(
      root.root.findAll((n) => n.type === 'th' && n.props.className === 'compare-line-0').length
    ).toBe(1);
    const cells = root.root.findAll((n) => n.type === 'td');
    expect(cells.map((c) => c.props['data-best'])).toEqual([true, false]);
  });
});
