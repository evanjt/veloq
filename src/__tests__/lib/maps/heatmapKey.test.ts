/**
 * Scenario: the global map's layers menu keys the heatmap with a ramp labelled
 * fewer to more passes, beside the map whose heat paint inverts on the light
 * style.
 *
 * Expected behaviour: the ramp runs the way the layer draws it. On the light
 * map denser ground is darker, on the dark and satellite maps it is lighter,
 * each step judged on the menu ground the ramp sits on.
 */

import { heatmapKeyColours } from '@/features/maps/lib/heatmapPaint';
import { colors, darkColors } from '@/theme';
import type { MapStyleType } from '@/features/maps/components/mapStyles';

function relativeLuminance(colour: string): number {
  const clean = colour.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(clean.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const luminances = (style: MapStyleType, ground: string) =>
  heatmapKeyColours(style, ground).map(relativeLuminance);

describe('heatmapKeyColours', () => {
  it('darkens with density on the light map', () => {
    const steps = luminances('light', colors.surface);
    expect(steps.length).toBeGreaterThan(2);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1]);
    }
  });

  it.each<MapStyleType>(['dark', 'satellite'])('lightens with density on the %s map', (style) => {
    const steps = luminances(style, darkColors.surfaceRaised);
    expect(steps.length).toBeGreaterThan(2);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it('writes opaque hex, so a swatch shows the colour the map does', () => {
    for (const colour of heatmapKeyColours('light', colors.surface)) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
