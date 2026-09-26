/**
 * Scenario: five memo comparators each kept their own list of fields, and each
 * list was missing the ones that change. A sync landed, the feed rendered, and
 * the cards went on showing the pre-sync values; a re-detected section kept its
 * old polyline on screen because its visit count had not moved.
 *
 * Expected behaviour: the record is the comparison. A field list can only ever
 * be missing one, and the data arrives through React Query, whose structural
 * sharing keeps an unchanged row's reference.
 */

import { rowIsUnchanged } from '@/shared/ui/rowMemo';

const record = { id: 'a1', name: 'Morning Ride' };

describe('when a row can skip its render', () => {
  it('skips when the record and every extra are the same', () => {
    expect(rowIsUnchanged({ record, extras: [1, true] }, { record, extras: [1, true] })).toBe(true);
  });

  /**
   * The defect: a body the detail sync enriched keeps the same id and the same
   * name, and every field the old comparator looked at.
   */
  it('renders when the record moved, whatever its named fields say', () => {
    const enriched = { id: 'a1', name: 'Morning Ride' };

    expect(rowIsUnchanged({ record, extras: [] }, { record: enriched, extras: [] })).toBe(false);
  });

  it('renders when an extra moved', () => {
    expect(rowIsUnchanged({ record, extras: [1] }, { record, extras: [2] })).toBe(false);
  });

  it('renders when the extras are not even the same shape', () => {
    expect(rowIsUnchanged({ record, extras: [1] }, { record, extras: [1, 2] })).toBe(false);
  });
});
