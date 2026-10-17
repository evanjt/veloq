import { StyleSheet } from 'react-native';

/**
 * The four widths a border, rule or ring is drawn at, and no others.
 *
 * `hairline` is the platform's own hairline, the thinnest line the screen
 * draws, and separates the rows of a group. `one` is the edge of a card, a
 * control, a chart's grid and axes and a map line's casing. `two` is a chart
 * line, a focus or selected ring, a focused field and a dot's ring. `three` is
 * the tab indicator and the ring of a selected picture option. An edge that
 * marks or separates is made quiet by its thinness, never by a paler colour.
 */
export const stroke = {
  hairline: StyleSheet.hairlineWidth,
  one: 1,
  two: 2,
  three: 3,
} as const;
