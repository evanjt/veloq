/**
 * Scenario: the selected activity's line on the global map switches from its
 * sport colour to a fallback while the heatmap is drawn underneath it. The
 * switch read whether the heatmap was available, not whether it was on the map,
 * so an athlete who hid the heatmap on the map still got the fallback.
 *
 * Expected behaviour: the fallback only while the heatmap is actually drawn.
 */

import {
  HEATMAP_ROUTE_COLOR,
  buildRegionalLayers,
  selectedRouteColor,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';

const SPORT = '#3B82F6';

describe('the selected line colour on the global map', () => {
  it('is the sport colour when the heatmap is hidden on the map', () => {
    expect(selectedRouteColor(SPORT, { enabled: true, shown: false })).toBe(SPORT);
  });

  it('is the sport colour when the heatmap is off in settings', () => {
    expect(selectedRouteColor(SPORT, { enabled: false, shown: false })).toBe(SPORT);
    expect(selectedRouteColor(SPORT, { enabled: false, shown: true })).toBe(SPORT);
  });

  it('switches to the heatmap fallback while the heatmap is drawn', () => {
    expect(selectedRouteColor(SPORT, { enabled: true, shown: true })).toBe(HEATMAP_ROUTE_COLOR);
  });
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

describe('the selected line against its casing', () => {
  const basemaps = [
    { isDark: false, mapStyle: 'light' as const },
    { isDark: true, mapStyle: 'dark' as const },
  ];

  it.each(basemaps)('has an opaque casing and a 3:1 line on $mapStyle', (basemap) => {
    const layers = buildRegionalLayers({
      ...basemap,
      showActivities: true,
      showSections: false,
      showRoutes: false,
      showHeatmap: true,
      heatmapEnabled: true,
      hasSpider: false,
      hasUserLocation: false,
      hasRouteData: true,
      selectedActivityId: 'a1',
      selectedSectionId: null,
      routeColor: HEATMAP_ROUTE_COLOR,
    });
    const casing = layers.find((l) => l.id === 'selected-route-outline');
    const color = casing?.paint?.['line-color'] as string;
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(contrast(HEATMAP_ROUTE_COLOR, color)).toBeGreaterThanOrEqual(3);
  });
});
