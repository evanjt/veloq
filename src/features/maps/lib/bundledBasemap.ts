/**
 * The basemap assets that ship in the app rather than being fetched per device.
 *
 * A map without the sprite and the glyphs is an unlabelled abstract, so a fresh
 * install with no radio had no icons and no place names at any zoom. These are
 * byte-identical for every install, so they are bundled once (`Q67`).
 *
 * Only the Latin ranges are here. Every range of the three stacks is 104 MB,
 * which is CJK, so anything outside the set below stays on the network and
 * degrades to a box offline.
 *
 * Importing this module pulls 2.5 MB of base64 in, so only the two map hosts
 * that answer `bundled://` requests do. The style rewrite works off the URL
 * alone and imports nothing from here.
 */
import { BASEMAP_SPRITE } from '@/features/maps/assets/basemapSprite.generated';
import { BASEMAP_GLYPHS_NOTOSANSBOLD } from '@/features/maps/assets/basemapGlyphsNotoSansBold.generated';
import { BASEMAP_GLYPHS_NOTOSANSITALIC } from '@/features/maps/assets/basemapGlyphsNotoSansItalic.generated';
import { BASEMAP_GLYPHS_NOTOSANSREGULAR } from '@/features/maps/assets/basemapGlyphsNotoSansRegular.generated';

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

const GLYPHS: Record<string, Record<string, string>> = {
  'Noto Sans Regular': BASEMAP_GLYPHS_NOTOSANSREGULAR,
  'Noto Sans Bold': BASEMAP_GLYPHS_NOTOSANSBOLD,
  'Noto Sans Italic': BASEMAP_GLYPHS_NOTOSANSITALIC,
};

/**
 * Base64 for a bundled asset, or null when the request is for something else.
 *
 * Null is not a failure: the caller falls back to the network, which is how a
 * CJK label still renders when the device is online. The path is matched
 * exactly rather than joined, so nothing outside the two maps can be reached.
 */
export function bundledBasemapAsset(path: string): string | null {
  const sprite = path.startsWith(`${BUNDLED_SPRITE_DIR}/`)
    ? path.slice(BUNDLED_SPRITE_DIR.length + 1)
    : null;
  if (sprite) {
    return BUNDLED_SPRITE_FILES.includes(sprite) ? (BASEMAP_SPRITE[sprite] ?? null) : null;
  }

  const glyph = /^fonts\/([^/]+)\/([^/]+)\.pbf$/.exec(path);
  if (!glyph) return null;
  const stack = decodeURIComponent(glyph[1]);
  const range = glyph[2];
  if (!BUNDLED_GLYPH_RANGES.includes(range)) return null;
  return GLYPHS[stack]?.[range] ?? null;
}
