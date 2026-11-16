/**
 * Scenario: the sections page keeps its sort, search, filters, selection and
 * retired view in the address, and draws the engine's list and retired reads
 * as rows.
 *
 * Expected behaviour: an address read and written again is the same view, a
 * value at its default is left out, a sort the page does not offer falls back
 * to the opening one, and a retired section lists what took its ground.
 */

import { OPENING, listRows, retiredRows, routeOf, viewOf } from '../../../web/connect/sectionsList';
import type { Route } from '../../../web/connect/router';

const at = (query: [string, string][]): Route => ({ screen: 'sections', id: null, query });

describe('the sections view in the address', () => {
  it('opens on the visits order with nothing searched, filtered or selected', () => {
    expect(viewOf(at([]))).toEqual(OPENING);
    expect(routeOf(OPENING)).toEqual(at([]));
  });

  it('reads back what it wrote', () => {
    const view = {
      sort: 'distance',
      search: 'col du',
      chips: ['custom', 'accepted'] as const,
      selected: 's2',
      retired: false,
    };
    const written = routeOf({ ...view, chips: [...view.chips] });
    expect(written.query).toEqual([
      ['ssort', 'distance'],
      ['sq', 'col du'],
      ['chips', 'custom,accepted'],
      ['selected', 's2'],
    ]);
    expect(viewOf(written)).toEqual({ ...view, chips: [...view.chips] });
  });

  it('writes the retired view and reads it back', () => {
    const written = routeOf({ ...OPENING, retired: true });
    expect(written.query).toEqual([['view', 'retired']]);
    expect(viewOf(written).retired).toBe(true);
  });

  it('falls back to the opening order for a sort no list offers and ignores an unknown chip', () => {
    const view = viewOf(
      at([
        ['ssort', 'nearby-ish'],
        ['chips', 'custom,bogus'],
      ])
    );
    expect(view.sort).toBe(OPENING.sort);
    expect(view.chips).toEqual(['custom']);
  });
});

const ROW = (over: object) => ({
  id: 's1',
  name: 'Col',
  visitCount: 4,
  distanceMeters: 1200,
  avgGradePercent: 5.4,
  trend: 0.3,
  latestIsRecord: false,
  isUserDefined: false,
  disabled: false,
  isLift: false,
  ...over,
});

describe('the sections list rows', () => {
  it('carries each status the engine reports, and none it does not', () => {
    const rows = listRows({
      sections: [
        ROW({}),
        ROW({ id: 's2', isUserDefined: true, latestIsRecord: true, isLift: true }),
        ROW({ id: 's3', disabled: true, name: null, avgGradePercent: null, trend: null }),
      ],
    } as never);
    expect(rows.map((row) => row.status)).toEqual([[], ['custom', 'lift', 'record'], ['removed']]);
    expect(rows[2]).toMatchObject({ name: null, grade: null, trend: null });
    expect(rows[0]).toMatchObject({ id: 's1', passes: 4, distance: 1200, grade: 5.4, trend: 0.3 });
  });

  it('is empty for no screen', () => {
    expect(listRows(null)).toEqual([]);
  });
});

describe('the retired rows', () => {
  const data = {
    retired: [
      {
        section: {
          sectionId: 'old',
          kind: 'merged',
          at: '2026-01-02T03:04:05',
          into: 'new',
          versions: [1],
          name: 'Short climb',
          distanceMeters: 400,
          visitCount: 6,
          restorableVersion: 1,
        },
        encodedPolyline: null,
      },
    ],
    current: [
      { id: 'new', name: 'Long climb' },
      { id: 'other', name: null },
    ],
    pairs: [
      { retiredId: 'old', currentId: 'new', link: 'supersedes', overlap: 0.74 },
      { retiredId: 'old', currentId: 'other', link: 'shares', overlap: 0.2 },
    ],
    pairsPending: false,
  };

  it('names what took the ground, by the current section it went to and its overlap', () => {
    const [row] = retiredRows(data as never);
    expect(row).toMatchObject({
      id: 'old',
      name: 'Short climb',
      kind: 'merged',
      date: '2026-01-02',
    });
    expect(row.tookGround).toEqual([
      { id: 'new', name: 'Long climb', overlap: 0.74 },
      { id: 'other', name: null, overlap: 0.2 },
    ]);
    expect(row.restorable).toBe(true);
  });

  it('is empty for no read', () => {
    expect(retiredRows(null)).toEqual([]);
  });
});
