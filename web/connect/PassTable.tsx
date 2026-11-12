// A section's pass table or a route's attempt table: one row per pass, the
// same shift-click and ctrl-click selection as the feed, and a swatch in the
// compare colour on every selected row.

import { useTranslation } from 'react-i18next';

import {
  MAX_COMPARED,
  passTableRows,
  select,
  type Compared,
  type Mode,
  type PassRow,
} from './compare';
import { clock } from './format';

export type PassTableRow = PassRow & { label: string };

export function PassTable(props: {
  rows: readonly PassTableRow[];
  set: readonly Compared[];
  anchor: string | null;
  /** Told the new selection, and the ids a fifth selection dropped. */
  onSelect: (ids: string[], dropped: string[], anchor: string) => void;
}) {
  const { t } = useTranslation();
  const order = props.rows.map((row) => row.id);
  return (
    <table id="pass-table" aria-label={t('connectPage.compare.passTable', { max: MAX_COMPARED })}>
      <tbody>
        {passTableRows(props.rows, props.set).map((row) => (
          <tr
            key={row.id}
            data-row={row.id}
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
            <td>{row.elapsed == null ? '' : clock(row.elapsed)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
