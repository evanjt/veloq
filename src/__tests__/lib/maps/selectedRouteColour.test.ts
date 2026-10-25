/**
 * Scenario: the selected activity's line on the global map switches from its
 * sport colour to a fallback while the heatmap is drawn underneath it. The
 * switch read whether the heatmap was available, not whether it was on the map,
 * so an athlete who hid the heatmap on the map still got the fallback.
 *
 * Expected behaviour: the fallback only while the heatmap is actually drawn,
 * and the fallback is the base map's own ink, which its casing is drawn for.
 */

import {
  buildRegionalLayers,
  selectedRouteColor,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { mapPalette } from '@/theme';

const SPORT = '#3B82F6';
const palette = mapPalette('light');

describe('the selected line colour on the global map', () => {
  it('is the sport colour when the heatmap is hidden on the map', () => {
    expect(selectedRouteColor(SPORT, { enabled: true, shown: false }, palette)).toBe(SPORT);
  });

  it('is the sport colour when the heatmap is off in settings', () => {
    expect(selectedRouteColor(SPORT, { enabled: false, shown: false }, palette)).toBe(SPORT);
    expect(selectedRouteColor(SPORT, { enabled: false, shown: true }, palette)).toBe(SPORT);
  });

  it.each(['light', 'dark', 'satellite'] as const)(
    'switches to the %s base map ink while the heatmap is drawn',
    (base) => {
      const drawn = mapPalette(base);
      expect(selectedRouteColor(SPORT, { enabled: true, shown: true }, drawn)).toBe(drawn.ink);
    }
  );
});

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const selectedOutline = (base: 'light' | 'dark' | 'satellite', showHeatmap: boolean) =>
  buildRegionalLayers({
    palette: mapPalette(base),
    showActivities: true,
    showSections: false,
    showRoutes: false,
    showHeatmap,
    heatmapEnabled: true,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: true,
    selectedActivityId: 'a1',
    selectedSectionId: null,
    routeColor: SPORT,
  }).find((l) => l.id === 'selected-route-outline')?.paint?.['line-color'] as string;

describe('the selected line against its casing', () => {
  it.each(['light', 'dark', 'satellite'] as const)(
    'has an opaque casing and a 3:1 line over the heatmap on %s',
    (base) => {
      const line = selectedRouteColor(SPORT, { enabled: true, shown: true }, mapPalette(base));
      const casing = selectedOutline(base, true);
      expect(casing).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(contrast(line, casing)).toBeGreaterThanOrEqual(3);
    }
  );

  it('edges a sport-coloured line when the heatmap is hidden', () => {
    expect(selectedOutline('light', false)).toBe(mapPalette('light').edge);
  });
});
