/**
 * Scenario: the strip under the fitness plot grouped dates into sevens past a
 * width threshold and scaled each mark by a window percentile of load, so the
 * same day drew differently at different ranges.
 *
 * Expected behaviour: one constant-height mark per active date at every
 * range, sports in equal portions in a stable order whatever their load,
 * marks bound to the date slot so they never overlap, and nothing for rest.
 */

import { stripMarks, stripKey, markFills, MARK_HEIGHT } from '@/features/fitness/lib/stripMarks';
import type { StripDay } from '@/features/fitness/lib/stripMarks';
import type { ActivityType } from '@/types';

const WIDTH = 324;

function day(n: number, activities: { type: ActivityType; load: number }[] = []): StripDay {
  const d = new Date(Date.UTC(2026, 5, 1 + n));
  return { date: d.toISOString().slice(0, 10), activities };
}

function days(count: number, at: (n: number) => StripDay['activities']): StripDay[] {
  return Array.from({ length: count }, (_, n) => day(n, at(n)));
}

function expectInBoundsWithoutOverlap(marks: ReturnType<typeof stripMarks>, width: number) {
  for (let i = 0; i < marks.length; i++) {
    expect(marks[i].x).toBeGreaterThanOrEqual(0);
    expect(marks[i].x + marks[i].width).toBeLessThanOrEqual(width + 1e-9);
    if (i > 0) {
      expect(marks[i].x).toBeGreaterThanOrEqual(marks[i - 1].x + marks[i - 1].width - 1e-9);
    }
  }
}

describe('stripMarks', () => {
  it('draws 91 days as 91 one-date marks that do not overlap', () => {
    const marks = stripMarks(
      days(91, () => [{ type: 'Ride', load: 50 }]),
      WIDTH
    );
    expect(marks).toHaveLength(91);
    expect(marks.every((m) => m.dates.length === 1)).toBe(true);
    expectInBoundsWithoutOverlap(marks, WIDTH);
  });

  it('draws a year as one mark per date, never folded into weeks', () => {
    const marks = stripMarks(
      days(365, () => [{ type: 'Run', load: 40 }]),
      WIDTH
    );
    expect(marks).toHaveLength(365);
    expect(marks.every((m) => m.dates.length === 1)).toBe(true);
    expectInBoundsWithoutOverlap(marks, WIDTH);
  });

  it('keeps four active dates as four daily marks at 365 dates', () => {
    const loads = [40, 60, 374, 0];
    const window = days(365, (n) => (n < 4 ? [{ type: 'Ride', load: loads[n] }] : []));
    const marks = stripMarks(window, WIDTH);
    expect(marks.map((m) => m.dates)).toEqual([
      ['2026-06-01'],
      ['2026-06-02'],
      ['2026-06-03'],
      ['2026-06-04'],
    ]);
    expectInBoundsWithoutOverlap(marks, WIDTH);
  });

  it('draws the same height whatever the load, the window or the width', () => {
    const heights = [
      stripMarks([day(0, [{ type: 'Ride', load: 40 }])], WIDTH),
      stripMarks([day(0, [{ type: 'Ride', load: 4000 }])], 100),
      stripMarks(
        [day(0, [{ type: 'Ride', load: 5 }]), day(1, [{ type: 'Ride', load: 900 }])],
        WIDTH
      ),
      stripMarks(
        days(365, (n) => [{ type: 'Ride', load: n === 0 ? 1 : 500 }]),
        WIDTH
      ),
    ].map((marks) => marks[0].height);
    expect(heights).toEqual([MARK_HEIGHT, MARK_HEIGHT, MARK_HEIGHT, MARK_HEIGHT]);
  });

  it('gives distinct sports equal portions in a stable order, whatever their load', () => {
    const [a, b] = stripMarks(
      [
        day(0, [
          { type: 'WeightTraining', load: 30 },
          { type: 'Ride', load: 800 },
          { type: 'Run', load: 0 },
        ]),
        day(1, [
          { type: 'Run', load: 1 },
          { type: 'Ride', load: 1 },
          { type: 'WeightTraining', load: 500 },
        ]),
      ],
      WIDTH
    );
    const expected = ['Ride', 'Run', 'WeightTraining'].map((type) => ({
      type,
      fraction: 1 / 3,
    }));
    expect(a.segments).toEqual(expected);
    expect(b.segments).toEqual(expected);
    expect(a.noLoad).toBe(false);
  });

  it('does not weight a sport by how many activities it has', () => {
    const [mark] = stripMarks(
      [
        day(0, [
          { type: 'Ride', load: 50 },
          { type: 'Ride', load: 50 },
          { type: 'Ride', load: 50 },
          { type: 'Run', load: 50 },
        ]),
      ],
      WIDTH
    );
    expect(mark.segments).toEqual([
      { type: 'Ride', fraction: 0.5 },
      { type: 'Run', fraction: 0.5 },
    ]);
  });

  it('draws no mark for a rest day', () => {
    const marks = stripMarks([day(0, [{ type: 'Ride', load: 40 }]), day(1), day(2)], WIDTH);
    expect(marks.map((m) => m.dates[0])).toEqual(['2026-06-01']);
  });

  it('draws a single day inside the bounds, capped in width', () => {
    const marks = stripMarks([day(0, [{ type: 'Ride', load: 40 }])], WIDTH);
    expect(marks).toHaveLength(1);
    expectInBoundsWithoutOverlap(marks, WIDTH);
    expect(marks[0].width).toBeLessThanOrEqual(6);
  });

  it('draws nothing for no days, no or negative width, or a window that never trained', () => {
    const trained = days(10, () => [{ type: 'Ride', load: 1 }]);
    expect(stripMarks([], WIDTH)).toEqual([]);
    expect(stripMarks(trained, 0)).toEqual([]);
    expect(stripMarks(trained, -5)).toEqual([]);
    expect(
      stripMarks(
        days(10, () => []),
        WIDTH
      )
    ).toEqual([]);
  });
});

/**
 * Scenario: an athlete whose device reports no training load. Every day's
 * load is zero, so no sport can be told from another by load.
 *
 * Expected behaviour: a day that trained without load says so, is drawn in
 * the muted neutral at the same height as any other active day, and is never
 * drawn as a load the athlete did not record.
 */
describe('a group that trained without load', () => {
  const MUTED = '#muted';
  const colorOf = (type: ActivityType) => `#${type}`;

  it('is marked as carrying no load, in a window that has none at all', () => {
    const marks = stripMarks(
      days(10, () => [{ type: 'Ride', load: 0 }]),
      WIDTH
    );

    expect(marks).toHaveLength(10);
    expect(marks.every((m) => m.noLoad)).toBe(true);
  });

  it('is marked in a window where other groups do carry load', () => {
    const marks = stripMarks(
      [
        day(0, [{ type: 'Ride', load: 60 }]),
        day(1, [{ type: 'Walk', load: 0 }]),
        day(2, [{ type: 'Run', load: 30 }]),
      ],
      WIDTH
    );

    expect(marks.map((m) => m.noLoad)).toEqual([false, true, false]);
  });

  it('draws once, in the muted neutral, rather than as a sport at the floor', () => {
    const [mark] = stripMarks([day(0, [{ type: 'Walk', load: 0 }])], WIDTH);

    expect(mark.height).toBe(MARK_HEIGHT);
    expect(markFills(mark, MUTED, colorOf)).toEqual([{ color: MUTED, fraction: 1 }]);
  });

  it('mutes every mark when no group in the window carries load', () => {
    const marks = stripMarks(
      [
        day(0, [{ type: 'Ride', load: 0 }]),
        day(1, [{ type: 'Run', load: 0 }]),
        day(2, [{ type: 'Walk', load: 0 }]),
      ],
      WIDTH
    );

    expect(marks).toHaveLength(3);
    expect(marks.every((m) => m.noLoad)).toBe(true);
    expect(marks.every((m) => m.height === MARK_HEIGHT)).toBe(true);
    // The window an athlete whose device reports no load sees always. Every
    // bar the same height is honest only while none of them is a sport colour.
    for (const mark of marks) {
      expect(markFills(mark, MUTED, colorOf)).toEqual([{ color: MUTED, fraction: 1 }]);
    }
  });

  it('does not invent a split across the sports it holds', () => {
    const [mark] = stripMarks(
      [
        day(0, [
          { type: 'Ride', load: 0 },
          { type: 'Walk', load: 0 },
        ]),
      ],
      WIDTH
    );

    expect(markFills(mark, MUTED, colorOf)).toHaveLength(1);
  });

  it('draws a date that did carry load by its sports in equal portions', () => {
    const [mark] = stripMarks(
      [
        day(0, [
          { type: 'Ride', load: 30 },
          { type: 'Run', load: 10 },
        ]),
      ],
      WIDTH
    );

    expect(mark.noLoad).toBe(false);
    expect(markFills(mark, MUTED, colorOf)).toEqual([
      { color: '#Ride', fraction: 0.5 },
      { color: '#Run', fraction: 0.5 },
    ]);
  });
});

describe('stripKey', () => {
  it('lists the sports the marks draw in colour, in name order, once each', () => {
    const key = stripKey([
      day(0, [{ type: 'Run', load: 30 }]),
      day(1, [
        { type: 'Ride', load: 60 },
        { type: 'Run', load: 10 },
      ]),
      day(2),
      day(3, [{ type: 'Run', load: 20 }]),
    ]);

    expect(key.sports).toEqual(['Ride', 'Run']);
    expect(key.noLoad).toBe(false);
  });

  it('names only the sport that appears for a single-sport window', () => {
    const key = stripKey(days(5, (n) => (n % 2 ? [{ type: 'Swim', load: 40 }] : [])));

    expect(key.sports).toEqual(['Swim']);
  });

  it('flags the neutral state without naming a sport that only trained without load', () => {
    const key = stripKey([
      day(0, [{ type: 'Ride', load: 50 }]),
      day(1, [{ type: 'Walk', load: 0 }]),
    ]);

    expect(key.sports).toEqual(['Ride']);
    expect(key.noLoad).toBe(true);
  });

  it('is empty for a window of rest days', () => {
    expect(stripKey(days(4, () => []))).toEqual({ sports: [], noLoad: false });
  });
});
