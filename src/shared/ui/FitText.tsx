/**
 * A number, unit, date, time or control label: it stays on one line and
 * shrinks to fit its box rather than losing its end to an ellipsis.
 *
 * A value that is cut off reads as a different value, so this is the owner of
 * every single-line Text that carries one. It takes the system text size like
 * any other Text and shrinks only when the box is too narrow for it. A caller
 * on a dense surface passes `maxFontSizeMultiplier` itself.
 */

import React from 'react';
import { Text, type TextProps } from 'react-native-paper';

/** How far a value shrinks before it gives up and ellipsises. */
export const FIT_MIN_FONT_SCALE = 0.75;

export function FitText(props: Omit<TextProps<never>, 'ref'>) {
  return (
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={FIT_MIN_FONT_SCALE} {...props} />
  );
}
