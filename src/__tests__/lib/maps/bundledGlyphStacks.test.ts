/**
 * Scenario: a symbol layer the app draws over the basemap labels itself with a
 * font stack the app does not carry.
 * Expected behaviour: every symbol layer names a stack from the bundled set, so
 * the glyphs come off disk rather than off the network.
 *
 * With no `text-font` MapLibre uses the style spec's default, `Open Sans
 * Regular, Arial Unicode MS Regular`, which is not one of the three carried
 * stacks. The interceptor answers 404 for it and the label draws in the
 * device's own font.
 */
import { BUNDLED_GLYPH_RANGES, BUNDLED_GLYPH_STACKS } from '@/features/maps/lib/bundledGlyphs';
import {
  buildActivityLayers,
  buildFullscreenSectionLayers,
} from '@/features/maps/components/activityMapLayerSpecs';
import { buildRegionalLayers } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';

function activityLayers(creationMode: boolean): MapLayerSpec[] {
  return buildActivityLayers({
    overlayHasData: true,
    activityColor: '#123456',
    gradientActive: false,
    gradientLineExpression: null,
    hasSectionOverlays: true,
    highlightedSectionId: 'section-1',
    hasHighlightPoint: true,
    creationMode,
  });
}

function regionalLayers(mapStyle: 'light' | 'dark' | 'satellite'): MapLayerSpec[] {
  return buildRegionalLayers({
    isDark: mapStyle === 'dark',
    mapStyle,
    showActivities: true,
    showSections: true,
    showRoutes: false,
    showHeatmap: true,
    heatmapEnabled: true,
    hasSpider: true,
    hasUserLocation: true,
    hasRouteData: true,
    selectedActivityId: 'activity-1',
    selectedSectionId: 'section-1',
    routeColor: '#123456',
  });
}

/** Every layer set the app hands to a map surface, under the inputs that draw the most. */
function everyBuiltLayer(): MapLayerSpec[] {
  return [
    ...activityLayers(true),
    ...activityLayers(false),
    ...regionalLayers('light'),
    ...regionalLayers('dark'),
    ...regionalLayers('satellite'),
    ...buildFullscreenSectionLayers(true, true),
  ];
}

function labelledSymbolLayers(): MapLayerSpec[] {
  return everyBuiltLayer().filter(
    (layer) => layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined
  );
}

describe('bundled glyph stacks', () => {
  it('finds the symbol layers to check, so an empty pass is not a pass', () => {
    expect(labelledSymbolLayers().length).toBeGreaterThan(0);
  });

  it('names a text-font on every symbol layer that draws text', () => {
    const missing = labelledSymbolLayers()
      .filter((layer) => layer.layout?.['text-font'] === undefined)
      .map((layer) => layer.id);
    expect(missing).toEqual([]);
  });

  it('names only stacks the app carries', () => {
    const foreign = labelledSymbolLayers().flatMap((layer) => {
      const stacks = layer.layout?.['text-font'];
      if (!Array.isArray(stacks)) return [];
      return stacks
        .filter((stack) => !BUNDLED_GLYPH_STACKS.includes(stack as string))
        .map((stack) => `${layer.id}: ${String(stack)}`);
    });
    expect(foreign).toEqual([]);
  });
});

/** The 256-wide blocks the bundled ranges cover, as `start-end` names them. */
const carriedBlocks = new Set(
  BUNDLED_GLYPH_RANGES.map((range) => Number(range.split('-')[0]) / 256)
);

/** Every string a `text-field` expression can put on screen. */
function literalsIn(field: unknown): string[] {
  if (typeof field === 'string') return [field];
  if (!Array.isArray(field)) return [];
  // `['get', 'label']` reads a feature property, whose text is not known here.
  if (field[0] === 'get') return [];
  return field.flatMap(literalsIn);
}

describe('bundled glyph ranges', () => {
  it('labels only with codepoints the app carries', () => {
    const outside = labelledSymbolLayers().flatMap((layer) =>
      literalsIn(layer.layout?.['text-field'])
        .flatMap((literal) => [...literal])
        .filter((char) => !carriedBlocks.has(Math.floor((char.codePointAt(0) ?? 0) / 256)))
        .map((char) => `${layer.id}: U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`)
    );
    expect(outside).toEqual([]);
  });
});
