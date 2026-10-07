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
import { formatLocalDate } from '@/shared/format/format';

const PITCH = HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP;

/** Wednesday 23 September 2026, mid-morning. */
const WEDNESDAY = new Date(2026, 8, 23, 10, 0);

function day(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

describe('heatmap rows are weekdays', () => {
  it('puts every drawn day in the row for its own weekday, Sunday first', () => {
    const positions = cellPositions(WEDNESDAY);

    for (const [date, at] of positions) {
      expect({ date, row: at.y / PITCH }).toEqual({ date, row: day(date).getDay() });
    }
  });

  it('puts today in its weekday row of the newest column', () => {
    expect(cellPositions(WEDNESDAY).get('2026-09-23')).toEqual({
      x: (HEATMAP_WEEKS - 1) * PITCH,
      y: 3 * PITCH,
    });
  });

  it('draws no day after today', () => {
    const positions = cellPositions(WEDNESDAY);

    expect(positions.has('2026-09-24')).toBe(false);
    expect(positions.has('2026-09-26')).toBe(false);
  });

  it('holds a Monday in row 1 of every column', () => {
    const { cells } = heatmapLayout(WEDNESDAY);

    for (const cell of cells.filter((c) => c.row === 1)) {
      expect(day(cell.date).getDay()).toBe(1);
    }
    expect(new Set(cells.filter((c) => c.row === 1).map((c) => c.col)).size).toBe(HEATMAP_WEEKS);
  });
});

describe('heatmap interval', () => {
  it('runs from the Sunday fifty-one weeks before this week to today, one cell a day', () => {
    const layout = heatmapLayout(WEDNESDAY);

    expect(formatLocalDate(layout.first)).toBe('2025-09-28');
    expect(formatLocalDate(layout.last)).toBe('2026-09-23');
    expect(layout.cells).toHaveLength(51 * 7 + 4);
    expect(layout.cells[0].date).toBe('2025-09-28');
    expect(layout.cells[layout.cells.length - 1].date).toBe('2026-09-23');
    expect(new Set(layout.cells.map((c) => c.date)).size).toBe(layout.cells.length);
  });

  it('fills fifty-two whole weeks on a Saturday', () => {
    const layout = heatmapLayout(new Date(2026, 8, 26, 10, 0));

    expect(layout.cells).toHaveLength(HEATMAP_WEEKS * 7);
    expect(formatLocalDate(layout.first)).toBe('2025-09-28');
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
    // On 24 September 2026 column 0 starts on 28 September 2025 and column 1
    // on 5 October, so a September label at column 0 would sit 12 px from October.
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

    expect(layout.januaryBoundary).toEqual({ col: jan1?.col, row: 4 });
  });

  it('is absent when no 1 January is drawn after the first cell', () => {
    // 1 January 2023 is a Sunday, and on 30 December 2023 it is the grid's
    // first cell, so there is no December to its left to separate it from.
    expect(heatmapLayout(new Date(2023, 11, 30, 12, 0)).januaryBoundary).toBeNull();
  });
});

describe('heatmap column year', () => {
  it('names the year of the column at the left of the view', () => {
    const layout = heatmapLayout(new Date(2027, 0, 10, 12, 0));

    expect(columnYear(layout, 0)).toBe(2026);
    expect(columnYear(layout, HEATMAP_WEEKS - 1)).toBe(2027);
  });
});
