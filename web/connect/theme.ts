// The part of the app's theme the page reads. The app's theme index reaches
// react-native for its component themes, type and motion, which a browser does
// not have, so the build resolves the index specifier `@/theme` to this file for
// the page. Every module re-exported here imports nothing native, and the guard
// `lint:connect-theme-subset` refuses a line that does.

export {
  chartStreamColors,
  chartStreamColour,
  colors,
  darkColors,
  mixColour,
  sportFamilyColours,
  zoneColorsDark,
  zoneColorsLight,
} from '@/theme/colors';
export type { ChartStream, SportFamilyName } from '@/theme/colors';
export { mapPalette, themePalette } from '@/theme/palette';
export type { MapBase, MapPalette, Palette, VectorMapPalette } from '@/theme/palette';
export { spacing } from '@/theme/spacing';
export { iconSize } from '@/theme/iconSize';
export { layers, floatingLayers } from '@/theme/layers';
export { zoneColour, zoneTint } from '@/theme/zoneColour';
export { PERFORMANCE_BELOW_PLOT_HEIGHT, PERFORMANCE_PLOT_HEIGHT } from '@/theme/chartConstants';
export { strokeWidths } from '@/theme/strokeWidths';
