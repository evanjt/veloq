/**
 * Scenario: the activity hero map draws up to six round buttons down its right edge.
 *
 * Expected behaviour: the column never runs past the hero, wrapping into a second column when the
 * buttons do not fit, and the footprint it reports is the width the hero's text must leave clear.
 */

import { layout, spacing } from '@/theme';
import {
  MAX_MAP_CONTROLS,
  mapControlColumnLayout,
} from '@/features/maps/lib/mapControlColumnLayout';

const SMALLEST_HERO = Math.round(560 * 0.42);
const TOP = 48;
const BUTTON = layout.minTapTarget;

describe('mapControlColumnLayout', () => {
  it('keeps every button inside the hero at the smallest hero height with six buttons', () => {
    const result = mapControlColumnLayout(MAX_MAP_CONTROLS, SMALLEST_HERO, TOP);
    expect(TOP + result.maxHeight).toBeLessThanOrEqual(SMALLEST_HERO);
    const perColumn = Math.floor((result.maxHeight + spacing.sm) / (BUTTON + spacing.sm));
    expect(perColumn * result.columns).toBeGreaterThanOrEqual(MAX_MAP_CONTROLS);
  });

  it('uses one column when the buttons fit', () => {
    const result = mapControlColumnLayout(3, 600, TOP);
    expect(result.columns).toBe(1);
    expect(result.footprint).toBe(layout.cardMargin + BUTTON + spacing.sm);
  });

  it('widens the footprint by one button and gap per extra column', () => {
    const one = mapControlColumnLayout(1, 600, TOP);
    const two = mapControlColumnLayout(MAX_MAP_CONTROLS, SMALLEST_HERO, TOP);
    expect(two.footprint).toBe(one.footprint + (two.columns - 1) * (BUTTON + spacing.sm));
  });

  it('reserves nothing for no buttons', () => {
    expect(mapControlColumnLayout(0, 300, TOP).footprint).toBe(0);
  });
});
