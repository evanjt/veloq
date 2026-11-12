import { DARK_MATTER_STYLE } from '@/features/maps/styles/darkMatter';
import { LIBERTY_STYLE } from '@/features/maps/styles/liberty';

/**
 * The vector basemap styles as they are written, on their upstream hosts.
 *
 * Kept apart from `styleResolution` because that module reaches the platform's
 * tile store through `mapStyles`, and the connect page, which draws the same
 * styles in a browser, must import them without it.
 */
export function upstreamStyle(base: 'light' | 'dark') {
  return base === 'dark' ? DARK_MATTER_STYLE : LIBERTY_STYLE;
}
