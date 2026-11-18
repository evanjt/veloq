// A dense table: a sticky header with a sort affordance on sortable columns,
// right-aligned tabular figures on numeric ones, and a count line.
//
// One prop decides what a row does. With `rowAction: 'open'` the primary column
// carries the row's link, stretched over the row: a plain click or Enter
// navigates, and a ctrl, cmd or middle click is the browser's own. Selection is
// a checkbox column and shift-click. With `'select'` (the default) a click
// selects, shift-click selects a range and ctrl-click toggles.
//
// One keyboard model serves both: the table is the one tab stop, j and k, the
// arrows, Home and End move the active row, Enter opens it, Space or x toggles
// it, Escape clears the selection. A bar offers the bulk actions while rows are
// selected. A column chooser keeps what a browser hid, per table. Past
// `VIRTUALISE_PAST` rows only the rows in view are mounted, by the height of a
// rendered row.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

import { ListFilter, type ListFilterProps } from './ListFilter';
import {
  keepPresent,
  moveActive,
  NO_SELECTION,
  ROW_HEIGHT,
  rowIntent,
  scrollToRow,
  selectAll,
  selectRow,
  storedHidden,
  toggleColumn,
  visibleWindow,
  writeHidden,
  type RowAction,
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
  /** The column that carries the row's link in an `open` table; the first shown one when none does. */
  primary?: boolean;
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
  /** The name of a row's checkbox. */
  selectRow?: string;
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

function navigateTo(href: string) {
  window.location.assign(href);
}

/** True when the click landed on a control inside the row, which handles it itself. */
function onControl(target: EventTarget | null): boolean {
  const reach = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(reach?.closest?.('a, button, input, label, select, textarea'));
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
  /** Called for a click that selects or is not a navigation; not for one that opens the row. */
  onRowClick?: (row: Row, event: MouseEvent) => void;
  onRowHover?: (row: Row | null) => void;
  /**
   * What a row does: `open` navigates to its `href`, `select` selects it. A table where
   * rows lead to a page passes `open`.
   */
  rowAction?: RowAction;
  /** Called by Enter on the active row of a table with no `href`. */
  onOpen?: (row: Row) => void;
  /** The row's page, carried by the primary column's link. */
  href?: (row: Row) => string;
  /** Takes a plain click or Enter on a row to its page; the default sets the address. */
  onNavigate?: (href: string) => void;
  /** Called when a key moves the active row, so a page can follow the cursor. */
  onActiveChange?: (row: Row) => void;
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
  /**
   * The list's filter, drawn at the start of the toolbar. Its "N of M" count takes the place of
   * the toolbar's row count, and the toolbar stays while the filter leaves no rows.
   */
  filter?: ListFilterProps;
  storage?: TableStorage | null;
}) {
  const { rows, columns } = props;
  const storage = props.storage === undefined ? browserStorage() : props.storage;
  const [hidden, setHidden] = useState<string[]>(() =>
    initialHidden(storage, props.tableId, columns)
  );
  const [selection, setSelection] = useState<RowSelection>(NO_SELECTION);
  const indexOfKey = (key: string | null | undefined): number | null => {
    if (key === undefined || key === null) return null;
    const at = rows.findIndex((row) => props.rowKey(row) === key);
    return at >= 0 ? at : null;
  };
  const [active, setActive] = useState<number | null>(() => indexOfKey(props.selectedKey));
  const [syncedKey, setSyncedKey] = useState(props.selectedKey);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState<number | undefined>(undefined);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  const chooserButton = useRef<HTMLButtonElement | null>(null);
  const action: RowAction = props.rowAction ?? 'select';
  const opens = action === 'open';
  const interactive =
    opens ||
    Boolean(props.selectable || props.onOpen || props.onRowClick) ||
    props.isSelected !== undefined ||
    props.selectedKey !== undefined;
  const navigate = props.onNavigate ?? navigateTo;

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

  const windowStart = visibleWindow(rows.length, scrollTop, viewport, rowHeight).start;
  useEffect(() => {
    const first = scroller.current?.querySelector?.<HTMLElement>('tbody tr[data-row]');
    const height = first?.getBoundingClientRect().height;
    if (height && Math.abs(height - rowHeight) > 0.5) setRowHeight(height);
  }, [rows.length, windowStart, rowHeight]);

  // The cursor follows the page's selected row when that row changes, so the ring and
  // the selection are never on different rows.
  if (props.selectedKey !== syncedKey) {
    setSyncedKey(props.selectedKey);
    const at = indexOfKey(props.selectedKey);
    if (at !== null) setActive(at);
  }

  const { start, end } = visibleWindow(rows.length, scrollTop, viewport, rowHeight);
  const virtual = rows.length > end - start;

  const choose = (next: RowSelection) => {
    setSelection(next);
    const keys = new Set(next.keys);
    props.onSelectionChange?.(rows.filter((row, at) => keys.has(keyAt(at))));
  };

  const activate = (index: number) => {
    setActive(index);
    const row = rows[index];
    if (row !== undefined) props.onActiveChange?.(row);
    const box = scroller.current;
    if (box && virtual) {
      const header = box.querySelector('thead')?.clientHeight ?? 0;
      const next = scrollToRow(index, box.scrollTop, box.clientHeight, header, rowHeight);
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
    const onLink = target !== null && /^(A|BUTTON)$/.test(target.tagName);
    if (event.key === 'Enter' && !onLink && (props.href || props.onOpen)) {
      event.preventDefault();
      if (opens && props.href) navigate(props.href(row));
      else props.onOpen?.(row);
    } else if (((event.key === ' ' && !onLink) || event.key === 'x') && props.selectable) {
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
    const marked =
      props.selectable || props.isSelected || props.selectedKey !== undefined
        ? Boolean(
            (props.selectable && selectedKeys.has(key)) ||
            props.isSelected?.(row) ||
            (props.selectedKey !== undefined && props.selectedKey === key)
          )
        : undefined;
    const primary = shown.find((column) => column.primary) ?? shown[0];
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
          const intent = rowIntent(event, onControl(event.target), action);
          if (intent === 'ignore') return;
          setActive(at);
          if (intent === 'browser') return;
          if (intent === 'open') {
            if (props.href) navigate(props.href(row));
            return;
          }
          if (props.selectable) choose(selectRow(kept, order, key, intent));
          props.onRowClick?.(row, event);
        }}
        onMouseEnter={props.onRowHover ? () => props.onRowHover?.(row) : undefined}
        onMouseLeave={props.onRowHover ? () => props.onRowHover?.(null) : undefined}
      >
        {opens && props.selectable ? (
          <td data-box="">
            <input
              type="checkbox"
              data-row-box
              tabIndex={-1}
              aria-label={props.labels?.selectRow ?? props.label}
              checked={selectedKeys.has(key)}
              onChange={() => {
                choose(selectRow(kept, order, key, 'toggle'));
                setActive(at);
              }}
            />
          </td>
        ) : null}
        {props.marker ? <td>{props.marker.cell(row)}</td> : null}
        {shown.map((column) => {
          const content = column.cell(row);
          const width = widths[column.key];
          return (
            <td
              key={column.key}
              data-numeric={column.numeric || undefined}
              data-clip={column.clip || undefined}
              data-primary={column === primary && props.href ? true : undefined}
              title={column.clip ? plainText(content) : undefined}
              style={column.numeric && width ? { minWidth: `${width}ch` } : undefined}
              {...column.cellProps?.(row)}
            >
              {column === primary && props.href ? (
                <a
                  href={props.href(row)}
                  tabIndex={opens ? -1 : undefined}
                  onClick={(event) => {
                    setActive(at);
                    if (event.shiftKey && props.selectable) {
                      event.preventDefault();
                      choose(selectRow(kept, order, key, 'range'));
                    }
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
  const leading = (props.marker ? 1 : 0) + (opens && props.selectable ? 1 : 0);
  const spacer = (height: number, where: string) =>
    height > 0 ? (
      <tr aria-hidden="true" data-spacer={where} style={{ height }}>
        <td colSpan={shown.length + leading} />
      </tr>
    ) : null;

  return (
    <div className="ui-table-frame">
      {labels ? (
        <div className="ui-table-bar">
          {props.filter ? <ListFilter {...props.filter} /> : null}
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
          ) : props.filter ? null : (
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
            <span
              className="ui-table-chooser"
              onKeyDown={(event) => {
                if (event.key !== 'Escape' || !chooserOpen) return;
                event.stopPropagation();
                event.preventDefault();
                setChooserOpen(false);
                chooserButton.current?.focus();
              }}
            >
              <button
                type="button"
                ref={chooserButton}
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
        tabIndex={virtual && !interactive ? 0 : undefined}
        onScroll={virtual ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
      >
        <table
          className="ui-table"
          id={props.tableId}
          aria-label={props.label}
          aria-rowcount={rows.length + 1}
          role={interactive ? 'grid' : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-multiselectable={interactive && props.selectable ? true : undefined}
          aria-activedescendant={
            interactive && activeRow !== undefined
              ? `${props.tableId ?? 'table'}-row-${keyAt(active as number)}`
              : undefined
          }
          data-open={opens || undefined}
          onKeyDown={interactive ? onKeyDown : undefined}
        >
          <thead>
            <tr>
              {opens && props.selectable ? (
                <th scope="col" data-box="">
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    aria-label={labels?.selectAll ?? props.label}
                    checked={rows.length > 0 && kept.keys.length === rows.length}
                    onChange={() =>
                      choose(kept.keys.length === rows.length ? NO_SELECTION : selectAll(order))
                    }
                  />
                </th>
              ) : null}
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
            {spacer(start * rowHeight, 'start')}
            {rows.slice(start, end).map((row, at) => renderRow(row, start + at))}
            {spacer((rows.length - end) * rowHeight, 'end')}
          </tbody>
        </table>
      </div>
    </div>
  );
}
