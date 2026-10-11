/**
 * The start and end markers of a track, shared by the activity, route and
 * section maps so all three mark them the same way.
 *
 * Green and red alone do not separate under a red-green colour deficiency, so
 * each dot carries the glyph section creation already uses: a triangle for the
 * start and a square for the end. The source holds one point per end, its
 * `position` property `start` or `end`.
 */
import { mapLayerColors } from '@/theme';
import type { MapImageSpec, MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import {
  SECTION_END_ICON,
  SECTION_END_ICON_ID,
  SECTION_START_ICON,
  SECTION_START_ICON_ID,
} from '@/features/maps/lib/mapIcons';

/** The images the endpoint glyph layer draws; a surface that shows endpoints registers them. */
export const ENDPOINT_IMAGES: MapImageSpec[] = [SECTION_START_ICON, SECTION_END_ICON];

const ENDPOINT_RADIUS = 7;
const ENDPOINT_BORDER_RADIUS = 8.5;
// The icons are 64 px squares, so this draws the glyph at 9 px inside a 14 px dot.
const ENDPOINT_ICON_SIZE = 0.14;

const isStart = ['==', ['get', 'position'], 'start'];

export function buildEndpointLayers(): MapLayerSpec[] {
  return [
    {
      id: 'endpoint-border',
      type: 'circle',
      source: 'endpoints',
      paint: { 'circle-radius': ENDPOINT_BORDER_RADIUS, 'circle-color': mapLayerColors.casing },
    },
    {
      id: 'endpoint-fill',
      type: 'circle',
      source: 'endpoints',
      paint: {
        'circle-radius': ENDPOINT_RADIUS,
        'circle-color': ['case', isStart, mapLayerColors.startSolid, mapLayerColors.endSolid],
      },
    },
    {
      id: 'endpoint-icon',
      type: 'symbol',
      source: 'endpoints',
      layout: {
        'icon-image': ['case', isStart, SECTION_START_ICON_ID, SECTION_END_ICON_ID],
        'icon-size': ENDPOINT_ICON_SIZE,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
      paint: { 'icon-color': mapLayerColors.casing },
    },
  ];
}
