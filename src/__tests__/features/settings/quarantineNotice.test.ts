/**
 * Scenario: a database that could not be opened is renamed aside and a fresh
 * one takes its place. The athlete opens the app to an empty feed, an empty
 * routes tab and a sync starting from nothing, which reads as a first install
 * and as their history being gone. Their sections, ledger, pins and
 * suppressions all came across and nothing says so.
 *
 * Expected behaviour: the notice names only what was actually kept. A count of
 * zero is left out rather than printed, because "0 pins kept" reads as a loss
 * to an athlete who never had one, and a report with nothing in it produces no
 * notice at all.
 */

import { quarantineNoticeParts } from '@/features/settings/lib/quarantineNotice';

const none = { history: 0, geometry: 0, pins: 0, sections: 0, intents: 0 };

describe('quarantineNoticeParts', () => {
  it('is nothing when there was no quarantine', () => {
    expect(quarantineNoticeParts(null)).toBeNull();
  });

  it('is nothing when the rebuild rescued nothing', () => {
    // The log line already records it. A notice with no good news in it is a
    // scare for a fault the app recovered from.
    expect(quarantineNoticeParts(none)).toBeNull();
  });

  it('names only the counts that are not zero', () => {
    expect(quarantineNoticeParts({ ...none, sections: 14, history: 92 })).toEqual([
      { key: 'sections', count: 14 },
      { key: 'history', count: 92 },
    ]);
  });

  it('keeps a fixed order, so the sentence does not reshuffle between athletes', () => {
    const all = { history: 1, geometry: 2, pins: 3, sections: 4, intents: 5 };
    expect(quarantineNoticeParts(all)?.map((p) => p.key)).toEqual([
      'sections',
      'history',
      'geometry',
      'pins',
      'intents',
    ]);
  });

  it("leads with the athlete's own sections, which is what they would miss", () => {
    expect(quarantineNoticeParts({ ...none, pins: 3, sections: 1 })?.[0]).toEqual({
      key: 'sections',
      count: 1,
    });
  });

  it('treats a missing or negative count as nothing kept', () => {
    expect(quarantineNoticeParts({ ...none, sections: -1 })).toBeNull();
    expect(quarantineNoticeParts({ ...none, sections: Number.NaN })).toBeNull();
  });
});
