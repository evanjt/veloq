import { SPARKLINE_RANGE_WIDTH } from '@/shared/charts';
import { DENSE_TEXT_SCALE, denseExtent } from '@/shared/ui/DenseText';
import { iconSize, spacing, typography } from '@/theme';

/**
 * Geometry of one direction row on an activity's section card: a text column
 * that takes what is left, a marker slot for the trophy, place or partial word,
 * and the plot with its range. The plot and the markers keep their width, so
 * the text column is what narrows, and the range is what goes when the pace
 * would not fit beside it.
 */

/** The plot itself, without the range printed beside it. */
export const SECTION_PLOT_WIDTH = 80;
/** Two caption lines, so the range beside it reads as one block. */
export const SECTION_PLOT_HEIGHT = 2 * typography.caption.lineHeight;
/** The column the direction rows indent past, as wide as the card's index disc. */
export const DIRECTION_LABEL_WIDTH = 26;
/** The direction arrow ahead of the text column. */
export const DIRECTION_BADGE_WIDTH = iconSize.sm;
/** Room for a place ring and its digit, the widest marker but the partial word. */
export const MARKER_SLOT_WIDTH = denseExtent(typography.caption.fontSize, 2);
/** Space between the text column, the markers and the plot. */
export const DIRECTION_ROW_GAP = spacing.xs;
/** The pace headline's role. */
export const PACE_TYPE = typography.bodyCompactBold;

/** The longest pace the headline holds unshrunk, such as "10:30 /100yd" at its narrow glyphs. */
const PACE_EMS = 6;

/** What a direction row spends on everything but its text column, the range and its leading badge. */
const WIDTH_WITHOUT_LEAD =
  DIRECTION_LABEL_WIDTH +
  spacing.md +
  spacing.sm +
  MARKER_SLOT_WIDTH +
  SECTION_PLOT_WIDTH +
  2 * DIRECTION_ROW_GAP;

/** What a direction row spends on everything but its text column and the range. */
const FIXED_WIDTH = WIDTH_WITHOUT_LEAD + DIRECTION_BADGE_WIDTH + DIRECTION_ROW_GAP;

/** The range labels and the gap the sparkline sets them off by. */
const RANGE_WIDTH = spacing.xs + SPARKLINE_RANGE_WIDTH;

/**
 * Whether a direction row `rowWidth` wide keeps the plot's range labels at
 * `fontScale`. The pace never gives way, so the range goes first when the text
 * column would be narrower than the pace. Before the row is measured it keeps
 * them, which is the common width.
 */
export function sectionRowShowsRange(rowWidth: number | undefined, fontScale: number): boolean {
  if (rowWidth === undefined) return true;
  const scale = Math.min(Math.max(fontScale, 1), DENSE_TEXT_SCALE);
  const pace = Math.ceil(PACE_TYPE.fontSize * PACE_EMS * scale);
  return rowWidth - FIXED_WIDTH - RANGE_WIDTH >= pace;
}

/** What the row measures about its line and its leading badge, at the current text size. */
export interface SectionMetaMeasures {
  /** The row's width. Undefined until it has been laid out. */
  rowWidth: number | undefined;
  /** Whether the range prints beside the plot, which takes its room from the column. */
  showRange: boolean;
  /** The drawn width of the leading badge, zero when the row has none. */
  leadWidth: number;
  /** The drawn width of the widest word on the line, zero until it is measured. */
  widestWord: number;
}

/**
 * Whether the distance and traversals line sits on a line of its own, under the pace.
 *
 * A line breaks only at spaces, so the text column must hold its widest word or that word breaks
 * in the middle. The column is worked out from the row width and the measured badge rather than
 * read back from the layout, because the column itself changes when the line moves.
 */
export function sectionMetaStacks({
  rowWidth,
  showRange,
  leadWidth,
  widestWord,
}: SectionMetaMeasures): boolean {
  if (rowWidth === undefined || widestWord <= 0) return false;
  const lead = leadWidth > 0 ? leadWidth + DIRECTION_ROW_GAP : 0;
  const column = rowWidth - WIDTH_WITHOUT_LEAD - lead - (showRange ? RANGE_WIDTH : 0);
  return widestWord > column;
}
