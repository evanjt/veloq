/**
 * The layers a detail map can draw under its subject: context the athlete turns on from the layers
 * menu. The subject's own sources and layers are built elsewhere; this adds the context beneath
 * them, so the subject's line draws over the heat.
 */
import { colourIndexExpression, type MapBase, type MapPalette } from '@/theme';
import { heatmapRasterPaint } from './heatmapPaint';
import { HEATMAP_SOURCE_ID, heatmapRasterSource } from './heatmapTiles';
import type { MapLayerSpec, MapSourceSpec } from './htmlBuilders/mapSurface';
import {
  MAP_3D_SCALE,
  OVERLAY_EDGE_MARGIN,
  ROUTE_LINE_WIDTHS,
  SECTION_LINE_DASH,
  SECTION_LINE_WIDTHS,
  lineWidthRamp,
} from './mapLineWidths';
import type { MapSubjectSpecs } from './mapSubjectSpecs';
import { routeLinesSourceData } from './routeLineCollection';

export const CONTEXT_SECTIONS_SOURCE_ID = 'context-sections';
export const CONTEXT_ROUTES_SOURCE_ID = 'context-routes';

/** The layers a tap on library context is hit-tested on: the lines, not their outlines. */
export const CONTEXT_SECTIONS_HIT_LAYER_ID = 'context-sections-line';
export const CONTEXT_ROUTES_HIT_LAYER_ID = 'context-routes-line';

/** How a library line layer is drawn under a detail map's subject. */
interface ContextLineInput {
  /** The id of the subject's own section or route, drawn by the subject and left out here. */
  omitId: string | null;
  /** The colours of the base drawn under the layer, which it is drawn for. */
  palette: MapPalette;
  /** The map is tilted over terrain: every width is drawn at `MAP_3D_SCALE`. */
  terrain: boolean;
}

export interface ContextLayerInput {
  /** The heatmap's base and finished tile passes, or null while it is off. */
  heatmap: { base: MapBase; generation: number } | null;
  /** The library's sections as the engine's overlay decoded, or null/absent while off. */
  sections?: (ContextLineInput & { collection: GeoJSON.FeatureCollection }) | null;
  /** The library's route lines at the engine's route generation, or null/absent while off. */
  routes?: (ContextLineInput & { generation: number }) | null;
}

export interface ContextLayerSpecs {
  sources: Record<string, MapSourceSpec>;
  layers: MapLayerSpec[];
}

/**
 * The subject's own line is drawn by the subject, so the library layer leaves it out with a filter
 * on the id rather than a second collection, and the layer is shared by every subject.
 */
function omitSubject(omitId: string | null): { filter?: unknown[] } {
  return omitId === null ? {} : { filter: ['!=', ['get', 'id'], omitId] };
}

/** The route lines under the sections, in the Map tab's styling. */
function routeContextLayers({ omitId, palette, terrain }: ContextLineInput): MapLayerSpec[] {
  const scale = terrain ? MAP_3D_SCALE : 1;
  const layout = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    {
      id: 'context-routes-outline',
      type: 'line',
      source: CONTEXT_ROUTES_SOURCE_ID,
      layout,
      paint: {
        'line-color': palette.edge,
        'line-width': lineWidthRamp(ROUTE_LINE_WIDTHS, OVERLAY_EDGE_MARGIN, scale),
        'line-opacity': 1,
      },
      ...omitSubject(omitId),
    },
    {
      id: CONTEXT_ROUTES_HIT_LAYER_ID,
      type: 'line',
      source: CONTEXT_ROUTES_SOURCE_ID,
      layout,
      paint: {
        'line-color': colourIndexExpression(palette.layer.routes, ['get', 'palette'], true),
        'line-width': lineWidthRamp(ROUTE_LINE_WIDTHS, 0, scale),
        'line-opacity': 0.8,
      },
      ...omitSubject(omitId),
    },
  ];
}

/** The section lines, dashed in each section's own colour, in the Map tab's styling. */
function sectionContextLayers({ omitId, palette, terrain }: ContextLineInput): MapLayerSpec[] {
  const scale = terrain ? MAP_3D_SCALE : 1;
  return [
    {
      id: 'context-sections-outline',
      type: 'line',
      source: CONTEXT_SECTIONS_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': palette.edge,
        'line-width': lineWidthRamp(SECTION_LINE_WIDTHS, OVERLAY_EDGE_MARGIN, scale),
        'line-opacity': 1,
      },
      ...omitSubject(omitId),
    },
    {
      id: CONTEXT_SECTIONS_HIT_LAYER_ID,
      type: 'line',
      source: CONTEXT_SECTIONS_SOURCE_ID,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': lineWidthRamp(SECTION_LINE_WIDTHS, 0, scale),
        'line-dasharray': [...SECTION_LINE_DASH],
        'line-opacity': 0.95,
      },
      ...omitSubject(omitId),
    },
  ];
}

/**
 * The context sources and layers for what is turned on, none for what is off. The heat is lowest,
 * then the route lines, then the section lines, so the order is the Map tab's.
 */
export function contextLayerSpecs({
  heatmap,
  sections,
  routes,
}: ContextLayerInput): ContextLayerSpecs {
  const sources: Record<string, MapSourceSpec> = {};
  const layers: MapLayerSpec[] = [];
  if (heatmap) {
    sources[HEATMAP_SOURCE_ID] = heatmapRasterSource(heatmap.base, heatmap.generation);
    layers.push({
      id: 'heatmap-layer',
      type: 'raster',
      source: HEATMAP_SOURCE_ID,
      paint: heatmapRasterPaint(),
    });
  }
  if (routes) {
    sources[CONTEXT_ROUTES_SOURCE_ID] = {
      kind: 'geojson',
      data: routeLinesSourceData(routes),
    };
    layers.push(...routeContextLayers(routes));
  }
  if (sections) {
    sources[CONTEXT_SECTIONS_SOURCE_ID] = { kind: 'geojson', data: sections.collection };
    layers.push(...sectionContextLayers(sections));
  }
  return { sources, layers };
}

/**
 * `specs` with the context beneath its layers; `specs` itself when nothing is turned on. The
 * context lines are hit-tested after the subject's own layers, so the subject wins a tie, and the
 * sections before the routes, as the Map tab stacks them.
 */
export function withContextLayers(
  specs: MapSubjectSpecs,
  input: ContextLayerInput
): MapSubjectSpecs {
  const context = contextLayerSpecs(input);
  if (context.layers.length === 0) return specs;
  const hitLayers = [
    ...(input.sections ? [CONTEXT_SECTIONS_HIT_LAYER_ID] : []),
    ...(input.routes ? [CONTEXT_ROUTES_HIT_LAYER_ID] : []),
  ];
  return {
    ...specs,
    sources: { ...context.sources, ...specs.sources },
    layers: [...context.layers, ...specs.layers],
    interactiveLayers:
      hitLayers.length === 0
        ? specs.interactiveLayers
        : [...(specs.interactiveLayers ?? []), ...hitLayers],
  };
}
