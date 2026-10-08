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
