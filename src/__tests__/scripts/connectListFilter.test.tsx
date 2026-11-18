/**
 * Scenario: a collection page filters its rows by text typed into a field in the table's own
 * toolbar, and the text is kept in the address so a reload or a shared link restores it.
 *
 * Expected behaviour: the text is read from and written to the hash as `q=`, leaving every other
 * key where it was, and an empty or blank text leaves no key; a row matches when every word of
 * the text is found in one of its fields; the count reads "N of M" in a polite live region; the
 * field sits in a `search` landmark inside the table's toolbar and reports each keystroke.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { parse, write } from '../../../web/connect/router';
import { FILTER_PAUSE_MS, useFilterDraft } from '../../../web/connect/useFilterDraft';
import { DataTable, type Column, type TableLabels } from '../../../web/connect/ui/DataTable';
import {
  filterCount,
  matchesFilter,
  readFilterText,
  withFilterText,
} from '../../../web/connect/ui/filterText';

describe('the filter text in the address', () => {
  it('reads q from the hash and nothing from a hash without it', () => {
    expect(readFilterText(parse('#/routes?q=lake%20loop&rsort=name'))).toBe('lake loop');
    expect(readFilterText(parse('#/routes?rsort=name'))).toBe('');
    expect(readFilterText(parse('#/routes'))).toBe('');
  });

  it('writes q beside the keys already there and removes it for an empty or blank text', () => {
    const held = parse('#/activities?range=thisYear&sport=run');
    const typed = withFilterText(held, 'hill');
    expect(typed.query).toEqual([
      ['range', 'thisYear'],
      ['sport', 'run'],
      ['q', 'hill'],
    ]);
    expect(withFilterText(typed, 'hill climb').query.map(([key]) => key)).toEqual([
      'range',
      'sport',
      'q',
    ]);
    expect(withFilterText(typed, '').query).toEqual(held.query);
    expect(withFilterText(typed, '   ').query).toEqual(held.query);
  });

  it('round-trips text that needs escaping', () => {
    const text = 'a&b=c #1';
    const hash = write(withFilterText(parse('#/routes'), text));
    expect(hash).toBe('#/routes?q=a%26b%3Dc%20%231');
    expect(readFilterText(parse(hash))).toBe(text);
  });
});

describe('matchesFilter', () => {
  it('matches every row for an empty text', () => {
    expect(matchesFilter('', ['Lake loop'])).toBe(true);
    expect(matchesFilter('  ', [])).toBe(true);
  });

  it('matches case-insensitively across fields, every word needing a field', () => {
    expect(matchesFilter('LAKE', ['Lake loop', 'Ride'])).toBe(true);
    expect(matchesFilter('lake ride', ['Lake loop', 'Ride'])).toBe(true);
    expect(matchesFilter('lake run', ['Lake loop', 'Ride'])).toBe(false);
    expect(matchesFilter('lake', [null, undefined, 'Hill loop'])).toBe(false);
  });
});

describe('filterCount', () => {
  it('never reports more shown than held', () => {
    expect(filterCount(3, 10)).toEqual({ shown: 3, total: 10 });
    expect(filterCount(12, 10)).toEqual({ shown: 12, total: 12 });
  });
});

type Item = { id: string; name: string };

const columns: Column<Item>[] = [{ key: 'name', header: 'Name', cell: (row) => row.name }];

const labels: TableLabels = {
  count: (rows) => `${rows} rows`,
  selected: (count) => `${count} selected`,
  clearSelection: 'Clear',
  selectAll: 'Select all',
  columns: 'Columns',
};

function mount(onChange: (text: string) => void, value = '', shown = 2, total = 5) {
  let root!: ReactTestRenderer;
  act(() => {
    root = create(
      <DataTable
        label="Things"
        tableId="things"
        labels={labels}
        columns={columns}
        rows={[
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ]}
        rowKey={(row) => row.id}
        filter={{
          label: 'Filter things',
          clearLabel: 'Clear filter',
          value,
          onChange,
          count: { shown, total },
          countText: (count) => `${count.shown} of ${count.total}`,
        }}
      />
    );
  });
  return root;
}

describe('the filter in a table toolbar', () => {
  it('draws a search landmark with a named field and the count in a polite live region', () => {
    const root = mount(() => undefined);
    const landmark = root.root.findByProps({ role: 'search' });
    const input = landmark.findByType('input');
    expect(input.props['aria-label']).toBe('Filter things');
    expect(input.props.placeholder).toBe('Filter things');
    const live = landmark.findByProps({ 'aria-live': 'polite' });
    expect(live.children.join('')).toBe('2 of 5');
    // The toolbar's own row count gives way to the filter's.
    expect(root.root.findAll((node) => node.props.role === 'status')).toHaveLength(0);
  });

  it('sits in the toolbar above the table, not beside the page', () => {
    const root = mount(() => undefined);
    const bar = root.root.findByProps({ className: 'ui-table-bar' });
    expect(bar.findAllByProps({ role: 'search' }).length).toBeGreaterThan(0);
  });

  it('reports each keystroke, and a clear button appears only once there is text', () => {
    const typed: string[] = [];
    const empty = mount((text) => typed.push(text));
    act(() => {
      empty.root.findByType('input').props.onChange({ currentTarget: { value: 'be' } });
    });
    expect(typed).toEqual(['be']);
    expect(empty.root.findAllByProps({ 'aria-label': 'Clear filter' })).toHaveLength(0);

    const held = mount((text) => typed.push(text), 'be');
    act(() => {
      held.root.findByProps({ 'aria-label': 'Clear filter' }).props.onClick();
    });
    expect(typed).toEqual(['be', '']);
  });

  it('keeps the toolbar and the field when the filter leaves no rows, so it can be cleared', () => {
    let root!: ReactTestRenderer;
    act(() => {
      root = create(
        <DataTable
          label="Things"
          labels={labels}
          columns={columns}
          rows={[]}
          rowKey={(row: Item) => row.id}
          filter={{
            label: 'Filter things',
            clearLabel: 'Clear filter',
            value: 'zzz',
            onChange: () => undefined,
            count: { shown: 0, total: 5 },
            countText: (count) => `${count.shown} of ${count.total}`,
          }}
        />
      );
    });
    expect(root.root.findAllByType('input')).toHaveLength(1);
    expect(root.root.findByProps({ 'aria-live': 'polite' }).children.join('')).toBe('0 of 5');
  });
});

describe('the filter draft', () => {
  type Draft = { text: string; set: (text: string) => void };

  function mountDraft(committed: string, commit: (text: string) => void) {
    const draft: Draft = { text: '', set: () => undefined };
    function Probe(props: { committed: string }) {
      const [text, set] = useFilterDraft(props.committed, commit);
      draft.text = text;
      draft.set = set;
      return null;
    }
    let root!: ReactTestRenderer;
    act(() => {
      root = create(<Probe committed={committed} />);
    });
    return {
      draft,
      setCommitted: (next: string) => act(() => root.update(<Probe committed={next} />)),
    };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows each keystroke at once and commits only the text typing paused on', () => {
    const commits: string[] = [];
    const { draft } = mountDraft('', (text) => commits.push(text));
    act(() => draft.set('h'));
    act(() => jest.advanceTimersByTime(FILTER_PAUSE_MS - 1));
    act(() => draft.set('hi'));
    expect(draft.text).toBe('hi');
    act(() => jest.advanceTimersByTime(FILTER_PAUSE_MS - 1));
    expect(commits).toEqual([]);
    act(() => jest.advanceTimersByTime(1));
    expect(commits).toEqual(['hi']);
  });

  it('commits nothing for text the address already holds, or for blanks over no text', () => {
    const commits: string[] = [];
    const { draft } = mountDraft('hill', (text) => commits.push(text));
    act(() => draft.set('hill'));
    act(() => jest.advanceTimersByTime(FILTER_PAUSE_MS * 2));
    const empty = mountDraft('', (text) => commits.push(text));
    act(() => empty.draft.set('   '));
    act(() => jest.advanceTimersByTime(FILTER_PAUSE_MS * 2));
    expect(commits).toEqual([]);
  });

  it('takes text the address changes under the field, and keeps typing made after its own write', () => {
    const commits: string[] = [];
    const { draft, setCommitted } = mountDraft('', (text) => commits.push(text));
    setCommitted('from a link');
    expect(draft.text).toBe('from a link');

    act(() => draft.set('typed'));
    act(() => jest.advanceTimersByTime(FILTER_PAUSE_MS));
    expect(commits).toEqual(['typed']);
    // The page writes what was committed, and the athlete has typed on before it re-renders.
    act(() => draft.set('typed more'));
    setCommitted('typed');
    expect(draft.text).toBe('typed more');
  });
});
