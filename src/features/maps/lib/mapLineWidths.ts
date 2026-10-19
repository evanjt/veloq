/**
 * The widths a detail map draws its subject line at, shared by the flat
 * builders and the 3D pages so the two cannot drift apart.
 */

/** The subject line: the activity, route or section the map is about. */
export const SUBJECT_LINE_WIDTH = 4;
/** The casing under the subject line, which shows as a thin edge either side. */
export const SUBJECT_CASING_WIDTH = 5;
/**
 * The matched route runs under the activity track, often within a metre of it.
 * It is context, so it takes the base's muted colour and no casing, and it is
 * wider than the track above it so a margin of it shows on either side.
 */
export const OVERLAY_LINE_WIDTH = 8;

/** A width that changes with zoom, as `[zoom, px]` stops in rising zoom. */
export type LineWidthStops = readonly (readonly [number, number])[];

/**
 * A section line on the Map tab, dashed so the edge under it shows through the
 * gaps. The flat map and the 3D page both draw it at these widths.
 */
export const SECTION_LINE_WIDTHS: LineWidthStops = [
  [6, 2],
  [10, 2.6],
  [14, 3.2],
  [18, 4],
];
/**
 * A section line's dash, as `[dash, gap]` in multiples of the line's width.
 * Every map that draws a section dashed, and the key that shows one, reads it.
 */
export const SECTION_LINE_DASH: readonly [number, number] = [2, 1.2];
/** A route line on the Map tab, drawn under the section lines. */
export const ROUTE_LINE_WIDTHS: LineWidthStops = [
  [6, 1.5],
  [12, 2.5],
  [18, 4],
];
/**
 * How much wider than a Map tab section or route line the base's edge under it
 * is drawn, so half of this shows either side of the line on any ground.
 */
export const OVERLAY_EDGE_MARGIN = 2;

/**
 * The MapLibre width expression for `stops`, each width plus `extra` and the
 * sum times `scale`.
 */
export function lineWidthRamp(stops: LineWidthStops, extra = 0, scale = 1): unknown[] {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...stops.flatMap(([zoom, width]) => [zoom, (width + extra) * scale]),
  ];
}

/** A map over terrain draws every flat width and marker size at this fraction. */
export const MAP_3D_SCALE = 0.75;
