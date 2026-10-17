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

/**
 * The least share of its own height a picture is drawn at. Below it the
 * picture would be a sliver, so it holds here and the title and body scroll.
 */
export const TOUR_PICTURE_FLOOR = 0.5;

export interface TourSlideLayout {
  pictureScale: number;
  scrolls: boolean;
  /** The height the scrolling title and body may take; undefined when they do not scroll. */
  textHeight: number | undefined;
}

/**
 * How a slide fits its area: the picture shrinks to the space under the title
 * and body down to its floor, and once even that does not fit, the title and
 * body scroll above it. A header not yet laid out changes nothing, so the
 * first frame neither shrinks nor scrolls.
 */
export function tourSlideLayout(
  slideHeight: number,
  headerHeight: number,
  pictureHeight: number
): TourSlideLayout {
  if (headerHeight <= 0) return { pictureScale: 1, scrolls: false, textHeight: undefined };
  const fit = tourPictureScale(pictureHeight, tourPictureSpace(slideHeight, headerHeight));
  const pictureScale = pictureHeight > 0 ? Math.max(TOUR_PICTURE_FLOOR, fit) : 1;
  const pictureDrawn = pictureHeight * pictureScale;
  const needed = TOUR_SLIDE_PADDING_TOP + headerHeight + TOUR_PICTURE_GAP + pictureDrawn;
  if (needed <= slideHeight) return { pictureScale, scrolls: false, textHeight: undefined };
  const textHeight = Math.max(
    0,
    slideHeight - TOUR_SLIDE_PADDING_TOP - TOUR_PICTURE_GAP - pictureDrawn
  );
  return { pictureScale, scrolls: true, textHeight };
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
