import { MD3LightTheme, MD3DarkTheme, configureFonts } from 'react-native-paper';

import { md3DarkScheme, md3LightScheme } from './md3Scheme';
import { faceWeight, typeface } from './typography';
export type { VerdictRung, InsightTone, ChartStream, SportFamilyName } from './colors';

export {
  colors,
  darkColors,
  brand,
  nativeColours,
  opacity,
  activityTypeColors,
  zoneColorsDark,
  zoneColorsLight,
  colorWithOpacity,
  mixColour,
  sequentialRamp,
  divergingRamp,
  directionPair,
  sportFamilyColours,
  mapLayerColors,
  chartStreamColors,
  chartStreamColour,
  sectionPaletteInk,
  sectionNumberInk,
  swipeAction,
  mapStylePreview,
  verdict,
  verdictColor,
  verdictFill,
  insightToneColor,
  recording,
  contributionRamp,
  bodyDiagram,
  shaderWarmup,
  ink,
  loupeChrome,
  sectionPalette,
  routePalette,
  sectionPaletteIndex,
  sectionPaletteExpression,
  routePaletteExpression,
} from './colors';
export { colourTokens, heatmapTileStops, type ColourToken } from './colourTokens.generated';
export { zoneColour, zoneTint } from './zoneColour';
export {
  themePalette,
  themedStyles,
  mapPalette,
  colourIndexExpression,
  type Palette,
  type MapBase,
  type MapDivStep,
  type MapPalette,
  type MapLayerColours,
  type VectorMapPalette,
  type SatelliteMapPalette,
} from './palette';
export { spacing, controlHeight, MIN_TAP_TARGET } from './spacing';
export { layout } from './layout';
export { iconSize, type IconSize } from './iconSize';
export { stroke } from './stroke';
export { floatingLayers, layers } from './layers';
export { gapBetweenTargets, slopToMinTapTarget } from './tapTarget';
export { typography } from './typography';
export { faceWeight } from './typography';
export {
  FAMILY_BARS,
  FAMILY_EXEMPTIONS,
  TOKEN_FAMILIES,
  TOKEN_GROUNDS,
  UNDER_BAR,
  type TokenFamily,
} from './tokenFamilies';
export {
  shadows,
  raised,
  createShadow,
  smallElementShadow,
  mapTextShadow,
  chartLabelHalo,
} from './shadows';
export { chartStyles } from './chartStyles';
export {
  duration,
  easing,
  easingCurve,
  motionPairs,
  motionPresets,
  cameraMove,
  type MotionDuration,
} from './motion';

// Paper's own controls (menus, snackbars, inputs) draw the app's face, and its
// medium-weight labels the nearest weight the face ships.
const paperFonts = configureFonts({
  config: Object.fromEntries(
    Object.entries(MD3LightTheme.fonts).map(([variant, style]) => [
      variant,
      {
        fontFamily: typeface.family,
        ...('fontWeight' in style && { fontWeight: faceWeight(style.fontWeight) }),
      },
    ])
  ),
});

export const lightTheme = {
  ...MD3LightTheme,
  colors: md3LightScheme,
  fonts: paperFonts,
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: md3DarkScheme,
  fonts: paperFonts,
};
