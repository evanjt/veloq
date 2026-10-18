/**
 * The start and end markers of a track, shared by the activity, route and
 * section maps so all three mark them the same way.
 *
 * The start is a disc in the base's start colour and the finish an ink disc,
 * each carrying the glyph section creation already uses: a triangle for the
 * start and a square for the end, so colour is never the only signal. The
 * source holds one point per end, its `position` property `start` or `end`.
 */
import type { MapPalette } from '@/theme';
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

/** Where a page draws the endpoints, for a page whose names differ from the 2D surfaces'. */
export interface EndpointLayerOptions {
  /** The source holding the two points. */
  source?: string;
  /** The layer ids are this followed by `-border`, `-fill` and `-icon`. */
  idPrefix?: string;
  /** The feature property holding `start` or `end`. */
  positionProperty?: string;
  /** The 3D pages draw every 2D size at a fixed fraction. */
  scale?: number;
}

export function buildEndpointLayers(
  palette: MapPalette,
  {
    source = 'endpoints',
    idPrefix = 'endpoint',
    positionProperty = 'position',
    scale = 1,
  }: EndpointLayerOptions = {}
): MapLayerSpec[] {
  const isStart = ['==', ['get', positionProperty], 'start'];
  return [
    {
      id: `${idPrefix}-border`,
      type: 'circle',
      source,
      paint: { 'circle-radius': ENDPOINT_BORDER_RADIUS * scale, 'circle-color': palette.casing },
    },
    {
      id: `${idPrefix}-fill`,
      type: 'circle',
      source,
      paint: {
        'circle-radius': ENDPOINT_RADIUS * scale,
        'circle-color': ['case', isStart, palette.start, palette.ink],
      },
    },
    {
      id: `${idPrefix}-icon`,
      type: 'symbol',
      source,
      layout: {
        'icon-image': ['case', isStart, SECTION_START_ICON_ID, SECTION_END_ICON_ID],
        'icon-size': ENDPOINT_ICON_SIZE * scale,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
      paint: { 'icon-color': palette.casing },
    },
  ];
}
