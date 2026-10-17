import { useWindowDimensions } from 'react-native';

import { DENSE_TEXT_SCALE } from './DenseText';

/**
 * Whether the system text size is past the dense cap, where fixed chrome stops
 * fitting and a screen moves what it pins into its scroll instead.
 *
 * Below the cap pinned chrome stays compact; above it a pinned block can take
 * the whole window. It reads the font scale rather than a measured height, so
 * content that grows in place (an expanded row) does not flip the layout and
 * remount it.
 */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale > DENSE_TEXT_SCALE;
}

/**
 * Share of the window a screen's pinned block may take past the dense cap. What
 * does not fit scrolls inside the block, so the content under it keeps a region.
 */
export const LARGE_TEXT_PINNED_FRACTION = 0.6;

/** Past this text size even a reduced grid stops fitting, and it falls to one column. */
const SINGLE_COLUMN_SCALE = 2;

/**
 * The columns a grid laid out for `full` keeps at `fontScale`: all of them up
 * to the dense cap, one fewer past it, and one past double.
 */
export function columnsAtTextScale(full: number, fontScale: number): number {
  if (fontScale <= DENSE_TEXT_SCALE) return full;
  if (fontScale > SINGLE_COLUMN_SCALE) return 1;
  return Math.max(1, full - 1);
}

/** {@link columnsAtTextScale} at the window's text size. */
export function useTextScaleColumns(full: number): number {
  return columnsAtTextScale(full, useWindowDimensions().fontScale);
}
