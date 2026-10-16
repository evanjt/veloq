/**
 * The six sizes an icon is drawn at.
 *
 * An icon beside text matches the text: `sm` with `caption` and `bodyCompact`,
 * `md` with `bodySmall` and `body`, `lg` in titles and toolbars. `xl` is the
 * glyph on a 56 pt primary button, `xxl` the glyph of an empty or error state.
 * A size between two rungs folds to the nearer one, and where a glyph no longer
 * fits its pill, the pill changes rather than the glyph.
 */
export const iconSize = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export type IconSize = (typeof iconSize)[keyof typeof iconSize];
