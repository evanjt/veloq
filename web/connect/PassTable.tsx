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

export type PassTableRow = PassRow & {
  /** The row's own header cell: what the pass is called. */
  label: ReactNode;
  /** The cells after the label, one per column the page's head names. */
  cells: ReactNode[];
  /** Marks the row for the page's emphasis, such as the fastest pass. */
  pr?: boolean;
};

export function PassTable(props: {
  rows: readonly PassTableRow[];
  set: readonly Compared[];
  anchor: string | null;
  /** The header cells after the swatch column, one per column of `cells`. */
  head: ReactNode;
  /** Told the new selection, and the ids a fifth selection dropped. */
  onSelect: (ids: string[], dropped: string[], anchor: string) => void;
}) {
  const { t } = useTranslation();
  const order = props.rows.map((row) => row.id);
  return (
    <table id="passes" aria-label={t('connectPage.compare.passTable', { max: MAX_COMPARED })}>
      <thead>
        <tr>
          <th scope="col" />
          {props.head}
        </tr>
      </thead>
      <tbody>
        {passTableRows(props.rows, props.set).map((row) => (
          <tr
            key={row.id}
            data-row={row.id}
            data-pr={row.pr ?? false}
            aria-selected={row.colour !== null}
            onClick={(event) => {
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
          >
            <td>{row.colour ? <span className={`swatch ${row.colour}`} /> : null}</td>
            <th scope="row">{row.label}</th>
            {row.cells.map((cell, at) => (
              <td key={at}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
