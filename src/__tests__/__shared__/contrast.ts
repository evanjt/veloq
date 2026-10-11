/**
 * WCAG 2.2 contrast, measured on the colour that lands on screen rather than on
 * the token. A text colour carrying an alpha, a style `opacity` or a
 * translucent ground is composited first, which is the step a token-only check
 * cannot take.
 */

import { StyleSheet } from 'react-native';

/** WCAG 2.2 AA for body text. */
export const AA_TEXT = 4.5;

function channels(colour: string): [number, number, number, number] {
  const rgba = colour.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  if (!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(colour)) {
    throw new Error(`not a measurable colour: ${colour}`);
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  const a = colour.length === 9 ? parseInt(colour.slice(7, 9), 16) / 255 : 1;
  return [r, g, b, a];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex)
    .slice(0, 3)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The ratio between two opaque colours, whichever way round. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The opaque colour `colour` lands as when drawn at `opacity` over an opaque
 * `ground`. The colour's own alpha and the opacity multiply, as they do on a
 * React Native view.
 */
export function composite(colour: string, ground: string, opacity = 1): string {
  const [r, g, b, a] = channels(colour);
  const base = channels(ground);
  const alpha = a * opacity;
  return (
    '#' +
    [r, g, b]
      .map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha)))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** The colour a rendered Text draws in, its style's `opacity` folded in, over `ground`. */
export function renderedTextColour(style: unknown, ground: string): string {
  const flat = StyleSheet.flatten(style as never) as { color?: string; opacity?: number };
  if (flat.color === undefined) throw new Error('the text sets no colour');
  return composite(flat.color, ground, flat.opacity ?? 1);
}
