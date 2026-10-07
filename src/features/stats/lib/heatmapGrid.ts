/**
 * Where each day sits in the contribution heatmap.
 *
 * The grid draws [`HEATMAP_WEEKS`] calendar weeks, newest column on the right,
 * one row per weekday with Sunday at the top. The newest column is the week
 * holding today, so its days after today are not drawn.
 *
 * Every reader of the grid's interval takes it from [`heatmapLayout`]: the
 * engine read, the intensities, the header count and range, the month labels,
 * the January boundary and the scrub highlight. They used to work it out one
 * by one, and the read reached a day further back than the first cell.
 */

import { formatLocalDate } from '@/shared/format/format';

export const HEATMAP_WEEKS = 52;
export const HEATMAP_CELL_SIZE = 10;
export const HEATMAP_CELL_GAP = 2;
/** One column's width, cell and gap. */
export const HEATMAP_PITCH = HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP;

/**
 * Columns a month label keeps clear before the next one. A short month name
 * at the label size is wider than one column, and wider still in some
 * languages, so a label one or two columns from the next would run into it.
 */
const LABEL_MIN_COLUMNS = 3;

/** A cell's top-left corner, in the grid's own coordinates. */
export interface CellPosition {
  x: number;
  y: number;
}

/** One drawn day. */
export interface HeatmapCell {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  col: number;
  /** The weekday, Sunday 0. */
  row: number;
}

/** A month name over the first column whose Sunday falls in that month. */
export interface HeatmapMonthLabel {
  col: number;
  /** The first day of the month, for formatting its name. */
  date: Date;
  /** 0 for January. */
  month: number;
  /** Set on January only: the year of every other column is pinned at the left. */
  year?: number | undefined;
}

export interface HeatmapLayout {
  /** The first drawn day, at local midnight. */
  first: Date;
  /** Today, at local midnight. */
  last: Date;
  /** Every drawn day, oldest first. */
  cells: HeatmapCell[];
  monthLabels: HeatmapMonthLabel[];
  /** The cell holding a 1 January with December drawn before it, or null. */
  januaryBoundary: { col: number; row: number } | null;
}

/** Local midnight `days` after `from`, by the calendar rather than by 24 h. */
function addDays(from: Date, days: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
}

/** The Sunday that opens a column. */
function columnSunday(first: Date, col: number): Date {
  return addDays(first, col * 7);
}

export function heatmapLayout(now: Date): HeatmapLayout {
  const last = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisSunday = addDays(last, -last.getDay());
  const first = addDays(thisSunday, -(HEATMAP_WEEKS - 1) * 7);

  const cells: HeatmapCell[] = [];
  let januaryBoundary: HeatmapLayout['januaryBoundary'] = null;
  for (let col = 0; col < HEATMAP_WEEKS; col++) {
    for (let row = 0; row < 7; row++) {
      const date = addDays(first, col * 7 + row);
      if (date > last) break;
      if (date.getMonth() === 0 && date.getDate() === 1 && (col > 0 || row > 0)) {
        januaryBoundary = { col, row };
      }
      cells.push({ date: formatLocalDate(date), col, row });
    }
  }

  const monthLabels: HeatmapMonthLabel[] = [];
  for (let col = 0; col < HEATMAP_WEEKS; col++) {
    const sunday = columnSunday(first, col);
    const previous = col > 0 ? columnSunday(first, col - 1) : null;
    if (previous && previous.getMonth() === sunday.getMonth()) continue;
    const month = sunday.getMonth();
    monthLabels.push({
      col,
      date: new Date(sunday.getFullYear(), month, 1),
      month,
      year: month === 0 ? sunday.getFullYear() : undefined,
    });
  }
  // Column 0 always opens a label, whatever part of its month is left. When
  // the next month starts a column or two later the two would collide, and
  // the partial month is the one to drop.
  if (monthLabels.length > 1 && monthLabels[1].col - monthLabels[0].col < LABEL_MIN_COLUMNS) {
    monthLabels.shift();
  }

  return { first, last, cells, monthLabels, januaryBoundary };
}

/** The year a column belongs to, by the Sunday that opens it. */
export function columnYear(layout: HeatmapLayout, col: number): number {
  const clamped = Math.max(0, Math.min(HEATMAP_WEEKS - 1, col));
  return columnSunday(layout.first, clamped).getFullYear();
}

/** A cell's top-left corner. */
export function cellPosition(col: number, row: number): CellPosition {
  return { x: col * HEATMAP_PITCH, y: row * HEATMAP_PITCH };
}

/**
 * Every day the grid draws, keyed by its local date, mapped to where it is
 * drawn. Built once alongside the intensities, so a scrub tick is one lookup.
 */
export function cellPositions(today: Date): Map<string, CellPosition> {
  return positionsOf(heatmapLayout(today));
}

export function positionsOf(layout: HeatmapLayout): Map<string, CellPosition> {
  const positions = new Map<string, CellPosition>();
  for (const cell of layout.cells) {
    positions.set(cell.date, cellPosition(cell.col, cell.row));
  }
  return positions;
}
