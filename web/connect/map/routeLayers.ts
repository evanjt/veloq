// What the routes and sections pages draw in their map slot, and how a table
// row and a line name each other. Pure, so a test drives it without a renderer.

import type { MapSurfaceSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { divergingRamp, routePaletteExpression, sectionPalette } from '@/theme/colors';
import { colourIndexExpression } from '@/theme/palette';

import { compareColoursOn } from './activityLayers';
import { compareSet } from '../compare';
import type { Side } from '../routesDetail';
import type { PickedFeature } from './hit';
import { pagePalette, toneOf, type PageBase } from './style';

/** How long a pointer rests on an attempt before its full track is asked for. */
export const HOVER_TRACK_MS = 300;

/** Whether a pointer that arrived at `since` has rested long enough at `now`. */
export const hoverTrackDue = (since: number, now: number) => now - since >= HOVER_TRACK_MS;

/**
 * The colour of a selected pass, by its place in the selection: the table's
 * swatch and the line share it, and a re-sort of the table does not move it.
 * Null for a pass that is not selected, and for any pass below two selected.
 */
export function passColour(id: string, selected: readonly string[], base: PageBase): string | null {
  const entry = compareSet(selected).find((candidate) => candidate.id === id);
  return entry ? (compareColoursOn(base)[entry.colour] ?? null) : null;
}

/** The row a line on the map means: a pass by its activity id, a list line by its own id. */
export function rowOfFeature(feature: PickedFeature | null): string | null {
  if (!feature) return null;
  const activity = feature.properties?.activityId;
  if (typeof activity === 'string' || typeof activity === 'number') return String(activity);
  return feature.layerId === 'section-passes' ? null : feature.id;
}

/** The attempts asked for once the pointer rests on `id`: each id is asked once and kept. */
export function withAsked(asked: readonly string[], id: string | null): readonly string[] {
  return id === null || asked.includes(id) ? asked : [...asked, id];
}

const ROUND = { 'line-cap': 'round', 'line-join': 'round' } as const;
const lit = ['case', ['boolean', ['feature-state', 'highlighted'], false]];
const geo = (kind: string, key: string) => `veloq://geo/${kind}/${encodeURIComponent(key)}`;

/** The whole list's lines on the global map's own collections; hover lights a line through feature state. */
export function listSpec(
  _base: PageBase,
  kind: 'routes' | 'sections',
  version: number
): MapSurfaceSpec {
  const sections = kind === 'sections';
  return {
    sources: {
      lines: {
        kind: 'geojson',
        data: `veloq://geo/${sections ? 'sections/all' : 'route-lines/all'}?v=${version}`,
      },
    },
    layers: [
      {
        id: 'lines',
        type: 'line',
        source: 'lines',
        layout: { ...ROUND },
        paint: {
          'line-color': sections
            ? colourIndexExpression(sectionPalette, ['get', 'colorIndex'])
            : routePaletteExpression(),
          'line-width': sections ? [...lit, 6, 4] : [...lit, 5, 3],
        },
      },
    ],
    interactiveLayers: ['lines'],
  };
}

/** The attempt the athlete picked and which side of the reference it finished. */
export type PickedAttempt = { id: string; side: Side };

/** The line colour of a picked attempt: cool when ahead of the reference, warm when behind. */
export function sideColour(side: Side, base: PageBase): string {
  const ramp = divergingRamp[toneOf(base)];
  return side === 'ahead' ? ramp.cool[1] : side === 'behind' ? ramp.warm[1] : ramp.mid;
}

/**
 * A route: every attempt faint and clickable, the latest ride lighter under the
 * representative, then the full track of every attempt asked for so far, each
 * kept mounted and shown only while it is the hovered one or the picked one.
 * The picked one takes its side's colour.
 */
export function routeDetailSpec(
  base: PageBase,
  groupId: string,
  asked: readonly string[],
  hoveredActivity: string | null,
  picked: PickedAttempt | null = null
): MapSurfaceSpec {
  const sources: MapSurfaceSpec['sources'] = {
    route: { kind: 'geojson', data: geo('route', groupId) },
    'route-latest': { kind: 'geojson', data: geo('route-latest', groupId) },
    'route-attempts': { kind: 'geojson', data: geo('route-attempts', groupId) },
  };
  const layers: MapSurfaceSpec['layers'] = [
    {
      id: 'route-attempts',
      type: 'line',
      source: 'route-attempts',
      layout: { ...ROUND },
      paint: { 'line-color': routePaletteExpression(), 'line-width': 3, 'line-opacity': 0.2 },
    },
    {
      id: 'route-latest',
      type: 'line',
      source: 'route-latest',
      layout: { ...ROUND },
      paint: { 'line-color': routePaletteExpression(), 'line-width': 3, 'line-opacity': 0.45 },
    },
    {
      id: 'route',
      type: 'line',
      source: 'route',
      layout: { ...ROUND },
      paint: { 'line-color': routePaletteExpression(), 'line-width': 6 },
    },
  ];
  for (const id of asked) {
    const source = `track-${id}`;
    sources[source] = { kind: 'geojson', data: geo('track', id) };
    layers.push({
      id: source,
      type: 'line',
      source,
      layout: { ...ROUND },
      paint: {
        'line-color':
          picked?.id === id ? sideColour(picked.side, base) : compareColoursOn(base)['line-1'],
        'line-width': picked?.id === id ? 5 : 4,
      },
      visible: id === hoveredActivity || id === picked?.id,
    });
  }
  return { sources, layers, interactiveLayers: ['route-attempts'] };
}

/** The bounds of every position in GeoJSON text as `[west, south, east, north]`, or null when there are none. */
export function boundsOfGeoText(text: string): [number, number, number, number] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      if (Number.isFinite(value[0]) && Number.isFinite(value[1])) {
        box[0] = Math.min(box[0], value[0]);
        box[1] = Math.min(box[1], value[1]);
        box[2] = Math.max(box[2], value[0]);
        box[3] = Math.max(box[3], value[1]);
      }
      return;
    }
    value.forEach(walk);
  };
  const features = (parsed as { features?: unknown })?.features;
  if (Array.isArray(features)) {
    for (const feature of features)
      walk((feature as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates);
  }
  return box[0] <= box[2] ? box : null;
}

/** A section: the line bold, every pass faint, selected passes in their colours, the hovered pass lit. */
export function sectionDetailSpec(
  base: PageBase,
  sectionId: string,
  hoveredActivity: string | null,
  selected: readonly string[]
): MapSurfaceSpec {
  const activity = ['get', 'activityId'];
  const colours = compareSet(selected).flatMap((entry) => [
    entry.id,
    compareColoursOn(base)[entry.colour] ?? pagePalette(base).muted,
  ]);
  const chosen = selected.length >= 2 ? selected.slice(0, 4) : [];
  return {
    sources: {
      'section-passes': { kind: 'geojson', data: geo('section-passes', sectionId) },
      section: { kind: 'geojson', data: geo('section', sectionId) },
    },
    layers: [
      {
        id: 'section-passes',
        type: 'line',
        source: 'section-passes',
        layout: { ...ROUND },
        paint: {
          'line-color': colourIndexExpression(sectionPalette, ['get', 'colorIndex']),
          'line-width': 2,
          'line-opacity': 0.3,
        },
      },
      {
        id: 'section',
        type: 'line',
        source: 'section',
        layout: { ...ROUND },
        paint: { 'line-color': routePaletteExpression(), 'line-width': 6 },
      },
      {
        id: 'section-selected',
        type: 'line',
        source: 'section-passes',
        layout: { ...ROUND },
        filter: ['in', activity, ['literal', chosen]],
        paint: {
          'line-color': colours.length
            ? ['match', activity, ...colours, pagePalette(base).muted]
            : pagePalette(base).muted,
          'line-width': 4,
        },
      },
      {
        id: 'section-hover',
        type: 'line',
        source: 'section-passes',
        layout: { ...ROUND },
        filter: ['==', activity, hoveredActivity ?? ''],
        paint: {
          'line-color': compareColoursOn(base)['line-2'],
          'line-width': 5,
          'line-opacity': 0.9,
        },
      },
    ],
    interactiveLayers: ['section-passes'],
  };
}
