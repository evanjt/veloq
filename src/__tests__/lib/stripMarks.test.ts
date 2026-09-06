/**
 * Scenario: the strip under the fitness plot drew one fixed-size dot per day,
 * eight points wide on three and a half points of spacing at 3M and on under
 * one point at 1Y, coloured by whichever activity the array held first.
 *
 * Expected behaviour: one mark per day scaled by the day's load and stacked by
 * sport share, marks that never overlap, weeks once a day has under three
 * points, and nothing for a day that did nothing.
 */

import { stripMarks, DAY_SPACING_FLOOR, MIN_MARK_HEIGHT } from '@/features/fitness/lib/stripMarks';
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

describe('stripMarks', () => {
  it('draws 91 days as 91 marks that do not overlap', () => {
    const marks = stripMarks(
      days(91, () => [{ type: 'Ride', load: 50 }]),
      WIDTH
    );
    expect(marks).toHaveLength(91);
    expect(marks.every((m) => m.dates.length === 1)).toBe(true);
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].x).toBeGreaterThanOrEqual(marks[i - 1].x + marks[i - 1].width);
    }
    expect(marks[0].x).toBeGreaterThanOrEqual(0);
    expect(marks[90].x + marks[90].width).toBeLessThanOrEqual(WIDTH);
  });

  it('folds a year into seven-day marks once a day has under three points', () => {
    expect(WIDTH / 364).toBeLessThan(DAY_SPACING_FLOOR);
    const marks = stripMarks(
      days(365, () => [{ type: 'Run', load: 40 }]),
      WIDTH
    );
    expect(marks).toHaveLength(53);
    expect(marks[0].dates).toHaveLength(7);
    expect(marks[52].dates).toHaveLength(1);
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].x).toBeGreaterThanOrEqual(marks[i - 1].x + marks[i - 1].width);
    }
  });

  it('stacks a mixed day by load share with the larger sport first, equal on a tie', () => {
    const [mixed, tied] = stripMarks(
      [
        day(0, [
          { type: 'WeightTraining', load: 30 },
          { type: 'Ride', load: 80 },
        ]),
        day(1, [
          { type: 'Run', load: 40 },
          { type: 'Ride', load: 40 },
        ]),
      ],
      WIDTH
    );
    expect(mixed.segments.map((s) => [s.type, s.fraction])).toEqual([
      ['Ride', 80 / 110],
      ['WeightTraining', 30 / 110],
    ]);
    expect(tied.segments.map((s) => s.fraction)).toEqual([0.5, 0.5]);
  });

  it('is tallest on the heaviest day, clips the outlier, and shows a loaded-but-unmeasured day', () => {
    const marks = stripMarks(
      [
        day(0, [{ type: 'Ride', load: 40 }]),
        day(1, [{ type: 'Ride', load: 60 }]),
        day(2, [{ type: 'Ride', load: 374 }]),
        day(3, [{ type: 'Walk', load: 0 }]),
        day(4),
      ],
      WIDTH
    );
    expect(marks.map((m) => m.dates[0])).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
    const [d40, d60, d374, walk] = marks;
    expect(d374.height).toBe(1);
    expect(d60.height).toBe(1);
    expect(d40.height).toBeCloseTo(40 / 60);
    expect(walk.height).toBe(MIN_MARK_HEIGHT);
    expect(walk.segments).toEqual([{ type: 'Walk', fraction: 1 }]);
  });

  it('draws nothing for no days, no width, or a window that never trained', () => {
    expect(stripMarks([], WIDTH)).toEqual([]);
    expect(
      stripMarks(
        days(10, () => [{ type: 'Ride', load: 1 }]),
        0
      )
    ).toEqual([]);
    expect(
      stripMarks(
        days(10, () => []),
        WIDTH
      )
    ).toEqual([]);
  });
});
