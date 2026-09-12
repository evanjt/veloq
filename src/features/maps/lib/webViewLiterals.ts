/**
 * Values crossing into injected WebView JavaScript.
 *
 * The page runs MapLibre GL JS fetched from a CDN, and the scripts injected
 * into it were built by interpolating values inside single quotes. Any of them
 * carrying a quote closes the literal early and the rest is parsed as code, so
 * a route colour, an activity id or a style name decided anywhere upstream
 * becomes script.
 */

/**
 * One value as a JavaScript literal, quotes and all.
 *
 * Write `var id = ${jsLiteral(activityId)};`, never `var id = '${activityId}';`.
 */
export function jsLiteral(value: string | number | boolean | null | undefined): string {
  return JSON.stringify(value ?? null);
}

/** `z/x/y.png`, the only shape a heatmap tile path may take. */
const TILE_PATH = /^\d{1,2}\/\d{1,7}\/\d{1,7}\.png$/;

/**
 * The tile path a page asked for, or null when it is not one.
 *
 * The path arrives in a message from the WebView and was joined straight onto
 * the tile directory, so `../..` read outside it. Matching the shape is the
 * whole check: there is nothing else a tile path can be.
 */
export function heatmapTilePath(posted: unknown): string | null {
  return typeof posted === 'string' && TILE_PATH.test(posted) ? posted : null;
}
