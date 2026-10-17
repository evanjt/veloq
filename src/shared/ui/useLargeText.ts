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
