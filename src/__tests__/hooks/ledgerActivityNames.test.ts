/**
 * Scenario: the section history panel draws up to six chips per change, and a
 * long-lived section carries many changes.
 *
 * Expected behaviour: one read covers every chip on the screen, asking only
 * for the ids that are actually drawn.
 */

import { ledgerChipIds } from '@/features/routes/lib/sectionLedger';
import type { SectionHistoryEvent } from '@/features/routes/hooks/useSectionLedger';

const event = (id: number, details: Record<string, unknown>): SectionHistoryEvent => ({
  id,
  at: '2026-08-20 00:00:00',
  kind: 'recut',
  details: JSON.stringify(details),
  geometryVersion: null,
});

describe('ledgerChipIds', () => {
  it('gathers the ids off every change, around and fork alike', () => {
    const history = [
      event(1, { around: ['a', 'b'], fork_around: ['f'] }),
      event(2, { around: ['c'] }),
    ];

    expect(ledgerChipIds(history, 6)).toEqual(['a', 'b', 'f', 'c']);
  });

  it('asks for each id once, however many changes name it', () => {
    const history = [event(1, { around: ['a', 'b'] }), event(2, { around: ['b', 'a'] })];

    expect(ledgerChipIds(history, 6)).toEqual(['a', 'b']);
  });

  it('asks only for the ids the panel draws', () => {
    const history = [event(1, { around: ['a', 'b', 'c', 'd'] })];

    expect(ledgerChipIds(history, 2)).toEqual(['a', 'b']);
  });

  it('caps each list on its own, not the whole change', () => {
    const history = [event(1, { around: ['a', 'b', 'c'], fork_around: ['f', 'g', 'h'] })];

    expect(ledgerChipIds(history, 2)).toEqual(['a', 'b', 'f', 'g']);
  });

  it('reads nothing out of a change with no details', () => {
    const history: SectionHistoryEvent[] = [
      { id: 1, at: '2026-08-20 00:00:00', kind: 'formed', details: undefined, geometryVersion: 1 },
    ];

    expect(ledgerChipIds(history, 6)).toEqual([]);
  });

  it('reads nothing out of details that will not parse', () => {
    const history: SectionHistoryEvent[] = [
      { id: 1, at: '2026-08-20 00:00:00', kind: 'recut', details: 'not json', geometryVersion: 1 },
    ];

    expect(ledgerChipIds(history, 6)).toEqual([]);
  });
});
