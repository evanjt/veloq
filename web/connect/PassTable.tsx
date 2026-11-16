// A section's pass table or a route's attempt table: one row per pass, the
// same shift-click and ctrl-click selection as the feed, and a swatch in the
// compare colour on every selected row. The page fills the cells; this only
// marks and selects.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MAX_COMPARED,
  passTableRows,
  select,
  type Compared,
  type Mode,
  type PassRow,
} from './compare';
import { useTableLabels } from './tableLabels';
import { DataTable, type Column } from './ui/DataTable';

export type PassTableRow = PassRow & {
  /** The row's first cell: what the pass is called. */
  label: ReactNode;
  /** The cells after the label, one per column after the first. */
  cells: ReactNode[];
  /** Marks the row for the page's emphasis, such as the fastest pass. */
  pr?: boolean;
};

export type PassTableColumn = {
  key: string;
  header: ReactNode;
  /** The column's name where the header is not text. */
  label?: string;
  sortable?: boolean;
  numeric?: boolean;
  /** Hidden until the browser keeps a choice in the column chooser. */
  defaultHidden?: boolean;
};

export function PassTable(props: {
  rows: readonly PassTableRow[];
  set: readonly Compared[];
  anchor: string | null;
  /** The columns, the first showing each row's label and the rest its cells in order. */
  columns: readonly PassTableColumn[];
  /** The column the rows are ordered by, and which way. */
  sort: { key: string; direction: 'asc' | 'desc' };
  onSort: (key: string) => void;
  /** Told the new selection, and the ids a fifth selection dropped. */
  onSelect: (ids: string[], dropped: string[], anchor: string) => void;
  /** The row the pointer is on, or null when it leaves the table's rows. */
  onHover?: (id: string | null) => void;
  /** The row to show lit, from the map. */
  hovered?: string | null;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const order = props.rows.map((row) => row.id);
  const rows = passTableRows(props.rows, props.set);
  const columns: Column<(typeof rows)[number]>[] = props.columns.map((column, at) => ({
    ...column,
    cell: (row) => (at === 0 ? row.label : row.cells[at - 1]),
  }));
  return (
    <DataTable
      label={t('connectPage.compare.passTable', { max: MAX_COMPARED })}
      tableId="passes"
      labels={labels}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      sort={props.sort}
      onSort={props.onSort}
      isSelected={(row) => row.colour !== null}
      marker={{
        header: null,
        cell: (row) => (row.colour ? <span className={`swatch ${row.colour}`} /> : null),
      }}
      rowProps={(row) => ({
        'data-pr': row.pr ?? false,
        'data-hovered': props.hovered === row.id || undefined,
      })}
      onRowHover={(row) => props.onHover?.(row?.id ?? null)}
      onRowClick={(row, event) => {
        const mode: Mode = event.shiftKey
          ? 'range'
          : event.ctrlKey || event.metaKey
            ? 'toggle'
            : 'single';
        const next = select(
          { ids: props.set.map((entry) => entry.id), anchor: props.anchor },
          order,
          row.id,
          mode
        );
        props.onSelect(next.ids, next.dropped, row.id);
      }}
    />
  );
}
