// The page's basemap styles. They are the app's own, taken from the module the
// app resolves them through and left on their upstream host, which is what a
// browser reaches. The tones come from the app's palette, so the page draws the
// base the phone draws.

import { upstreamStyle } from '@/features/maps/lib/htmlBuilders/upstreamStyle';
import { BASE_MAP_ATTRIBUTION } from '@/features/maps/lib/mapSourceCredits';

import { mapPalette } from '../theme';

/** The bases the page draws. Satellite is not one: each of its sources is another host. */
export type PageBase = 'light' | 'dark';

/** The base that follows the page's colour scheme. */
export function baseForScheme(prefersDark: boolean): PageBase {
  return prefersDark ? 'dark' : 'light';
}

/** The other base, for the toggle in the map's bar. */
export function otherBase(base: PageBase): PageBase {
  return base === 'dark' ? 'light' : 'dark';
}

/** The style MapLibre is given for a base: sources, sprite and glyphs on the basemap host. */
export function pageStyle(base: PageBase): object {
  return upstreamStyle(base);
}

/** The line in the map's corner. The renderer mounts no attribution control of its own. */
export function pageAttribution(): string {
  return BASE_MAP_ATTRIBUTION;
}

/** The heat steps and line colours the base is drawn with, the phone's tokens. */
export function pagePalette(base: PageBase) {
  return mapPalette(base);
}
