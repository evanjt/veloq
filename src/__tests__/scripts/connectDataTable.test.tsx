/**
 * Scenario: a collection of 5,000 rows is shown in the connect page's data table.
 *
 * Expected behaviour: j and k move the active row and Enter opens it; a
 * shift-click selects the range from the anchor and shows the bulk bar; a
 * table of 5,000 rows mounts a window of rows, not all of them; a column the
 * browser hid stays hidden on the next mount.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DataTable, type Column, type TableLabels } from '../../../web/connect/ui/DataTable';
import {
  clickMode,
  keepPresent,
  moveActive,
  readHidden,
  rowIntent,
  scrollToRow,
  selectRow,
  storedHidden,
  toggleColumn,
  visibleWindow,
  writeHidden,
  type TableStorage,
} from '../../../web/connect/ui/tableModel';

type Item = { id: string; name: string; metres: number };

const items = (count: number): Item[] =>
  Array.from({ length: count }, (_, at) => ({ id: `r${at}`, name: `Row ${at}`, metres: at * 10 }));

const columns: Column<Item>[] = [
  { key: 'name', header: 'Name', sortable: true, cell: (row) => row.name },
  { key: 'metres', header: 'Metres', numeric: true, cell: (row) => row.metres },
];

const labels: TableLabels = {
  count: (rows) => `${rows} rows`,
  selected: (count) => `${count} selected`,
  clearSelection: 'Clear',
  selectAll: 'Select all',
  columns: 'Columns',
};

const memory = (): TableStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
};

const key = (name: string, extra: object = {}) => ({
  key: name,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: { tagName: 'DIV' },
  preventDefault: () => undefined,
  ...extra,
});

const scroller = (root: ReactTestRenderer) => root.root.findByProps({ role: 'grid' });
const dataRows = (root: ReactTestRenderer) =>
  root.root.findAll((node) => node.type === 'tr' && node.props['data-row'] !== undefined);

function mount(props: Partial<Parameters<typeof DataTable<Item>>[0]> = {}) {
  let root!: ReactTestRenderer;
  act(() => {
    root = create(
      <DataTable
        label="Items"
        columns={columns}
        rows={items(10)}
        rowKey={(row) => row.id}
        storage={null}
        {...props}
      />
    );
  });
  return root;
}

describe('the table model', () => {
  it('moves the active row with j and k and stops at the ends', () => {
    expect(moveActive(null, 5, 'j')).toBe(0);
    expect(moveActive(0, 5, 'j')).toBe(1);
    expect(moveActive(4, 5, 'j')).toBe(4);
    expect(moveActive(0, 5, 'k')).toBe(0);
    expect(moveActive(3, 5, 'ArrowUp')).toBe(2);
    expect(moveActive(2, 5, 'End')).toBe(4);
    expect(moveActive(2, 5, 'x')).toBeNull();
    expect(moveActive(null, 0, 'j')).toBeNull();
  });

  it('selects a range in table order from the anchor, in either direction', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    const first = selectRow({ keys: [], anchor: null }, order, 'b', 'single');
    expect(selectRow(first, order, 'd', 'range').keys).toEqual(['b', 'c', 'd']);
    expect(selectRow(first, order, 'a', 'range').keys).toEqual(['a', 'b']);
    expect(selectRow(first, order, 'd', 'range').anchor).toBe('b');
  });

  it('toggles a row and treats a range with no anchor as the row alone', () => {
    const order = ['a', 'b', 'c'];
    const two = selectRow(
      selectRow({ keys: [], anchor: null }, order, 'a', 'single'),
      order,
      'c',
      'toggle'
    );
    expect(two.keys).toEqual(['a', 'c']);
    expect(selectRow(two, order, 'a', 'toggle').keys).toEqual(['c']);
    expect(selectRow({ keys: [], anchor: null }, order, 'b', 'range').keys).toEqual(['b']);
  });

  it('drops selected rows that a filter removed', () => {
    const held = { keys: ['a', 'b', 'c'], anchor: 'a' };
    expect(keepPresent(held, ['b', 'c'])).toEqual({ keys: ['b', 'c'], anchor: null });
    expect(keepPresent(held, ['a', 'b', 'c'])).toBe(held);
  });

  it('reads modifier keys as a click mode', () => {
    const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
    expect(clickMode(plain)).toBe('single');
    expect(clickMode({ ...plain, shiftKey: true })).toBe('range');
    expect(clickMode({ ...plain, metaKey: true })).toBe('toggle');
  });

  it('mounts every row up to the cap and a window past it', () => {
    expect(visibleWindow(200, 0)).toEqual({ start: 0, end: 200 });
    const top = visibleWindow(5000, 0);
    expect(top.start).toBe(0);
    expect(top.end).toBeLessThan(100);
    const middle = visibleWindow(5000, 32 * 2500, 640);
    expect(middle.start).toBeGreaterThan(2400);
    expect(middle.end - middle.start).toBeLessThan(100);
    expect(visibleWindow(5000, 10 ** 9, 640).end).toBe(5000);
  });

  it('keeps hidden columns, ignores a corrupt store and never hides the last column', () => {
    const storage = memory();
    writeHidden(storage, 'feed', ['metres']);
    expect(readHidden(storage, 'feed')).toEqual(['metres']);
    expect(readHidden(storage, 'other')).toEqual([]);
    storage.data.set('veloq-connect-columns:bad', '{not json');
    expect(readHidden(storage, 'bad')).toEqual([]);
    expect(readHidden(null, 'feed')).toEqual([]);
    expect(toggleColumn(['metres'], ['name', 'metres'], 'name')).toEqual(['metres']);
    expect(toggleColumn([], ['name', 'metres'], 'name')).toEqual(['name']);
  });
});

const click = (extra: object = {}) => ({
  button: 0,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...extra,
});

describe('what a row click asks for', () => {
  it('opens on a plain click and leaves a modified or middle click to the browser', () => {
    expect(rowIntent(click(), false, 'open')).toBe('open');
    expect(rowIntent(click({ ctrlKey: true }), false, 'open')).toBe('browser');
    expect(rowIntent(click({ metaKey: true }), false, 'open')).toBe('browser');
    expect(rowIntent(click({ button: 1 }), false, 'open')).toBe('browser');
    expect(rowIntent(click({ shiftKey: true }), false, 'open')).toBe('range');
  });

  it('leaves a click on a control inside the row to the control', () => {
    expect(rowIntent(click(), true, 'open')).toBe('ignore');
    expect(rowIntent(click(), true, 'select')).toBe('ignore');
  });

  it('selects, ranges and toggles when the table selects', () => {
    expect(rowIntent(click(), false, 'select')).toBe('single');
    expect(rowIntent(click({ shiftKey: true }), false, 'select')).toBe('range');
    expect(rowIntent(click({ ctrlKey: true }), false, 'select')).toBe('toggle');
  });
});

describe('the virtual window with a measured row height', () => {
  it('mounts the rows that fit the measured height, not the assumed one', () => {
    const tall = visibleWindow(5000, 41 * 1000, 640, 41);
    expect(tall.start).toBe(1000 - 8);
    expect(tall.end).toBe(1000 + Math.ceil(640 / 41) + 8);
  });

  it('scrolls a row into view by its measured height', () => {
    expect(scrollToRow(100, 0, 400, 30, 41)).toBe(100 * 41 + 41 + 30 - 400);
    expect(scrollToRow(2, 500, 400, 30, 41)).toBe(82);
  });
});

describe('the data table', () => {
  it('moves the active row with j and k and opens it with Enter', () => {
    const opened: string[] = [];
    const root = mount({ onOpen: (row) => opened.push(row.id) });
    const press = (name: string) => act(() => scroller(root).props.onKeyDown(key(name)));
    press('j');
    press('j');
    press('k');
    press('j');
    press('Enter');
    expect(opened).toEqual(['r1']);
    expect(
      dataRows(root)
        .filter((row) => row.props['data-active'])
        .map((row) => row.props['data-row'])
    ).toEqual(['r1']);
  });

  it('selects a range on shift-click and shows the bulk bar with its actions', () => {
    const run = jest.fn();
    const root = mount({
      selectable: true,
      labels,
      bulkActions: [{ key: 'export', label: 'Export', run }],
    });
    const click = (id: string, extra: object = {}) =>
      act(() =>
        dataRows(root)
          .find((row) => row.props['data-row'] === id)
          ?.props.onClick({ shiftKey: false, ctrlKey: false, metaKey: false, ...extra })
      );
    click('r2');
    click('r5', { shiftKey: true });
    const bar = root.root.findByProps({ role: 'toolbar' });
    expect(bar.props['aria-label']).toBe('4 selected');
    expect(dataRows(root).filter((row) => row.props['aria-selected']).length).toBe(4);
    const button = root.root.findAll(
      (node) => node.type === 'button' && node.children.includes('Export')
    )[0];
    act(() => button.props.onClick());
    expect(run.mock.calls[0][0].map((row: Item) => row.id)).toEqual(['r2', 'r3', 'r4', 'r5']);
    act(() => scroller(root).props.onKeyDown(key('Escape')));
    expect(root.root.findAllByProps({ role: 'toolbar' })).toHaveLength(0);
  });

  it('toggles the active row with Space', () => {
    const root = mount({ selectable: true, labels });
    act(() => scroller(root).props.onKeyDown(key('j')));
    act(() => scroller(root).props.onKeyDown(key(' ')));
    expect(root.root.findByProps({ role: 'toolbar' }).props['aria-label']).toBe('1 selected');
  });

  it('mounts under 100 rows for a table of 5,000 and counts them all', () => {
    const root = mount({ rows: items(5000), labels });
    expect(dataRows(root).length).toBeLessThan(100);
    expect(dataRows(root).length).toBeGreaterThan(0);
    expect(root.root.findByProps({ className: 'ui-table-count' }).children).toEqual(['5000 rows']);
  });

  it('mounts every row of a table at or under the cap', () => {
    expect(dataRows(mount({ rows: items(200) })).length).toBe(200);
  });

  it('hides a column through the chooser and keeps it on the next mount', () => {
    const storage = memory();
    const root = mount({ tableId: 'feed', labels, storage });
    act(() =>
      root.root
        .findAll((node) => node.type === 'button' && node.props['aria-expanded'] !== undefined)[0]
        .props.onClick()
    );
    const boxes = root.root.findAll((node) => node.type === 'input');
    act(() => boxes[1].props.onChange());
    const headers = (tree: ReactTestRenderer) =>
      tree.root.findAll((node) => node.type === 'th').length;
    expect(headers(root)).toBe(1);
    expect(storage.data.get('veloq-connect-columns:feed')).toBe('["metres"]');
    expect(headers(mount({ tableId: 'feed', labels, storage }))).toBe(1);
  });

  it('opens the row on a plain click on any cell and leaves a ctrl-click to the browser', () => {
    const opened: string[] = [];
    const root = mount({
      rowAction: 'open',
      href: (row) => `#/item/${row.id}`,
      onNavigate: (href) => opened.push(href),
    });
    const row = dataRows(root)[2];
    act(() => row.props.onClick({ ...click(), target: { closest: () => null } }));
    expect(opened).toEqual(['#/item/r2']);
    const preventDefault = jest.fn();
    const link = root.root.findAll((node) => node.type === 'a')[2];
    act(() => link.props.onClick({ ...click({ ctrlKey: true }), preventDefault }));
    expect(preventDefault).not.toHaveBeenCalled();
    act(() => link.props.onClick({ ...click({ button: 1 }), preventDefault }));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(opened).toEqual(['#/item/r2']);
  });

  it('puts the link in the primary column and keeps the row links out of the tab order', () => {
    const root = mount({
      rowAction: 'open',
      href: (row) => `#/item/${row.id}`,
      columns: [
        { key: 'metres', header: 'Metres', numeric: true, cell: (row) => row.metres },
        { key: 'name', header: 'Name', primary: true, cell: (row) => row.name },
      ],
    });
    const links = root.root.findAll((node) => node.type === 'a');
    expect(links).toHaveLength(10);
    expect(links[0].parent?.props['data-primary']).toBe(true);
    expect(links.every((link) => link.props.tabIndex === -1)).toBe(true);
  });

  it('has one tab stop, a grid role and the active descendant on the grid', () => {
    const root = mount({ rowAction: 'open', href: (row) => `#/item/${row.id}` });
    const stops = root.root.findAll(
      (node) => typeof node.type === 'string' && node.props.tabIndex === 0
    );
    expect(stops).toHaveLength(1);
    expect(stops[0].props.role).toBe('grid');
    act(() => scroller(root).props.onKeyDown(key('j')));
    expect(scroller(root).props['aria-activedescendant']).toBe('table-row-r0');
    expect(
      root.root.findAll((node) => node.props['aria-activedescendant'] !== undefined)
    ).toHaveLength(1);
  });

  it('makes the active row the selected row, so cursor and selection agree', () => {
    const moved: string[] = [];
    const root = mount({
      rowAction: 'open',
      href: (row) => `#/item/${row.id}`,
      selectedKey: 'r3',
      onActiveChange: (row) => moved.push(row.id),
    });
    const both = () =>
      dataRows(root).filter((row) => row.props['data-active'] && row.props['aria-selected']);
    expect(both().map((row) => row.props['data-row'])).toEqual(['r3']);
    act(() => scroller(root).props.onKeyDown(key('j')));
    expect(moved).toEqual(['r4']);
    act(() =>
      root.update(
        <DataTable
          label="Items"
          columns={columns}
          rows={items(10)}
          rowKey={(row) => row.id}
          storage={null}
          rowAction="open"
          href={(row) => `#/item/${row.id}`}
          selectedKey="r4"
          onActiveChange={(row) => moved.push(row.id)}
        />
      )
    );
    expect(both().map((row) => row.props['data-row'])).toEqual(['r4']);
  });

  it('selects by checkbox and range in open mode, with Space and x toggling the active row', () => {
    const root = mount({
      rowAction: 'open',
      selectable: true,
      labels,
      href: (row) => `#/item/${row.id}`,
    });
    const boxes = root.root.findAll(
      (node) =>
        node.type === 'input' && node.props.type === 'checkbox' && node.props['data-row-box']
    );
    expect(boxes).toHaveLength(10);
    expect(boxes[0].props.tabIndex).toBe(-1);
    act(() => boxes[1].props.onChange({ nativeEvent: {} }));
    act(() =>
      dataRows(root)[4].props.onClick({
        ...click({ shiftKey: true }),
        target: { closest: () => null },
      })
    );
    expect(root.root.findByProps({ role: 'toolbar' }).props['aria-label']).toBe('4 selected');
    act(() => scroller(root).props.onKeyDown(key('Escape')));
    act(() => scroller(root).props.onKeyDown(key('j')));
    act(() => scroller(root).props.onKeyDown(key('x')));
    expect(root.root.findByProps({ role: 'toolbar' }).props['aria-label']).toBe('1 selected');
  });

  it('closes the column chooser on Escape and returns focus to its button', () => {
    const root = mount({ tableId: 'feed', labels });
    const button = () =>
      root.root.findAll(
        (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined
      )[0];
    act(() => button().props.onClick());
    expect(button().props['aria-expanded']).toBe(true);
    const chooser = root.root.findByProps({ className: 'ui-table-chooser' });
    act(() =>
      chooser.props.onKeyDown({
        key: 'Escape',
        stopPropagation: () => undefined,
        preventDefault: () => undefined,
      })
    );
    expect(button().props['aria-expanded']).toBe(false);
  });

  it('makes the first column a link when the page gives an address', () => {
    const root = mount({ href: (row) => `#/activity/${row.id}` });
    const links = root.root.findAll((node) => node.type === 'a');
    expect(links).toHaveLength(10);
    expect(links[0].props.href).toBe('#/activity/r0');
  });
});

describe('the data table cells', () => {
  const headers = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => node.type === 'th').length;
  const cells = (tree: ReactTestRenderer) => tree.root.findAll((node) => node.type === 'td');

  it('titles a clipped text cell with its full text and sizes a numeric column to its widest value', () => {
    const shaped: Column<Item>[] = [
      { key: 'name', header: 'Name', clip: true, cell: (row) => row.name },
      { key: 'metres', header: 'Metres', numeric: true, cell: (row) => row.metres },
    ];
    const root = mount({
      columns: shaped,
      rows: [
        { id: 'a', name: 'Lakeside Loop Clockwise', metres: 1234 },
        { id: 'b', name: 'Hill', metres: 98 },
      ],
    });
    const [name, metres] = cells(root).slice(0, 2);
    expect(name.props['data-clip']).toBe(true);
    expect(name.props.title).toBe('Lakeside Loop Clockwise');
    expect(metres.props.title).toBeUndefined();
    expect(metres.props.style).toEqual({ minWidth: '4ch' });
    expect(
      cells(mount({ columns: shaped, rows: [{ id: 'a', name: 'Hill', metres: 98 }] }))[0].props
        .title
    ).toBe('Hill');
  });

  it('leaves a column the page hides by default out until the browser keeps a choice', () => {
    const sized: Column<Item>[] = [
      { key: 'name', header: 'Name', cell: (row) => row.name },
      {
        key: 'metres',
        header: 'Metres',
        numeric: true,
        defaultHidden: true,
        cell: (row) => row.metres,
      },
    ];
    const storage = memory();
    expect(headers(mount({ columns: sized, tableId: 'laps', labels, storage }))).toBe(1);
    writeHidden(storage, 'laps', []);
    expect(headers(mount({ columns: sized, tableId: 'laps', labels, storage }))).toBe(2);
  });

  it('tells a stored empty choice from no choice at all', () => {
    const storage = memory();
    expect(storedHidden(storage, 'laps')).toBeNull();
    writeHidden(storage, 'laps', []);
    expect(storedHidden(storage, 'laps')).toEqual([]);
    expect(storedHidden(null, 'laps')).toBeNull();
  });
});
