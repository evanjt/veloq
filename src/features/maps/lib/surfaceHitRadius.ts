/**
 * How far either side of a tap the page looks for something to hit, in CSS
 * pixels. A finger covers about 30 px and the thinnest interactive thing on the
 * map is a dashed section line at most 4 px wide, so a point query missed most taps.
 */
export const SURFACE_HIT_TEST_RADIUS_PX = 12;
