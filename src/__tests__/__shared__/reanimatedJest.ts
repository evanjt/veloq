/**
 * Reanimated's Jest helpers with the signatures its native build declares. The package's
 * types resolve to the web build, which declares every helper without arguments.
 */
type NativeJestUtils =
  typeof import('react-native-reanimated/lib/typescript/jestUtils/index.native');

const reanimated = jest.requireActual<NativeJestUtils>('react-native-reanimated');

export const { advanceAnimationByTime, getAnimatedStyle } = reanimated;
