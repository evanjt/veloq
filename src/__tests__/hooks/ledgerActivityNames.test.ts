/**
 * Scenario: the section history panel draws up to six chips per change, and a
 * long-lived section carries many changes.
 *
 * Expected behaviour: one read covers every chip on the screen, asking only
 * for the ids that are actually drawn.
 */

import { ledgerChipIds, NO_EVENT_DETAILS } from '@/features/routes/lib/sectionLedger';
import type { FfiSectionEventDetails } from 'veloqrs';
import type { SectionHistoryEvent } from '@/features/routes/hooks/useSectionLedger';

const event = (id: number, details: Partial<FfiSectionEventDetails>): SectionHistoryEvent => ({
  id,
  at: '2026-08-20 00:00:00',
  kind: 'recut',
  details: { ...NO_EVENT_DETAILS, ...details },
  geometryVersion: null,
});

describe('ledgerChipIds', () => {
  it('gathers the ids off every change and leaves the fork list, which is not drawn', () => {
    const history = [
      event(1, { around: ['a', 'b'], forkAround: ['f'] }),
      event(2, { around: ['c'] }),
    ];

    expect(ledgerChipIds(history, 6)).toEqual(['a', 'b', 'c']);
  });

  it('asks for each id once, however many changes name it', () => {
    const history = [event(1, { around: ['a', 'b'] }), event(2, { around: ['b', 'a'] })];

    expect(ledgerChipIds(history, 6)).toEqual(['a', 'b']);
  });

  it('asks only for the ids the panel draws', () => {
    const history = [event(1, { around: ['a', 'b', 'c', 'd'] })];

    expect(ledgerChipIds(history, 2)).toEqual(['a', 'b']);
  });

  it('caps each change on its own, not the whole history', () => {
    const history = [event(1, { around: ['a', 'b', 'c'] }), event(2, { around: ['d', 'e', 'f'] })];

    expect(ledgerChipIds(history, 2)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('reads nothing out of a change with no details', () => {
    const history: SectionHistoryEvent[] = [
      { id: 1, at: '2026-08-20 00:00:00', kind: 'formed', details: undefined, geometryVersion: 1 },
    ];

    expect(ledgerChipIds(history, 6)).toEqual([]);
  });
});
