/**
 * Where each day sits in the contribution heatmap.
 *
 * The grid draws the calendar weeks from the first day the device holds to the
 * week holding today, at most [`HEATMAP_WEEKS`] of them, newest column on the
 * right, one row per weekday with Monday at the top. The engine's fitness read
 * names that first day, so a library holding 90 days draws 13 weeks rather
 * than a year whose older weeks read as no training. A column is the Monday to Sunday
 * week every weekly total counts, from `getMonday`, so the grid and the weekly
 * charts agree on what a week held. The newest column is the week holding
 * today, so its days after today are not drawn.
 *
 * Every reader of the grid's interval takes it from [`heatmapLayout`]: the
 * engine read, the intensities, the header count and range, the month labels,
 * the January boundary and the scrub highlight. They used to work it out one
 * by one, and the read reached a day further back than the first cell.
 */

import { formatLocalDate, getMonday } from '@/shared/format/format';

/** The most weeks the grid draws, and the span it asks the engine for at most. */
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
  /** The weekday, Monday 0 and Sunday 6. */
  row: number;
}

/** A month name over the first column whose Monday falls in that month. */
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
  /** The columns drawn, 1 to [`HEATMAP_WEEKS`]. */
  weeks: number;
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

/** The Monday that opens a column. */
function columnMonday(first: Date, col: number): Date {
  return addDays(first, col * 7);
}

/**
 * The grid from the week holding `firstDay` to the week holding `now`, at most
 * [`HEATMAP_WEEKS`] weeks; with no first day, the most it draws.
 */
export function heatmapLayout(now: Date, firstDay?: Date): HeatmapLayout {
  const last = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const newestMonday = getMonday(last);
  const weeks = firstDay ? weeksFrom(firstDay, newestMonday) : HEATMAP_WEEKS;
  const first = addDays(newestMonday, -(weeks - 1) * 7);

  const cells: HeatmapCell[] = [];
  let januaryBoundary: HeatmapLayout['januaryBoundary'] = null;
  for (let col = 0; col < weeks; col++) {
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
  for (let col = 0; col < weeks; col++) {
    const monday = columnMonday(first, col);
    const previous = col > 0 ? columnMonday(first, col - 1) : null;
    if (previous && previous.getMonth() === monday.getMonth()) continue;
    const month = monday.getMonth();
    monthLabels.push({
      col,
      date: new Date(monday.getFullYear(), month, 1),
      month,
      year: month === 0 ? monday.getFullYear() : undefined,
    });
  }
  // Column 0 always opens a label, whatever part of its month is left. When
  // the next month starts a column or two later the two would collide, and
  // the partial month is the one to drop.
  if (monthLabels.length > 1 && monthLabels[1].col - monthLabels[0].col < LABEL_MIN_COLUMNS) {
    monthLabels.shift();
  }

  return { first, last, weeks, cells, monthLabels, januaryBoundary };
}

/** The columns from the week holding `firstDay` to `newestMonday`'s, 1 to the cap. */
function weeksFrom(firstDay: Date, newestMonday: Date): number {
  const oldest = getMonday(firstDay);
  // Whole days by the calendar, rounded across a clock change.
  const days = Math.round(
    (Date.UTC(newestMonday.getFullYear(), newestMonday.getMonth(), newestMonday.getDate()) -
      Date.UTC(oldest.getFullYear(), oldest.getMonth(), oldest.getDate())) /
      86_400_000
  );
  return Math.max(1, Math.min(HEATMAP_WEEKS, Math.floor(days / 7) + 1));
}

/** The year a column belongs to, by the Monday that opens it. */
export function columnYear(layout: HeatmapLayout, col: number): number {
  const clamped = Math.max(0, Math.min(layout.weeks - 1, col));
  return columnMonday(layout.first, clamped).getFullYear();
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
