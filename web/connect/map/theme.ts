// The part of the app's theme the page's map styles read. The app's theme index
// reaches react-native for its component themes, type and motion, which a
// browser does not have, so the build resolves the index specifier `@/theme`
// to this file for the page. It re-exports the same bindings the index does.

export { mixColour } from '@/theme/colors';
export { mapPalette } from '@/theme/palette';
export type { MapBase, MapPalette, VectorMapPalette } from '@/theme/palette';
