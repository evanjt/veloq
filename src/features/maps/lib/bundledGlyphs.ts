/**
 * What the app bundle carries of the basemap's sprite and glyphs.
 *
 * The files sit under `modules/veloqrs/assets/basemap` and the platform
 * interceptor answers `veloq-asset/<path>` out of them, so this module names
 * what exists and holds none of the bytes. Only the Latin ranges are carried:
 * every range of the Noto faces is 104 MB, which is CJK.
 */

export const BUNDLED_SPRITE_DIR = 'sprites/ofm_f384';
export const BUNDLED_SPRITE_FILES = ['ofm.json', 'ofm.png', 'ofm@2x.json', 'ofm@2x.png'];

/**
 * The stacks every map label is drawn in: Manrope, the app's face, with the
 * Noto face behind it that draws what Manrope lacks (Han, kana, Arabic,
 * Hebrew, most symbols). There is no italic.
 */
export const MAP_TEXT_FONT_REGULAR = ['Manrope Regular', 'Noto Sans Regular'];
export const MAP_TEXT_FONT_BOLD = ['Manrope Bold', 'Noto Sans Bold'];

/**
 * The stacks as MapLibre asks for them, names joined with commas, which is
 * the directory each is bundled under. Each range file there holds the Noto
 * glyphs and then Manrope's, and the renderer keeps the last glyph it reads
 * for a code point, so Manrope draws wherever it has the glyph.
 */
export const BUNDLED_GLYPH_STACKS = [MAP_TEXT_FONT_REGULAR, MAP_TEXT_FONT_BOLD].map((stack) =>
  stack.join(',')
);

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
export const BUNDLED_TEXT_FONT = MAP_TEXT_FONT_REGULAR;
