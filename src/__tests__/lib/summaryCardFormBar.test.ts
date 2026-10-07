/**
 * Scenario: with form as a percentage of fitness, the summary card's hero zones
 * a day on that percentage while the bar drawn under it zoned the same day on
 * absolute TSB. Fitness 40 and TSB -8 is -20 per cent, optimal, and the bar
 * drew it grey, as did every divider between days.
 *
 * Expected behaviour: each day's bar and each divider zone that day's form
 * against that day's fitness, the way the hero and the widget do.
 */

import { FORM_ZONE_MARK_COLORS, getFormZone } from '@/features/fitness/lib/fitness';
import { formBarLayout } from '@/features/home/lib/formBar';

describe('the summary card form bar', () => {
  it('zones -8 on fitness 40 as optimal under the percentage, grey without it', () => {
    expect(formBarLayout([-8], [40], true, 100).rects[0].zone).toBe('optimal');
    expect(formBarLayout([-8], [40], false, 100).rects[0].zone).toBe('greyZone');
  });

  it('pairs each day with its own fitness', () => {
    // -8 on 40 is -20 per cent, -8 on 100 is -8 per cent. Read against the
    // wrong day's fitness the two would swap zones.
    const { rects } = formBarLayout([-8, -8], [40, 100], true, 100);

    expect(rects.map((r) => r.zone)).toEqual([
      getFormZone(-8, 40, true),
      getFormZone(-8, 100, true),
    ]);
    expect(rects.map((r) => r.zone)).toEqual(['optimal', 'greyZone']);
  });

  it('puts a divider where the percentage zone changes and none where only the absolute one would', () => {
    // Days 0 and 1 are both optimal as a percentage (-20 and -25 per cent) but
    // grey then optimal in absolute terms. Day 2 is grey as a percentage.
    const form = [-8, -12, -2];
    const fitness = [40, 48, 40];

    const asPercent = formBarLayout(form, fitness, true, 100).transitions;
    const absolute = formBarLayout(form, fitness, false, 100).transitions;

    expect(asPercent).toEqual([75]);
    expect(absolute).toEqual([25, 75]);
  });

  it('draws no zone on a day with no fitness under the percentage setting', () => {
    const { rects } = formBarLayout([-8], [0], true, 100);

    expect(rects[0].zone).toBeNull();
    expect(rects[0].color).toBe('transparent');
  });

  it('keeps the absolute band on that day with the setting off', () => {
    expect(formBarLayout([-8], [0], false, 100).rects[0].zone).toBe('greyZone');
  });

  it('lays the bars edge to edge across the width', () => {
    const { rects } = formBarLayout([1, 2, 3], [10, 10, 10], false, 100);

    expect(rects[0].x).toBe(0);
    expect(rects[2].x + rects[2].width - 0.5).toBe(100);
  });

  it('draws each zone in its mark tone, the one that holds 3:1 on the card', () => {
    // One day in each zone, as absolute form on a fitness of 100.
    const form = [-40, -20, 0, 10, 30];
    const fitness = [100, 100, 100, 100, 100];
    const { rects } = formBarLayout(form, fitness, false, 100);

    expect(new Set(rects.map((r) => r.zone)).size).toBe(5);
    for (const rect of rects) {
      expect(rect.color).toBe(FORM_ZONE_MARK_COLORS[rect.zone!]);
    }
  });
});
