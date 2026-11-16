// What the section page draws in its map: the section, its passes and the
// selected ones as the routes page draws them, and the merge candidates as
// lines of their own, the one the pointer is on lit. Pure, so a test drives it
// without a renderer.

import type { MapSurfaceSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';

import type { LatLng } from '../fit';
import type { PageBase } from './style';
import { COMPARE_COLOURS, type LngLat } from './activityLayers';
import type { Span } from '../sectionBounds';
import { sectionDetailSpec } from './routeLayers';

export type CandidateLine = { id: string; points: readonly LatLng[] };

/** The candidates as one FeatureCollection of lines keyed by section id; a line of fewer than two points is left out. */
export function candidateCollection(lines: readonly CandidateLine[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lines
      .filter((line) => line.points.length >= 2)
      .map((line) => ({
        type: 'Feature' as const,
        id: line.id,
        properties: { id: line.id },
        geometry: {
          type: 'LineString' as const,
          coordinates: line.points.map(([lat, lng]) => [lng, lat]),
        },
      })),
  };
}

const ROUND = { 'line-cap': 'round', 'line-join': 'round' } as const;

/** The spec with each stored version's line drawn dashed beneath the section's own line. */
function withVersions(
  spec: MapSurfaceSpec,
  sectionId: string,
  versions: readonly number[]
): MapSurfaceSpec {
  if (versions.length === 0) return spec;
  const sources = { ...spec.sources };
  const drawn: MapSurfaceSpec['layers'] = [];
  for (const version of versions) {
    const id = `section-version-${version}`;
    sources[id] = {
      kind: 'geojson',
      data: `veloq://geo/section-version/${encodeURIComponent(`${version}:${sectionId}`)}`,
    };
    drawn.push({
      id,
      type: 'line',
      source: id,
      layout: { ...ROUND },
      paint: {
        'line-color': COMPARE_COLOURS['line-1'] ?? '#3a86ff',
        'line-width': 4,
        'line-opacity': 0.8,
        'line-dasharray': [1, 1.5],
      },
    });
  }
  const at = spec.layers.findIndex((layer) => layer.id === 'section');
  const layers = [...spec.layers];
  layers.splice(at < 0 ? layers.length : at, 0, ...drawn);
  return { ...spec, sources, layers };
}

/**
 * The section's own spec with the merge candidates laid over it. With no
 * candidates the spec is the routes page's own, unchanged.
 */
export function sectionMapSpec(
  base: PageBase,
  sectionId: string,
  hoveredActivity: string | null,
  selected: readonly string[],
  candidates: readonly CandidateLine[],
  litCandidate: string | null,
  versions: readonly number[] = []
): MapSurfaceSpec {
  const spec = withVersions(
    sectionDetailSpec(base, sectionId, hoveredActivity, selected),
    sectionId,
    versions
  );
  if (candidates.length === 0) return spec;
  return {
    ...spec,
    sources: {
      ...spec.sources,
      candidates: { kind: 'geojson', data: candidateCollection(candidates) },
    },
    layers: [
      ...spec.layers,
      {
        id: 'candidates',
        type: 'line',
        source: 'candidates',
        layout: { ...ROUND },
        paint: {
          'line-color': COMPARE_COLOURS['line-3'] ?? '#66a182',
          'line-width': 3,
          'line-opacity': 0.8,
          'line-dasharray': [2, 1],
        },
      },
      {
        id: 'candidate-lit',
        type: 'line',
        source: 'candidates',
        layout: { ...ROUND },
        filter: ['==', ['get', 'id'], litCandidate ?? ''],
        paint: { 'line-color': COMPARE_COLOURS['line-2'] ?? '#edae49', 'line-width': 6 },
      },
    ],
    interactiveLayers: [...(spec.interactiveLayers ?? []), 'candidates'],
  };
}

/** The track a section's ends are dragged along, and which part of it the ends keep. */
export type BoundsEditorView = {
  /** Every vertex of the track the ends run along. */
  path: readonly LngLat[];
  /** The part of the track drawn, which the ends cannot leave. */
  window: Span;
  /** The vertices kept, both ends inclusive. */
  span: Span;
};

const slice = (path: readonly LngLat[], span: Span): LngLat[] =>
  path.slice(Math.max(0, span.start), span.end + 1) as LngLat[];

const lineOf = (positions: readonly LngLat[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features:
    positions.length < 2
      ? []
      : [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: positions as LngLat[] },
          },
        ],
});

/**
 * The spec with the editor's lines over it: the track the ends can reach, faint, and the part
 * they keep, strong. The section's own line and its passes stay beneath them.
 */
export function boundsEditorSpec(spec: MapSurfaceSpec, view: BoundsEditorView): MapSurfaceSpec {
  return {
    ...spec,
    sources: {
      ...spec.sources,
      'bounds-window': { kind: 'geojson', data: lineOf(slice(view.path, view.window)) },
      'bounds-kept': { kind: 'geojson', data: lineOf(slice(view.path, view.span)) },
    },
    layers: [
      ...spec.layers,
      {
        id: 'bounds-window',
        type: 'line',
        source: 'bounds-window',
        layout: { ...ROUND },
        paint: { 'line-color': '#888888', 'line-width': 4, 'line-opacity': 0.7 },
      },
      {
        id: 'bounds-kept',
        type: 'line',
        source: 'bounds-kept',
        layout: { ...ROUND },
        paint: { 'line-color': COMPARE_COLOURS['line-0'] ?? '#d1495b', 'line-width': 6 },
      },
    ],
  };
}
