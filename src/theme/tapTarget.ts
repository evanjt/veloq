import { Platform } from 'react-native';

import { MIN_TAP_TARGET } from './spacing';

/**
 * This platform's tap-target minimum.
 *
 * It lives here rather than in `spacing.ts` because reading it needs
 * `react-native`, and the widget codegen builds its palette from the spacing
 * and colour modules outside the RN runtime. One `Platform` import there put
 * `react-native/index.js` in esbuild's graph and the generator stopped running
 * at all, so the committed widget constants drifted with nothing to say so.
 */
export const minTapTarget = MIN_TAP_TARGET[Platform.OS === 'android' ? 'android' : 'ios'];

function slopEach(drawn: number): number {
  return Math.max(0, Math.ceil((minTapTarget - drawn) / 2));
}

/**
 * The hit slop that lifts a control drawn `drawnHeight` tall to the platform
 * minimum, split across both edges. Given `drawnWidth` too, it lifts the width
 * the same way, for a control whose width is fixed.
 */
export function slopToMinTapTarget(
  drawnHeight: number,
  drawnWidth?: number
): { top: number; bottom: number; left: number; right: number } {
  const vertical = slopEach(drawnHeight);
  const horizontal = drawnWidth === undefined ? 0 : slopEach(drawnWidth);
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}
