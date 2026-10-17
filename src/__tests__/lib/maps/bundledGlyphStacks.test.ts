/**
 * Scenario: a symbol layer, the basemap's own or one the app draws over it,
 * labels itself with a font stack the app does not carry, or in a face other
 * than the app's.
 * Expected behaviour: every symbol layer names a bundled stack, Manrope first
 * with a Noto face behind it for the glyphs Manrope lacks, so the glyphs come
 * off disk in the app's face rather than off the network.
 *
 * With no `text-font` MapLibre uses the style spec's default, `Open Sans
 * Regular, Arial Unicode MS Regular`, which is not a carried stack. The
 * interceptor answers 404 for it and the label draws in the device's own font.
 */
import { BUNDLED_GLYPH_RANGES, BUNDLED_GLYPH_STACKS } from '@/features/maps/lib/bundledGlyphs';
import {
  buildActivityLayers,
  buildFullscreenMatchedRouteLayers,
  buildFullscreenSectionLayers,
} from '@/features/maps/components/activityMapLayerSpecs';
import { buildRegionalLayers } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { resolveStyleForWebView } from '@/features/maps/lib/htmlBuilders/styleResolution';

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
    hasUserLocation: true,
  });
}

function regionalLayers(mapStyle: 'light' | 'dark' | 'satellite'): MapLayerSpec[] {
  return buildRegionalLayers({
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

/** The layers of every basemap style a map page draws under the app's own. */
function basemapLayers(): MapLayerSpec[] {
  return (['light', 'dark', 'satellite'] as const).flatMap((style) => {
    const inline = resolveStyleForWebView(style).inline as { layers?: MapLayerSpec[] } | null;
    return inline?.layers ?? [];
  });
}

/** Every layer set the app hands to a map surface, under the inputs that draw the most. */
function everyBuiltLayer(): MapLayerSpec[] {
  return [
    ...basemapLayers(),
    ...activityLayers(true),
    ...activityLayers(false),
    ...regionalLayers('light'),
    ...regionalLayers('dark'),
    ...regionalLayers('satellite'),
    ...buildFullscreenMatchedRouteLayers(true),
    ...buildFullscreenSectionLayers(true),
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

  it('finds basemap labels among them, so the base style is checked too', () => {
    expect(basemapLayers().some((layer) => layer.layout?.['text-field'] !== undefined)).toBe(true);
  });

  it('names only stacks the app carries', () => {
    // MapLibre asks for a stack as its names joined with commas, which is the
    // directory the bundle keeps it under.
    const foreign = labelledSymbolLayers()
      .map((layer) => ({ id: layer.id, stack: layer.layout?.['text-font'] }))
      .filter(
        ({ stack }) => !Array.isArray(stack) || !BUNDLED_GLYPH_STACKS.includes(stack.join(','))
      )
      .map(({ id, stack }) => `${id}: ${JSON.stringify(stack)}`);
    expect(foreign).toEqual([]);
  });

  it('draws every label in Manrope with a Noto face behind it and none in italic', () => {
    const offFace = labelledSymbolLayers()
      .map((layer) => ({ id: layer.id, stack: layer.layout?.['text-font'] as unknown }))
      .filter(({ stack }) => {
        if (!Array.isArray(stack) || stack.length !== 2) return true;
        const [face, fallback] = stack as string[];
        return (
          !/^Manrope (Regular|SemiBold|Bold)$/.test(face) ||
          !/^Noto Sans (Regular|Bold)$/.test(fallback)
        );
      })
      .map(({ id, stack }) => `${id}: ${JSON.stringify(stack)}`);
    expect(offFace).toEqual([]);
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
