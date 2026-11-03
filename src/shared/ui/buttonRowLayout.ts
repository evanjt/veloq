/**
 * How a row of equal buttons is laid out.
 *
 * A row of `flex: 1` buttons divides its width without asking what each label needs, and a label
 * narrower than its longest word is broken inside the word by both platforms' text layout. A
 * label wraps only at spaces, so side by side is right only when every button's share holds its
 * longest word plus the button's own padding and glyph. Otherwise the buttons stack full width.
 *
 * The decision is a pure function of measured widths. The widths already carry the system text
 * size, since they are measured from drawn text.
 */

export type ButtonRowLayout = 'row' | 'stack';

/** The words of a label; a label breaks only at spaces, so each word must fit a line alone. */
export function labelWords(label: string): string[] {
  return label.split(/\s+/).filter((word) => word.length > 0);
}

export interface ButtonRowMeasures {
  /** The row's width. Zero until it has been laid out. */
  width: number;
  /** The space between neighbouring buttons. */
  gap: number;
  /** The drawn width of each label's longest word, in button order. */
  wordWidths: readonly number[];
  /** What each button spends beside its label: padding, border, glyph and the glyph's gap. */
  chromeWidths: readonly number[];
}

/**
 * `row` while anything is still unmeasured, so a first frame does not flash a stack, and for a
 * lone button, which has the whole width.
 */
export function buttonRowLayout({
  width,
  gap,
  wordWidths,
  chromeWidths,
}: ButtonRowMeasures): ButtonRowLayout {
  const count = wordWidths.length;
  if (count < 2 || width <= 0 || wordWidths.some((w) => w <= 0)) return 'row';
  const share = (width - gap * (count - 1)) / count;
  const fits = wordWidths.every((word, i) => word + (chromeWidths[i] ?? 0) <= share);
  return fits ? 'row' : 'stack';
}
