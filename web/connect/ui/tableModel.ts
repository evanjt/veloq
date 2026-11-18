// The data table's decisions, pure so a test drives them without a browser:
// which row is active after a key, how a click changes the selection, which
// rows are mounted, and which columns a browser keeps hidden.

/** Rows are mounted in a window once a table holds more than this many. */
export const VIRTUALISE_PAST = 200;

/**
 * The row height assumed until a rendered row has been measured; the stylesheet's
 * `--web-size-row` is the same 32. A table with taller rows measures its own.
 */
export const ROW_HEIGHT = 32;

/** The rows mounted above and below the visible ones, so a fast scroll shows no gap. */
export const OVERSCAN = 8;

/** The viewport height assumed before the scroll box has been measured. */
export const DEFAULT_VIEWPORT = 640;

export type ClickMode = 'single' | 'range' | 'toggle';

export type RowSelection = { keys: readonly string[]; anchor: string | null };

export const NO_SELECTION: RowSelection = { keys: [], anchor: null };

/** The mode a click's modifier keys ask for. */
export function clickMode(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): ClickMode {
  if (event.shiftKey) return 'range';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return 'single';
}

/**
 * The selection after a click on `key`. A plain click selects only that row, a
 * shift-click selects the range from the anchor in table order, a ctrl-click
 * adds or removes the row. A range with no anchor in view is the row alone.
 */
export function selectRow(
  current: RowSelection,
  order: readonly string[],
  key: string,
  mode: ClickMode
): RowSelection {
  if (mode === 'single') return { keys: [key], anchor: key };
  if (mode === 'range') {
    const from = current.anchor === null ? -1 : order.indexOf(current.anchor);
    const to = order.indexOf(key);
    if (from < 0 || to < 0) return { keys: [key], anchor: key };
    const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return { keys: span, anchor: current.anchor };
  }
  const held = current.keys.includes(key)
    ? current.keys.filter((held) => held !== key)
    : [...current.keys, key];
  return { keys: held, anchor: key };
}

export type RowAction = 'open' | 'select';

export type RowIntent = 'open' | 'browser' | 'range' | 'single' | 'toggle' | 'ignore';

/**
 * What a click on a row asks for. A click on a control inside the row is left to the
 * control. In an `open` table a plain click opens the row, a shift-click selects a range,
 * and a ctrl, cmd or middle click is the browser's own (a new tab). In a `select` table the
 * modifiers choose how the selection changes.
 */
export function rowIntent(
  event: { button: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  onControl: boolean,
  action: RowAction
): RowIntent {
  if (onControl) return 'ignore';
  if (action === 'select') return clickMode(event);
  if (event.shiftKey) return 'range';
  if (event.ctrlKey || event.metaKey || event.button !== 0) return 'browser';
  return 'open';
}

/** The selection with every row of the table in it. */
export function selectAll(order: readonly string[]): RowSelection {
  return { keys: [...order], anchor: order[0] ?? null };
}

/** The selection narrowed to rows still in the table, as a filter or a sort can drop some. */
export function keepPresent(current: RowSelection, order: readonly string[]): RowSelection {
  const present = new Set(order);
  const keys = current.keys.filter((key) => present.has(key));
  if (keys.length === current.keys.length) return current;
  return {
    keys,
    anchor: current.anchor !== null && present.has(current.anchor) ? current.anchor : null,
  };
}

/**
 * The active row's index after a key, or null when the key moves nothing.
 * j and the down arrow step forward, k and the up arrow back, Home and End go
 * to the ends; the index stays inside the rows, and with none active the first
 * move lands on the first row.
 */
export function moveActive(active: number | null, count: number, key: string): number | null {
  if (count === 0) return null;
  const last = count - 1;
  const at = active === null ? -1 : Math.min(Math.max(active, 0), last);
  switch (key) {
    case 'j':
    case 'ArrowDown':
      return Math.min(at + 1, last);
    case 'k':
    case 'ArrowUp':
      return Math.max(at - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

export type Window = { start: number; end: number };

/**
 * The rows to mount: all of them up to `VIRTUALISE_PAST`, else the rows the
 * scroll box shows plus the overscan, as the half-open range [start, end).
 */
export function visibleWindow(
  count: number,
  scrollTop: number,
  viewport: number = DEFAULT_VIEWPORT,
  rowHeight: number = ROW_HEIGHT
): Window {
  if (count <= VIRTUALISE_PAST) return { start: 0, end: count };
  const first = Math.floor(Math.max(scrollTop, 0) / rowHeight);
  const shown = Math.ceil(viewport / rowHeight);
  return {
    start: Math.max(first - OVERSCAN, 0),
    end: Math.min(first + shown + OVERSCAN, count),
  };
}

/** The scrollTop that brings row `index` fully into a box of `viewport` pixels. */
export function scrollToRow(
  index: number,
  scrollTop: number,
  viewport: number,
  headerHeight: number,
  rowHeight: number = ROW_HEIGHT
): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight + headerHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return scrollTop;
}

export interface TableStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const storageKey = (table: string) => `veloq-connect-columns:${table}`;

/** The column keys this browser hid in one table; none when nothing valid is kept. */
export function readHidden(storage: TableStorage | null, table: string): string[] {
  return storedHidden(storage, table) ?? [];
}

/**
 * The hidden columns the browser kept for one table, or null when it has kept none. A
 * table with no kept choice falls back to the columns its page hides by default, and an
 * empty kept choice shows every column.
 */
export function storedHidden(storage: TableStorage | null, table: string): string[] | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(storageKey(table));
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string')
      : null;
  } catch {
    return null;
  }
}

/** Keeps the hidden column keys of one table; a full or refused store is not an error. */
export function writeHidden(
  storage: TableStorage | null,
  table: string,
  hidden: readonly string[]
) {
  try {
    storage?.setItem(storageKey(table), JSON.stringify(hidden));
  } catch {
    // The choice then lasts only this visit.
  }
}

/** Hides or shows one column, and never hides the last one shown. */
export function toggleColumn(
  hidden: readonly string[],
  all: readonly string[],
  key: string
): string[] {
  if (hidden.includes(key)) return hidden.filter((entry) => entry !== key);
  const shown = all.filter((entry) => !hidden.includes(entry));
  return shown.length <= 1 ? [...hidden] : [...hidden, key];
}
