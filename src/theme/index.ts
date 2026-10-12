import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';

import { md3DarkScheme, md3LightScheme } from './md3Scheme';
export type { VerdictRung, InsightTone } from './colors';

export {
  colors,
  darkColors,
  brand,
  gradients,
  glows,
  opacity,
  activityTypeColors,
  zoneColors,
  colorWithOpacity,
  insightCategoryColors,
  insightCategoryColor,
  rpeRamp,
  strengthRamp,
  workoutStepColors,
  mapPreviewColors,
  mapLayerColors,
  gradientScale,
  chartStreamColors,
  chartStreamInk,
  chartInkColor,
  sectionPaletteInk,
  sectionNumberInk,
  swipeAction,
  mapStyleSwatch,
  mapStylePreview,
  insightIcon,
  statusBadge,
  verdict,
  verdictColor,
  verdictFill,
  insightToneColor,
  recording,
  amberBanner,
  redBanner,
  offlinePill,
  contributionRamp,
  errorScreen,
  bodyDiagram,
  shaderWarmup,
  inputBoundary,
  switchTrackOff,
  cameraOverlay,
  mapStyleSwatchIcon,
  ink,
  loupeChrome,
  sectionPalette,
  routePalette,
  sectionPaletteIndex,
  sectionPaletteExpression,
} from './colors';
export { themePalette, themedStyles, type Palette } from './palette';
export { spacing, controlHeight, MIN_TAP_TARGET } from './spacing';
export { layout } from './layout';
export { slopToMinTapTarget } from './tapTarget';
export { typography } from './typography';
export {
  FAMILY_BARS,
  FAMILY_EXEMPTIONS,
  TOKEN_FAMILIES,
  TOKEN_GROUNDS,
  UNDER_BAR,
  type TokenFamily,
} from './tokenFamilies';
export { shadows, createShadow, smallElementShadow, mapTextShadow } from './shadows';
export { chartStyles } from './chartStyles';

export const lightTheme = {
  ...MD3LightTheme,
  colors: md3LightScheme,
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: md3DarkScheme,
};
