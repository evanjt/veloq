/**
 * Scenario: the route chart's best ring fell back to the fastest traversal of
 * any direction when the engine had not answered yet, while the tooltip beside
 * it marks a best per direction. The two could name different attempts.
 *
 * Expected behaviour: the ring is the fastest forward traversal, matching the
 * engine's own pick and the rule a personal record is written under.
 */

import { chartBestIndex } from '@/features/routes/lib/chartBestIndex';

const point = (sectionTime: number, direction: 'same' | 'reverse' = 'same') => ({
  sectionTime,
  direction,
});

describe('the chart best index', () => {
  it('skips a faster traversal the other way, which is a different effort', () => {
    expect(chartBestIndex([point(500), point(300, 'reverse'), point(420)])).toBe(2);
  });

  it('takes the fastest reverse when nothing went forward', () => {
    expect(chartBestIndex([point(500, 'reverse'), point(300, 'reverse')])).toBe(1);
  });

  it('is the outright fastest when every traversal went forward', () => {
    expect(chartBestIndex([point(500), point(300), point(420)])).toBe(1);
  });

  it('ignores an untimed traversal, which stores zero and compares fastest', () => {
    expect(chartBestIndex([point(0), point(420)])).toBe(1);
  });

  it('answers zero for no points at all, which is what the ring falls back to', () => {
    expect(chartBestIndex([])).toBe(0);
  });

  it('answers zero when every point is untimed, rather than naming one', () => {
    expect(chartBestIndex([point(0), point(0)])).toBe(0);
  });

  it('treats a missing direction as forward, which is how an old row reads', () => {
    expect(chartBestIndex([{ sectionTime: 500 }, { sectionTime: 300 }])).toBe(1);
  });
});
