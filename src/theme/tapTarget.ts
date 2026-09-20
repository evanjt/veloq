import { Platform } from 'react-native';

import { MIN_TAP_TARGET } from './spacing';

/**
 * This platform's tap-target minimum.
 *
 * It lives here rather than in `spacing.ts` because reading it needs
 * `react-native`, and the widget codegen builds its palette from the spacing
 * and colour modules outside the RN runtime. One `Platform` import there put
 * `react-native/index.js` in esbuild's graph and the generator stopped running
 * at all, so the committed widget constants drifted with nothing to say so
 * (B952).
 */
export const minTapTarget = MIN_TAP_TARGET[Platform.OS === 'android' ? 'android' : 'ios'];
