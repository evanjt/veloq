// A dense table: sticky header, row hover, a sort affordance on sortable
// columns, and right-aligned tabular figures on numeric ones. The sorted column
// carries `aria-sort` and an arrow.

import type { MouseEvent, ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc';

export type Column<Row> = {
  key: string;
  header: string;
  numeric?: boolean;
  sortable?: boolean;
  cell: (row: Row) => ReactNode;
};

export function DataTable<Row>(props: {
  label: string;
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
}) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table" aria-label={props.label}>
        <thead>
          <tr>
            {props.columns.map((column) => {
              const sorted = props.sort?.key === column.key ? props.sort.direction : null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  data-numeric={column.numeric || undefined}
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
          {props.rows.map((row) => {
            const key = props.rowKey(row);
            return (
              <tr
                key={key}
                aria-selected={
                  props.isSelected
                    ? props.isSelected(row)
                    : props.selectedKey === undefined
                      ? undefined
                      : props.selectedKey === key
                }
                data-row={key}
                onClick={props.onRowClick ? (event) => props.onRowClick?.(row, event) : undefined}
                onMouseEnter={props.onRowHover ? () => props.onRowHover?.(row) : undefined}
                onMouseLeave={props.onRowHover ? () => props.onRowHover?.(null) : undefined}
              >
                {props.columns.map((column) => (
                  <td key={column.key} data-numeric={column.numeric || undefined}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
