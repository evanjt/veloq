/**
 * What the bundled glyphs cover, without the glyphs themselves.
 *
 * `bundledBasemap.ts` pulls 2.5 MB of base64 in, so anything that only needs to
 * know which stacks exist reads them here instead. A layer spec naming its font
 * is the common case: it runs on every map screen and carries none of the data.
 */

export const BUNDLED_GLYPH_STACKS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];

export const BUNDLED_GLYPH_RANGES = [
  '0-255',
  '256-511',
  '512-767',
  '768-1023',
  '7680-7935',
  '8192-8447',
];

/**
 * The stack an app-drawn symbol layer labels with.
 *
 * A symbol layer with no `text-font` gets the style spec's default, `Open Sans
 * Regular, Arial Unicode MS Regular`, which the app does not carry: the request
 * misses the bundle, falls through to the network and 404s, and the label draws
 * in the device's own font rather than the basemap's.
 */
export const BUNDLED_TEXT_FONT = ['Noto Sans Regular'];
