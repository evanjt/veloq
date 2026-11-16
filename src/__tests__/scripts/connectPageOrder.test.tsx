/**
 * Scenario: a pass table is ordered by a column head and the order is carried
 * in the hash query beside the list state.
 *
 * Expected behaviour: an order round-trips through the hash; a default order
 * is not written; an unknown column or direction reads as the default; the
 * lists page keeps the order when a list's selection changes; a header cell
 * can be a node, a leading marker cell and per-row attributes reach the markup.
 */

import { act, create } from 'react-test-renderer';

import { formatOrder, parseOrder, parse, write } from '../../../web/connect/router';
import { fromRoute, toRoute } from '../../../web/connect/routesList';
import { DataTable } from '../../../web/connect/ui/DataTable';

const COLUMNS = ['date', 'time', 'delta'] as const;
const DEFAULT = { column: 'date', descending: true } as const;

describe('order in the hash', () => {
  it('restores the order a reload finds in the hash', () => {
    const text = formatOrder({ column: 'time', descending: false }, DEFAULT);
    expect(text).toBe('time:asc');
    const route = parse(write({ screen: 'section', id: 's1', query: [['psort', text as string]] }));
    const page = fromRoute(route);
    expect(parseOrder(page?.order ?? null, COLUMNS, DEFAULT)).toEqual({
      column: 'time',
      descending: false,
    });
    expect(toRoute(page!).query).toContainEqual(['psort', 'time:asc']);
  });

  it('writes nothing for the default and reads junk as the default', () => {
    expect(formatOrder({ column: 'date', descending: true }, DEFAULT)).toBeNull();
    for (const junk of [null, '', 'time', 'time:sideways', 'nope:asc']) {
      expect(parseOrder(junk, COLUMNS, DEFAULT)).toEqual(DEFAULT);
    }
  });
});

describe('DataTable with node headers, a marker and row attributes', () => {
  it('renders them', () => {
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <DataTable
          label="t"
          tableId="passes"
          columns={[{ key: 'a', header: <b>Head</b>, cell: (row: { id: string }) => row.id }]}
          rows={[{ id: 'x' }]}
          rowKey={(row) => row.id}
          marker={{ header: 'swatch', cell: () => <i className="mark" /> }}
          rowProps={() => ({ 'data-pr': true })}
        />
      );
    });
    const row = root.root.findAll((n) => n.type === 'tr' && n.props['data-row'] === 'x')[0];
    expect(row.props['data-pr']).toBe(true);
    expect(row.findAll((n) => n.type === 'i').length).toBe(1);
    expect(root.root.findAll((n) => n.type === 'b').length).toBe(1);
  });
});
