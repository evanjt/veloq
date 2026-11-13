/**
 * Scenario: the routes and sections pages keep their sort, search, chips and
 * selected row in the address, and ask the engine for the list they name.
 *
 * Expected behaviour: each sort and chip becomes the engine query the phone's
 * own list sends; the address round-trips every state and drops what is at its
 * default; the pass table orders by date, time and gap to the fastest pass and
 * marks that pass.
 */

import {
  CHIPS,
  ROUTE_SORTS,
  SECTION_SORTS,
  fromRoute,
  opening,
  passes,
  pressed,
  queryFor,
  toRoute,
  toggled,
  type ListState,
  type SectionRow,
} from '../../../web/connect/routesList';
import { parse, write } from '../../../web/connect/router';

describe('the engine query', () => {
  vaultIt('asks each sections order by its name and leaves routes at the default', () => {
    const asked = SECTION_SORTS.map((sort) => queryFor({ ...opening('sections'), sort }));
    expect(asked.map((query) => query.sectionSort)).toEqual([
      'visits',
      'signature',
      'distance',
      'name',
      'nearby',
    ]);
    expect(new Set(asked.map((query) => query.groupSort))).toEqual(new Set(['activities']));
  });

  vaultIt('asks each routes order by its name and leaves sections at the default', () => {
    const asked = ROUTE_SORTS.map((sort) => queryFor({ ...opening('routes'), sort }));
    expect(asked.map((query) => query.groupSort)).toEqual([
      'activities',
      'distance',
      'name',
      'nearby',
    ]);
    expect(new Set(asked.map((query) => query.sectionSort))).toEqual(new Set(['visits']));
  });

  vaultIt('puts the search on the list it is typed in', () => {
    expect(queryFor({ ...opening('routes'), search: 'loop' })).toMatchObject({
      groupSearch: 'loop',
      sectionSearch: '',
    });
    expect(queryFor({ ...opening('sections'), search: 'col' })).toMatchObject({
      groupSearch: '',
      sectionSearch: 'col',
    });
  });

  vaultIt('hides the removed sections until the chip shows them, as the phone does', () => {
    expect(queryFor(opening('sections')).sectionFilters).toEqual({
      hideCustom: false,
      hideAuto: false,
      hideDisabled: true,
      hideUnaccepted: false,
    });
    const all = CHIPS.reduce(toggled, opening('sections'));
    expect(queryFor(all).sectionFilters).toEqual({
      hideCustom: false,
      hideAuto: true,
      hideDisabled: false,
      hideUnaccepted: true,
    });
  });

  vaultIt('sends no place, so the engine reads its default', () => {
    expect(queryFor(opening('routes'))).not.toHaveProperty('userLat');
  });
});

describe('the address', () => {
  const states: ListState[] = [
    opening('routes'),
    opening('sections'),
    { ...opening('routes'), sort: 'name', search: 'loop & climb' },
    {
      kind: 'sections',
      sort: 'signature',
      search: 'col',
      chips: ['custom', 'accepted'],
      selected: null,
      ids: [],
    },
    { ...opening('sections', 's/1'), chips: ['removed'] },
    { ...opening('sections', 's1'), ids: ['p1', 'x,y'] },
    opening('routes', 'g 7'),
  ];

  vaultIt.each(states.map((state) => [JSON.stringify(state), state] as const))(
    'round-trips %s through the hash',
    (_name, state) => {
      expect(fromRoute(parse(write(toRoute(state))))).toEqual(state);
    }
  );

  vaultIt('leaves a value at its default out of the address', () => {
    expect(write(toRoute(opening('sections')))).toBe('#/sections');
    expect(write(toRoute(opening('routes', 'g1')))).toBe('#/route/g1');
  });

  vaultIt('falls back on an order or chip the list does not have', () => {
    const route = parse('#/routes?sort=signature&chips=custom');
    expect(fromRoute(route)).toEqual(opening('routes'));
    expect(fromRoute(parse('#/sections?sort=activities'))?.sort).toBe('visits');
  });

  vaultIt('names no list for another screen', () => {
    expect(fromRoute(parse('#/feed'))).toBeNull();
  });

  vaultIt('turns a chip off by pressing it again', () => {
    const on = toggled(opening('sections'), 'custom');
    expect(on.chips).toEqual(['custom']);
    expect(toggled(on, 'custom').chips).toEqual([]);
  });
});

describe('the pass table', () => {
  const row = (activityId: string, startTime: number, movingTime: number): SectionRow => ({
    activityId,
    name: activityId,
    sportType: 'Ride',
    startTime,
    distance: 400,
    movingTime,
    averageSpeed: 400 / movingTime,
  });
  const rows = [row('a', 300, 70), row('b', 100, 60), row('c', 200, 65)];
  const ids = (order: Parameters<typeof passes>[1]) => passes(rows, order).map((p) => p.activityId);

  vaultIt('orders by date, time and gap, either way', () => {
    expect(ids({ column: 'date', descending: true })).toEqual(['a', 'c', 'b']);
    expect(ids({ column: 'date', descending: false })).toEqual(['b', 'c', 'a']);
    expect(ids({ column: 'time', descending: false })).toEqual(['b', 'c', 'a']);
    expect(ids({ column: 'delta', descending: true })).toEqual(['a', 'c', 'b']);
  });

  it('marks the fastest pass and measures the others against it', () => {
    const table = passes(rows, { column: 'time', descending: false });
    expect(table.map((p) => [p.activityId, p.delta, p.pr])).toEqual([
      ['b', 0, true],
      ['c', 5, false],
      ['a', 10, false],
    ]);
  });

  vaultIt('marks every pass tied for fastest and handles no passes', () => {
    const tied = passes([row('x', 1, 50), row('y', 2, 50)], { column: 'date', descending: false });
    expect(tied.every((p) => p.pr && p.delta === 0)).toBe(true);
    expect(passes([], { column: 'time', descending: false })).toEqual([]);
  });

  vaultIt('opens date newest first and time fastest first, then reverses on a second press', () => {
    const date = pressed({ column: 'time', descending: false }, 'date');
    expect(date).toEqual({ column: 'date', descending: true });
    expect(pressed(date, 'date')).toEqual({ column: 'date', descending: false });
    expect(pressed(date, 'time')).toEqual({ column: 'time', descending: false });
  });
});
