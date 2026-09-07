/**
 * Text on a surface that cannot reflow.
 *
 * The app honours the system text size everywhere and that is the right
 * default, so this is not a way to switch font scaling off. It is a stated
 * limit on the few surfaces where a doubled size overlaps or clips instead of
 * reflowing: a grid laid out in fixed columns, a chart axis, a tab label.
 * WCAG 1.4.4 asks for 200 per cent without loss of function, which those
 * surfaces do not meet today and do not meet silently. Everything that can
 * take 200 per cent keeps it, uncapped.
 *
 * A caller may pass its own `maxFontSizeMultiplier` and it wins, so a single
 * line inside a dense block can opt back out.
 */

import React from 'react';
import { Text, type TextProps } from 'react-native';

/** How far a dense surface stretches before its layout stops holding. */
export const DENSE_TEXT_SCALE = 1.3;

export function DenseText(props: TextProps) {
  return <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} {...props} />;
}
