import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';

import { colors, darkColors, brand, ink } from './colors';
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
  rpeRamp,
  strengthRamp,
  workoutStepColors,
  mapPreviewColors,
  mapLayerColors,
  chartStreamColors,
  chartStreamInk,
  chartInkColor,
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
  contributionRamp,
  errorScreen,
  bodyDiagram,
  shaderWarmup,
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
export { spacing, MIN_TAP_TARGET } from './spacing';
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
  colors: {
    ...MD3LightTheme.colors,
    primary: brand.tealLight, // Teal-600 for light mode
    primaryContainer: brand.teal,
    secondary: brand.blueDark,
    secondaryContainer: brand.blue,
    tertiary: brand.goldDark, // Gold as tertiary (achievements)
    tertiaryContainer: brand.gold,
    background: colors.background,
    surface: colors.surface,
    error: colors.error,
    onPrimary: ink.white, // White text on teal
    onSecondary: ink.white,
    onTertiary: colors.textPrimary, // Dark text on gold
    onBackground: colors.textPrimary,
    onSurface: colors.textPrimary,
    outline: colors.border,
    surfaceVariant: colors.backgroundAlt,
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: brand.tealDark, // Teal-400 for dark mode
    primaryContainer: brand.teal,
    secondary: brand.blue,
    secondaryContainer: brand.blueLight,
    tertiary: brand.gold, // Gold as tertiary (achievements)
    tertiaryContainer: brand.goldLight,
    background: darkColors.background,
    surface: darkColors.surface,
    error: darkColors.error,
    onPrimary: colors.textPrimary, // Dark text on bright teal
    onSecondary: ink.white,
    onTertiary: colors.textPrimary, // Dark text on gold
    onBackground: darkColors.textPrimary,
    onSurface: darkColors.textPrimary,
    outline: darkColors.border,
    surfaceVariant: darkColors.surfaceElevated,
  },
};
