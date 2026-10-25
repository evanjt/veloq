/**
 * Scenario: the global map's layers menu keys the heatmap with a ramp labelled
 * fewer to more passes, beside a map whose heat steps are opaque and keyed by
 * base: the light map runs light to dark, the dark and satellite maps dark to
 * light.
 *
 * Expected behaviour: the key shows the five steps the base on screen paints
 * its tiles in, running the way that base runs.
 */

import { heatmapKeyColours } from '@/features/maps/lib/heatmapPaint';
import { mapPalette } from '@/theme';
import type { MapStyleType } from '@/features/maps/components/mapStyles';

function relativeLuminance(colour: string): number {
  const clean = colour.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(clean.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const luminances = (style: MapStyleType) => heatmapKeyColours(style).map(relativeLuminance);

describe('heatmapKeyColours', () => {
  it.each<MapStyleType>(['light', 'dark', 'satellite'])(
    'keys the %s map in the heat steps of that base',
    (style) => {
      expect(heatmapKeyColours(style)).toEqual(mapPalette(style).heat);
    }
  );

  it('darkens with density on the light map', () => {
    const steps = luminances('light');
    expect(steps).toHaveLength(5);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1]);
    }
  });

  it.each<MapStyleType>(['dark', 'satellite'])('lightens with density on the %s map', (style) => {
    const steps = luminances(style);
    expect(steps).toHaveLength(5);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it('writes opaque hex, so a swatch shows the colour the map does', () => {
    for (const colour of heatmapKeyColours('satellite')) {
      expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
