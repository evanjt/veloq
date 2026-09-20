/**
 * Where each day sits in the contribution heatmap.
 *
 * The grid draws the last [`HEATMAP_WEEKS`] weeks, newest column on the right,
 * with the day of the week down each column. Both the intensity array and the
 * scrub highlight address the same cells, so the mapping lives here rather than
 * being written out twice: the highlight used to re-walk the whole year,
 * building a `Date` and formatting it per cell, on every index a scrub crossed.
 */

import { formatLocalDate } from '@/shared/format/format';

export const HEATMAP_WEEKS = 52;
export const HEATMAP_CELL_SIZE = 10;
export const HEATMAP_CELL_GAP = 2;

/** A cell's top-left corner, in the grid's own coordinates. */
export interface CellPosition {
  x: number;
  y: number;
}

/** How many days back a cell sits, by its column and row. */
export function daysBack(week: number, day: number): number {
  return week * 7 + (6 - day);
}

/**
 * Every day the grid draws, keyed by its local date, mapped to where it is
 * drawn. Built once alongside the intensities, so a scrub tick is one lookup.
 */
export function cellPositions(today: Date): Map<string, CellPosition> {
  const positions = new Map<string, CellPosition>();
  for (let w = HEATMAP_WEEKS - 1; w >= 0; w--) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - daysBack(w, d));
      const col = HEATMAP_WEEKS - 1 - w;
      positions.set(formatLocalDate(date), {
        x: col * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP),
        y: d * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP),
      });
    }
  }
  return positions;
}
