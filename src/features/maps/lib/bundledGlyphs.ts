/**
 * What the app bundle carries of the basemap's sprite and glyphs.
 *
 * The files sit under `modules/veloqrs/assets/basemap` and the platform
 * interceptor answers `veloq-asset/<path>` out of them, so this module names
 * what exists and holds none of the bytes. Only the Latin ranges are carried:
 * every range of the three stacks is 104 MB, which is CJK.
 */

export const BUNDLED_SPRITE_DIR = 'sprites/ofm_f384';
export const BUNDLED_SPRITE_FILES = ['ofm.json', 'ofm.png', 'ofm@2x.json', 'ofm@2x.png'];

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
