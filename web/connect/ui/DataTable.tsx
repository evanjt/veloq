// A dense table: 32 px rows, a sticky header with a sort affordance on sortable
// columns, right-aligned tabular figures on numeric ones, and a count line.
// Keys move an active row (j and k, the arrows, Home and End) and Enter opens
// it; a click selects, shift-click selects a range, ctrl-click toggles, Space
// toggles the active row, and a bar offers the bulk actions while rows are
// selected. A column chooser keeps what a browser hid, per table. Past
// `VIRTUALISE_PAST` rows only the rows in view are mounted.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

import {
  clickMode,
  keepPresent,
  moveActive,
  NO_SELECTION,
  ROW_HEIGHT,
  scrollToRow,
  selectAll,
  selectRow,
  storedHidden,
  toggleColumn,
  visibleWindow,
  writeHidden,
  type RowSelection,
  type TableStorage,
} from './tableModel';

export type SortDirection = 'asc' | 'desc';

export type Column<Row> = {
  key: string;
  /** What the head shows; a node when the page fills it. */
  header: ReactNode;
  /** The column's name for the chooser, when the header is not text. */
  label?: string;
  numeric?: boolean;
  /**
   * A text column whose cells clip with an ellipsis when the pane is narrower than the
   * text. The full text is the cell's title; a node cell takes its title from `cellProps`.
   */
  clip?: boolean;
  /** Hidden until the browser keeps a choice in the column chooser. */
  defaultHidden?: boolean;
  sortable?: boolean;
  /** A class on the column's head cell. */
  headerClass?: string;
  /** Extra attributes on the column's cell in a row, such as a `data-` hook the page styles by. */
  cellProps?: (row: Row) => Record<string, string | boolean | undefined>;
  cell: (row: Row) => ReactNode;
};

export type BulkAction<Row> = {
  key: string;
  label: string;
  run: (rows: readonly Row[]) => void;
};

/** The words a table shows; the page supplies them, translated. */
export type TableLabels = {
  count: (rows: number) => string;
  selected: (count: number) => string;
  clearSelection: string;
  selectAll: string;
  columns: string;
};

/** The longest formatted value of each numeric column, in characters, so a window of rows never resizes it. */
function widestValues<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[]
): Record<string, number> {
  const widest: Record<string, number> = {};
  for (const column of columns) {
    if (!column.numeric) continue;
    let longest = 0;
    for (const row of rows) {
      const value = column.cell(row);
      if (typeof value === 'string' || typeof value === 'number') {
        longest = Math.max(longest, String(value).length);
      }
    }
    widest[column.key] = longest;
  }
  return widest;
}

function initialHidden<Row>(
  storage: TableStorage | null,
  tableId: string | undefined,
  columns: readonly Column<Row>[]
): string[] {
  const kept = tableId ? storedHidden(storage, tableId) : null;
  return kept ?? columns.filter((column) => column.defaultHidden).map((column) => column.key);
}

/** A cell's text when it is a string or a number, for a title; a node has none. */
function plainText(content: ReactNode): string | undefined {
  return typeof content === 'string' || typeof content === 'number' ? String(content) : undefined;
}

function browserStorage(): TableStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function DataTable<Row>(props: {
  label: string;
  /** A leading cell on every row, before the first column; it has no sort and no chooser entry. */
  marker?: { header: ReactNode; cell: (row: Row) => ReactNode };
  /** Extra attributes for a row, such as `data-` hooks the page styles by. */
  rowProps?: (row: Row) => Record<string, string | boolean | undefined>;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  sort?: { key: string; direction: SortDirection };
  onSort?: (key: string) => void;
  selectedKey?: string | null;
  /** Marks several rows selected at once; takes the place of `selectedKey`. */
  isSelected?: (row: Row) => boolean;
  onRowClick?: (row: Row, event: MouseEvent) => void;
  onRowHover?: (row: Row | null) => void;
  /** Called by Enter on the active row. */
  onOpen?: (row: Row) => void;
  /** Makes the first shown column a link to the row's page. */
  href?: (row: Row) => string;
  /** Rows the table selects and counts itself; the bulk bar shows while any is selected. */
  selectable?: boolean;
  /**
   * The keys of the selected rows when the page holds the selection, so a chart or a map can
   * select a row too. The table still tells `onSelectionChange` what a click chose.
   */
  selectedKeys?: readonly string[];
  bulkActions?: readonly BulkAction<Row>[];
  onSelectionChange?: (rows: readonly Row[]) => void;
  /** Names the table for the column chooser's kept choice; without it the chooser is off. */
  tableId?: string;
  labels?: TableLabels;
  storage?: TableStorage | null;
}) {
  const { rows, columns } = props;
  const storage = props.storage === undefined ? browserStorage() : props.storage;
  const [hidden, setHidden] = useState<string[]>(() =>
    initialHidden(storage, props.tableId, columns)
  );
  const [selection, setSelection] = useState<RowSelection>(NO_SELECTION);
  const [active, setActive] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState<number | undefined>(undefined);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  const order = useMemo(() => rows.map(props.rowKey), [rows, props.rowKey]);
  const keyAt = (at: number): string => order[at] ?? '';
  const shown = columns.filter((column) => !hidden.includes(column.key));
  const widths = useMemo(() => widestValues(rows, columns), [rows, columns]);
  const kept = keepPresent(
    props.selectedKeys ? { keys: props.selectedKeys, anchor: selection.anchor } : selection,
    order
  );
  const selectedKeys = new Set(kept.keys);
  const selectedRows = rows.filter((row, at) => selectedKeys.has(keyAt(at)));

  useEffect(() => {
    const height = scroller.current?.clientHeight;
    if (height) setViewport(height);
  }, [rows.length]);

  const { start, end } = visibleWindow(rows.length, scrollTop, viewport);
  const virtual = rows.length > end - start;

  const choose = (next: RowSelection) => {
    setSelection(next);
    const keys = new Set(next.keys);
    props.onSelectionChange?.(rows.filter((row, at) => keys.has(keyAt(at))));
  };

  const activate = (index: number) => {
    setActive(index);
    const box = scroller.current;
    if (box && virtual) {
      const header = box.querySelector('thead')?.clientHeight ?? 0;
      const next = scrollToRow(index, box.scrollTop, box.clientHeight, header);
      if (next !== box.scrollTop) box.scrollTop = next;
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'a' && props.selectable) {
        event.preventDefault();
        choose(selectAll(order));
      }
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    const moved = moveActive(active, rows.length, event.key);
    if (moved !== null) {
      event.preventDefault();
      activate(moved);
      if (props.selectable && event.shiftKey) {
        choose(selectRow(kept, order, keyAt(moved), 'range'));
      }
      return;
    }
    const row = active === null ? undefined : rows[active];
    if (!row) return;
    if (event.key === 'Enter' && props.onOpen) {
      event.preventDefault();
      props.onOpen(row);
    } else if (event.key === ' ' && props.selectable) {
      event.preventDefault();
      choose(selectRow(kept, order, keyAt(active as number), 'toggle'));
    } else if (event.key === 'Escape' && kept.keys.length > 0) {
      choose(NO_SELECTION);
    }
  };

  const toggleColumnKey = (key: string) => {
    const next = toggleColumn(
      hidden,
      columns.map((column) => column.key),
      key
    );
    setHidden(next);
    if (props.tableId) writeHidden(storage, props.tableId, next);
  };

  const renderRow = (row: Row, at: number) => {
    const key = keyAt(at);
    const marked = props.selectable
      ? selectedKeys.has(key)
      : props.isSelected
        ? props.isSelected(row)
        : props.selectedKey === undefined
          ? undefined
          : props.selectedKey === key;
    return (
      <tr
        key={key}
        id={`${props.tableId ?? 'table'}-row-${key}`}
        aria-selected={marked}
        aria-rowindex={at + 2}
        data-row={key}
        {...props.rowProps?.(row)}
        data-active={active === at || undefined}
        onClick={(event) => {
          if (props.selectable) {
            choose(selectRow(kept, order, key, clickMode(event)));
            setActive(at);
          }
          props.onRowClick?.(row, event);
        }}
        onMouseEnter={props.onRowHover ? () => props.onRowHover?.(row) : undefined}
        onMouseLeave={props.onRowHover ? () => props.onRowHover?.(null) : undefined}
      >
        {props.marker ? <td>{props.marker.cell(row)}</td> : null}
        {shown.map((column, position) => {
          const content = column.cell(row);
          const width = widths[column.key];
          return (
            <td
              key={column.key}
              data-numeric={column.numeric || undefined}
              data-clip={column.clip || undefined}
              title={column.clip ? plainText(content) : undefined}
              style={column.numeric && width ? { minWidth: `${width}ch` } : undefined}
              {...column.cellProps?.(row)}
            >
              {position === 0 && props.href ? (
                <a
                  href={props.href(row)}
                  onClick={(event) => {
                    if (event.shiftKey || event.ctrlKey || event.metaKey) event.preventDefault();
                    else event.stopPropagation();
                  }}
                >
                  {content}
                </a>
              ) : (
                content
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  const labels = props.labels;
  const activeRow = active === null ? undefined : rows[active];
  const spacer = (height: number, where: string) =>
    height > 0 ? (
      <tr aria-hidden="true" data-spacer={where} style={{ height }}>
        <td colSpan={shown.length + (props.marker ? 1 : 0)} />
      </tr>
    ) : null;

  return (
    <div className="ui-table-frame">
      {labels ? (
        <div className="ui-table-bar">
          {kept.keys.length > 0 ? (
            <div
              className="ui-table-bulk"
              role="toolbar"
              aria-label={labels.selected(kept.keys.length)}
            >
              <strong>{labels.selected(kept.keys.length)}</strong>
              {(props.bulkActions ?? []).map((action) => (
                <button key={action.key} type="button" onClick={() => action.run(selectedRows)}>
                  {action.label}
                </button>
              ))}
              <button type="button" onClick={() => choose(NO_SELECTION)}>
                {labels.clearSelection}
              </button>
            </div>
          ) : (
            <span className="ui-table-count" role="status">
              {labels.count(rows.length)}
            </span>
          )}
          {props.selectable && kept.keys.length < rows.length ? (
            <button type="button" onClick={() => choose(selectAll(order))}>
              {labels.selectAll}
            </button>
          ) : null}
          {props.tableId ? (
            <span className="ui-table-chooser">
              <button
                type="button"
                aria-expanded={chooserOpen}
                onClick={() => setChooserOpen(!chooserOpen)}
              >
                {labels.columns}
              </button>
              {chooserOpen ? (
                <ul role="group" aria-label={labels.columns}>
                  {columns.map((column) => (
                    <li key={column.key}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!hidden.includes(column.key)}
                          onChange={() => toggleColumnKey(column.key)}
                        />
                        {column.label ?? column.header}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="ui-table-scroll"
        ref={scroller}
        data-virtual={virtual || undefined}
        tabIndex={0}
        aria-activedescendant={
          activeRow === undefined
            ? undefined
            : `${props.tableId ?? 'table'}-row-${keyAt(active as number)}`
        }
        onKeyDown={onKeyDown}
        onScroll={virtual ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
      >
        <table
          className="ui-table"
          id={props.tableId}
          aria-label={props.label}
          aria-rowcount={rows.length + 1}
          aria-multiselectable={props.selectable || undefined}
        >
          <thead>
            <tr>
              {props.marker ? <th scope="col">{props.marker.header}</th> : null}
              {shown.map((column) => {
                const sorted = props.sort?.key === column.key ? props.sort.direction : null;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.headerClass}
                    data-numeric={column.numeric || undefined}
                    data-clip={column.clip || undefined}
                    title={column.clip ? plainText(column.header) : undefined}
                    aria-sort={
                      sorted === null ? undefined : sorted === 'asc' ? 'ascending' : 'descending'
                    }
                  >
                    {column.sortable && props.onSort ? (
                      <button type="button" onClick={() => props.onSort?.(column.key)}>
                        {column.header}
                        <span aria-hidden="true">
                          {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {spacer(start * ROW_HEIGHT, 'start')}
            {rows.slice(start, end).map((row, at) => renderRow(row, start + at))}
            {spacer((rows.length - end) * ROW_HEIGHT, 'end')}
          </tbody>
        </table>
      </div>
    </div>
  );
}
