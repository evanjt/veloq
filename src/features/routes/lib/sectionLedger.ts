/**
 * Reading the section ledger: dates, and the chip ids its rows name.
 */

import type { FfiSectionEventDetails } from 'veloqrs';

/** The details of a row that stored none. */
export const NO_EVENT_DETAILS: FfiSectionEventDetails = {
  around: [],
  forkAround: [],
  prs: [],
  siblings: [],
  splitInto: [],
  boundaries: [],
};

/**
 * The ledger kinds whose label is one fixed string. `split`, `reverted` and
 * `reference_anchored` need a count, a version or the row's details to word.
 */
export const FIXED_LABEL_LEDGER_KINDS: ReadonlySet<string> = new Set([
  'formed',
  'restored',
  'recut',
  'dissolved',
  'merged',
  'superseded',
  'pr_rebased',
  'baseline',
  'reference_reanchored',
  'name_released',
  'name_taken',
  'algorithm_changed',
  'trimmed',
  'expanded',
  'bounds_reset',
  'reference_set',
  'reference_reset',
  'accepted',
  'renamed',
  'absorbed',
]);

/** The ledger writes SQLite datetimes in UTC without a zone marker. */
export function ledgerDate(at: string): Date {
  return new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`);
}

/** A change, as much of one as the chip ids need. */
interface ChipSource {
  details?: FfiSectionEventDetails | undefined;
}

/**
 * Every activity id the history panel will draw a chip for, once each and in
 * the order they appear.
 *
 * Capped per row, the way the panel caps its own rows, so a section with
 * hundreds of traversals does not ask the engine for names nothing will draw.
 */
export function ledgerChipIds(history: ChipSource[], maxPerList: number): string[] {
  const seen = new Set<string>();
  for (const event of history) {
    const details = event.details ?? NO_EVENT_DETAILS;
    for (const id of details.around.slice(0, maxPerList)) seen.add(id);
  }
  return [...seen];
}
