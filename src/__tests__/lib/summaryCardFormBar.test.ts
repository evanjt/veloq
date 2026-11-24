/**
 * Scenario: the summary card's bar under the sparkline draws one rect per day,
 * in the zone the engine judged for that day, and a divider where two days
 * differ.
 *
 * Expected behaviour: each rect takes its day's engine zone, a day with no
 * zone draws nothing, a divider sits only between days whose zones differ,
 * and the rects run edge to edge across the width.
 */

import { formBarLayout } from '@/features/home/lib/formBar';

describe('the summary card form bar', () => {
  it('takes each day its own zone', () => {
    const { rects } = formBarLayout(['optimal', 'greyZone'], 100);

    expect(rects.map((r) => r.zone)).toEqual(['optimal', 'greyZone']);
  });

  it('puts a divider where the zone changes and none between days in one zone', () => {
    const { transitions } = formBarLayout(['optimal', 'optimal', 'greyZone'], 100);

    expect(transitions).toEqual([75]);
  });

  it('draws no zone on a day the engine judged none', () => {
    const { rects } = formBarLayout([null], 100);

    expect(rects[0].zone).toBeNull();
  });

  it('lays the bars edge to edge across the width', () => {
    const { rects } = formBarLayout(['fresh', 'fresh', 'fresh'], 100);

    expect(rects[0].x).toBe(0);
    expect(rects[2].x + rects[2].width - 0.5).toBe(100);
  });

  it('lays out one rect per day when each sits in another zone', () => {
    const { rects } = formBarLayout(
      ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'],
      100
    );

    expect(new Set(rects.map((r) => r.zone)).size).toBe(5);
  });
});
