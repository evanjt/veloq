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

/**
 * A list of values as a JavaScript array literal.
 *
 * Each entry goes through `jsLiteral`, so the guarantee is the same one: a
 * quote inside any of them cannot close the literal and become code. Written
 * for a font stack, which is the one list the layer scripts interpolate.
 */
export function jsLiteralList(values: readonly string[]): string {
  return `[${values.map(jsLiteral).join(', ')}]`;
}

/**
 * A number as a JavaScript literal, or the fallback when it is not a finite
 * number.
 *
 * Camera values come back from storage and from restored backups, so a type
 * that says `number` does not make one. A string written bare into the page
 * would be parsed as code, and NaN or Infinity breaks map construction.
 */
export function jsNumber(value: unknown, fallback: number | null): string {
  return JSON.stringify(typeof value === 'number' && Number.isFinite(value) ? value : fallback);
}
