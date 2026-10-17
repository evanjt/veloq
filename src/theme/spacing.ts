/**
 * The spacing and radius scales.
 *
 * The radius scale is what the app already draws rather than what it used to
 * declare: 4, 8, 12, 16, 20, 24 and full. The old scale named 4, 8, 16 and 24,
 * so 12 and 20 were the two most-drawn radii with no token at all, and every
 * one of their call sites was a literal. 28 is Material's extra-large shape,
 * the top corners of an Android bottom sheet.
 *
 * The two micro steps, 2 and 6, are spacing rather than radius. A chart reads
 * the same rungs as everything else, because a 2 pt gap on a badge is the same
 * 2 pt gap a chart axis wants.
 */
export const spacing = {
  // Base spacing scale (8px base unit)
  xxs: 2,
  xs: 4,
  xsPlus: 6,
  sm: 8,
  // The half-step between 8 and 16. The ladder doubled there and the app drew
  // into the gap anyway, a 10 at 30 sites and a 12 at 29, so an off-ladder
  // padding had nowhere to fold to. 12 matches layout.borderRadiusMd, so the
  // two scales agree on the rung.
  smPlus: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Each platform's own tap-target minimum, not one number for both: 44 pt on
 * iOS from the Human Interface Guidelines, 48 dp on Android from Material.
 * Neither is on the 8 pt grid and neither is meant to be.
 */
export const MIN_TAP_TARGET = { ios: 44, android: 48 } as const;

/**
 * The height each kind of control is drawn at. A control is drawn at its rung
 * and reaches `MIN_TAP_TARGET` through hit slop, so the target holds while a
 * filter row or a button bar stays compact.
 */
export const controlHeight = {
  // A selector chip: a bodyCompact line, 18, with 4 above and below.
  chip: 26,
  // A small button: a bodySmall line with 6 above and below.
  buttonSm: 32,
  // A button, and the square an icon-only button is drawn in.
  button: 40,
} as const;

export const layout = {
  screenPadding: spacing.md, // 16 - Aligns to 8px grid
  cardPadding: spacing.md, // 16 - Aligns to 8px grid
  cardMargin: spacing.sm, // 8 - Aligns to 8px grid (was 12)
  borderRadiusXs: spacing.xs, // 4 - Tiny elements (dots, progress bars)
  borderRadiusSm: spacing.sm, // 8 - Aligns to 8px grid
  borderRadiusMd: 12, // 12 - Chips, small cards, inline controls
  borderRadius: spacing.md, // 16 - Aligns to 8px grid (was 12)
  borderRadiusXl: 20, // 20 - Sheets, large pills
  borderRadiusLg: spacing.lg, // 24 - Large pills, rounded containers
  borderRadiusXxl: 28, // 28 - Android bottom sheet top corners
  borderRadiusFull: 9999, // Circles
  recordFabSize: 56, // Floating record button diameter
  // The app icon drawn inside the app, with the home screen's corner: the
  // system masks an icon at about 22.5 % of its side.
  appIconSize: 80,
  borderRadiusAppIcon: 18,
  // The widest a single column of screen content is drawn. A wider window,
  // a tablet or a phone in landscape, centres the column in it. It matches
  // Material's 640 dp cap on a modal bottom sheet, so a sheet and the screen
  // under it share one width.
  maxContentWidth: 640,
} as const;
