/**
 * Scenario: a section's laps are listed from the performance read and the
 * athlete excludes or includes several at once.
 *
 * Expected behaviour: each lap is one row, newest first. A bulk exclude is one
 * write per lap that is still counted, a bulk include one per lap that is
 * excluded, and the undo of any batch is the inverse writes in reverse order.
 */

import {
  excludeActivities,
  excludeLaps,
  includeLaps,
  lapRows,
  undoOf,
} from '../../../web/connect/sectionLaps';

const lap = (id: string, activityId: string, startIndex: number, excluded = false) => ({
  id,
  activityId,
  time: 100 + startIndex,
  pace: 5,
  distance: 500,
  direction: 'forward',
  startIndex,
  endIndex: startIndex + 50,
  avgHr: null,
  avgPower: null,
  coverage: 1,
  excluded,
  outsideDistanceBand: false,
  matchPercentage: 90,
  isRecord: false,
  estimated: false,
});

const record = (activityId: string, activityDate: number, laps: ReturnType<typeof lap>[]) =>
  ({ activityId, activityName: activityId, activityDate, laps }) as never;

const RECORDS = [
  record('a1', 1_000, [lap('a1-0', 'a1', 10)]),
  record('a2', 3_000, [lap('a2-0', 'a2', 20), lap('a2-1', 'a2', 90, true)]),
  record('a3', 2_000, [lap('a3-0', 'a3', 30)]),
];

describe('the section lap rows', () => {
  it('lists every lap of every activity, newest first, an activity keeping its laps in order', () => {
    expect(lapRows(RECORDS).map((row) => row.id)).toEqual(['a2-0', 'a2-1', 'a3-0', 'a1-0']);
  });

  it('is empty for no records', () => {
    expect(lapRows([])).toEqual([]);
  });
});

describe('the bulk lap edits', () => {
  const rows = lapRows(RECORDS);

  it('excludes each counted lap once and leaves an excluded one alone', () => {
    expect(excludeLaps('s1', rows.slice(0, 3))).toEqual([
      { method: 'section.excludeLap', params: { id: 's1', activityId: 'a2', startIndex: 20 } },
      { method: 'section.excludeLap', params: { id: 's1', activityId: 'a3', startIndex: 30 } },
    ]);
  });

  it('includes only the excluded laps', () => {
    expect(includeLaps('s1', rows)).toEqual([
      { method: 'section.includeLap', params: { id: 's1', activityId: 'a2', startIndex: 90 } },
    ]);
  });

  it('excludes an activity once however many of its laps are chosen', () => {
    expect(excludeActivities('s1', rows.slice(0, 2))).toEqual([
      { method: 'section.excludeActivity', params: { id: 's1', activityId: 'a2' } },
    ]);
  });

  it('undoes a batch with the inverse writes, last first', () => {
    const done = excludeLaps('s1', rows.slice(0, 3));
    expect(undoOf(done)).toEqual([
      { method: 'section.includeLap', params: { id: 's1', activityId: 'a3', startIndex: 30 } },
      { method: 'section.includeLap', params: { id: 's1', activityId: 'a2', startIndex: 20 } },
    ]);
    expect(undoOf(undoOf(done))).toEqual(done);
    expect(undoOf([])).toEqual([]);
  });
});
