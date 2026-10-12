import { spacing } from '@/theme';

/** The tour card's tallest extent, as a share of the window height. */
export const TOUR_CARD_HEIGHT_RATIO = 0.8;

/** Space above a slide's icon. */
export const TOUR_SLIDE_PADDING_TOP = spacing.lg;

/** Space between a slide's body text and its picture. */
export const TOUR_PICTURE_GAP = spacing.sm + spacing.md;

/**
 * The height the slides may take: what the card holds at its tallest, less the
 * dots and buttons drawn under them.
 */
export function tourSlideAreaHeight(windowHeight: number, chromeHeight: number): number {
  return Math.max(0, windowHeight * TOUR_CARD_HEIGHT_RATIO - chromeHeight);
}

/** The height a slide's picture may take under its icon, title and body. */
export function tourPictureSpace(slideHeight: number, headerHeight: number): number {
  return Math.max(0, slideHeight - TOUR_SLIDE_PADDING_TOP - headerHeight - TOUR_PICTURE_GAP);
}

/**
 * The scale that fits a picture into its space: never larger than its own
 * size, and shrunk to exactly the space when it is taller.
 */
export function tourPictureScale(naturalHeight: number, space: number): number {
  if (naturalHeight <= 0) return 1;
  return Math.min(1, Math.max(0, space / naturalHeight));
}

/** The least space between two of the tour's footer buttons. */
export const TOUR_FOOTER_GAP = spacing.sm;

/** The natural widths of the tour's footer buttons; zero for one the slide does not show. */
export interface TourFooterWidths {
  skip: number;
  showMe: number;
  next: number;
}

/**
 * Whether the footer's buttons sit in one row or stack, Show Me over Skip and
 * Next: one row when their natural widths and the gaps between them fit the
 * row. A row not yet laid out keeps one row, so the first frame does not stack.
 */
export function tourFooterLayout(rowWidth: number, widths: TourFooterWidths): 'row' | 'stacked' {
  if (rowWidth <= 0) return 'row';
  const shown = [widths.skip, widths.showMe, widths.next].filter((width) => width > 0);
  const needed =
    shown.reduce((sum, width) => sum + width, 0) + Math.max(0, shown.length - 1) * TOUR_FOOTER_GAP;
  return needed <= rowWidth ? 'row' : 'stacked';
}
