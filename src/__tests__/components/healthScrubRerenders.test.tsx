/**
 * Scenario: a Health tab scrub fires one index per day crossed, up to 365 on
 * the `1y` range. Each tick re-rendered the whole screen, rebuilt the weekly
 * summary object so its memo recomputed, and walked 364 `formatLocalDate` calls
 * to find one cell, all against an 8.3 ms frame.
 *
 * Expected behaviour: the summary object is the same reference while its query
 * data is, and the highlighted cell is a map lookup rather than a scan.
 */

import {
  cellPositions,
  HEATMAP_CELL_SIZE,
  HEATMAP_CELL_GAP,
} from '@/features/stats/lib/heatmapGrid';
import { formatLocalDate } from '@/shared/format/format';

describe('health scrub re-renders', () => {
  it('places every day of the year it draws', () => {
    const today = new Date('2026-09-12T10:00:00');

    const positions = cellPositions(today);

    expect(positions.size).toBe(52 * 7);
    expect(positions.has(formatLocalDate(today))).toBe(true);
  });

  /**
   * The scan this replaces built a Date and formatted it per cell, per tick.
   * The map is built once with the grid, so a tick is one lookup.
   */
  it('answers for a highlighted day without walking the grid', () => {
    const today = new Date('2026-09-12T10:00:00');
    const positions = cellPositions(today);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const at = positions.get(formatLocalDate(yesterday));

    expect(at).toEqual({
      x: 51 * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP),
      y: 5 * (HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP),
    });
  });

  /** A day outside the year drawn has no cell, and must not read as the first. */
  it('has no cell for a day outside the year it draws', () => {
    const today = new Date('2026-09-12T10:00:00');

    expect(cellPositions(today).get('2020-01-01')).toBeUndefined();
  });
});
