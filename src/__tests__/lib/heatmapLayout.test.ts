/**
 * The activity calendar's grid: which day each cell holds, where the month
 * labels sit and where January begins. Every reader of the grid's interval
 * takes it from here, so these are the calendar's invariants.
 */

import {
  cellPositions,
  columnYear,
  heatmapLayout,
  HEATMAP_CELL_GAP,
  HEATMAP_CELL_SIZE,
  HEATMAP_WEEKS,
} from '@/features/stats/lib/heatmapGrid';
import { formatLocalDate, getMonday } from '@/shared/format/format';

const PITCH = HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP;

/** Wednesday 23 September 2026, mid-morning. */
const WEDNESDAY = new Date(2026, 8, 23, 10, 0);

function day(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Monday 0 to Sunday 6. */
function isoRow(date: Date): number {
  return (date.getDay() + 6) % 7;
}

describe('heatmap rows are weekdays', () => {
  it('puts every drawn day in the row for its own weekday, Monday first', () => {
    const positions = cellPositions(WEDNESDAY);

    for (const [date, at] of positions) {
      expect({ date, row: at.y / PITCH }).toEqual({ date, row: isoRow(day(date)) });
    }
  });

  it('puts today in its weekday row of the newest column', () => {
    expect(cellPositions(WEDNESDAY).get('2026-09-23')).toEqual({
      x: (HEATMAP_WEEKS - 1) * PITCH,
      y: 2 * PITCH,
    });
  });

  it('draws no day after today', () => {
    const positions = cellPositions(WEDNESDAY);

    expect(positions.has('2026-09-24')).toBe(false);
    expect(positions.has('2026-09-26')).toBe(false);
  });

  it('holds a Monday in row 0 of every column', () => {
    const { cells } = heatmapLayout(WEDNESDAY);

    for (const cell of cells.filter((c) => c.row === 0)) {
      expect(day(cell.date).getDay()).toBe(1);
    }
    expect(new Set(cells.filter((c) => c.row === 0).map((c) => c.col)).size).toBe(HEATMAP_WEEKS);
  });
});

describe('heatmap columns are the weeks the weekly totals count', () => {
  it('puts a Sunday in the column of the Monday six days before it', () => {
    const positions = cellPositions(new Date(2026, 9, 4, 10, 0));
    const sunday = positions.get('2026-10-04');
    const monday = positions.get('2026-09-28');

    expect(sunday?.x).toBe(monday?.x);
    expect(positions.get('2026-09-27')?.x).toBe((sunday?.x ?? 0) - PITCH);
  });

  it('opens the newest column on the Monday of the week holding today', () => {
    for (let offset = 0; offset < 14; offset++) {
      const today = new Date(2026, 8, 21 + offset, 10, 0);
      const { cells } = heatmapLayout(today);
      const newest = cells.filter((c) => c.col === HEATMAP_WEEKS - 1);

      expect(newest[0]).toMatchObject({ date: formatLocalDate(getMonday(today)), row: 0 });
    }
  });
});

describe('heatmap interval', () => {
  it('runs from the Monday fifty-one weeks before this week to today, one cell a day', () => {
    const layout = heatmapLayout(WEDNESDAY);

    expect(formatLocalDate(layout.first)).toBe('2025-09-29');
    expect(formatLocalDate(layout.last)).toBe('2026-09-23');
    expect(layout.cells).toHaveLength(51 * 7 + 3);
    expect(layout.cells[0].date).toBe('2025-09-29');
    expect(layout.cells[layout.cells.length - 1].date).toBe('2026-09-23');
    expect(new Set(layout.cells.map((c) => c.date)).size).toBe(layout.cells.length);
  });

  it('fills fifty-two whole weeks on a Sunday', () => {
    const layout = heatmapLayout(new Date(2026, 8, 27, 10, 0));

    expect(layout.cells).toHaveLength(HEATMAP_WEEKS * 7);
    expect(formatLocalDate(layout.first)).toBe('2025-09-29');
  });

  it('keeps one cell a day across a clock change', () => {
    const layout = heatmapLayout(new Date(2026, 9, 28, 10, 0));
    const dates = layout.cells.map((c) => c.date);

    for (let i = 1; i < dates.length; i++) {
      const gap = (day(dates[i]).getTime() - day(dates[i - 1]).getTime()) / 86_400_000;
      expect(Math.round(gap)).toBe(1);
    }
  });
});

describe('heatmap month labels', () => {
  it('keeps every label at least three columns from the next, on every day of a year', () => {
    const crowded: string[] = [];
    for (let offset = 0; offset < 366; offset++) {
      const today = new Date(2027, 0, 1 + offset, 12, 0);
      const labels = heatmapLayout(today).monthLabels;
      for (let i = 1; i < labels.length; i++) {
        if (labels[i].col - labels[i - 1].col < 3) {
          crowded.push(`${formatLocalDate(today)}: columns ${labels[i - 1].col}, ${labels[i].col}`);
        }
      }
    }

    expect(crowded).toEqual([]);
  });

  it('drops the leftmost month when the next one starts a column later', () => {
    // On 24 September 2026 column 0 starts on 29 September 2025 and column 1
    // on 6 October, so a September label at column 0 would sit 12 px from October.
    const labels = heatmapLayout(new Date(2026, 8, 24, 10, 0)).monthLabels;

    expect(labels[0]).toMatchObject({ col: 1, month: 9 });
  });

  it('carries a year on January only', () => {
    const labels = heatmapLayout(WEDNESDAY).monthLabels;

    expect(labels.filter((l) => l.year !== undefined)).toEqual([
      expect.objectContaining({ month: 0, year: 2026 }),
    ]);
  });
});

describe('heatmap January boundary', () => {
  it('is the cell holding 1 January', () => {
    const layout = heatmapLayout(WEDNESDAY);
    const jan1 = layout.cells.find((c) => c.date === '2026-01-01');

    expect(layout.januaryBoundary).toEqual({ col: jan1?.col, row: 3 });
  });

  it('is absent when no 1 January is drawn after the first cell', () => {
    // 1 January 2024 is a Monday, and on 28 December 2024 it is the grid's
    // first cell, so there is no December to its left to separate it from.
    const layout = heatmapLayout(new Date(2024, 11, 28, 12, 0));

    expect(layout.cells[0].date).toBe('2024-01-01');
    expect(layout.januaryBoundary).toBeNull();
  });
});

describe('heatmap column year', () => {
  it('names the year of the column at the left of the view', () => {
    const layout = heatmapLayout(new Date(2027, 0, 10, 12, 0));

    expect(columnYear(layout, 0)).toBe(2026);
    expect(columnYear(layout, HEATMAP_WEEKS - 1)).toBe(2027);
  });
});
