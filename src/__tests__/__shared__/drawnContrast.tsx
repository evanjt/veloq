/**
 * What a rendered tree actually draws, measured against the ground it is drawn
 * on. The theme tests measure each token on its own theme's grounds; these
 * measure the colour a component resolved, which is where a light value left in
 * a dark branch shows.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PaperProvider } from 'react-native-paper';
import { screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { darkTheme, lightTheme } from '@/theme';

/** WCAG 2.2 AA 1.4.3, text. */
export const AA_TEXT = 4.5;
/** WCAG 2.2 AA 1.4.11, a mark needed to understand the content. */
export const AA_MARK = 3;

type Rgba = [number, number, number, number];

function parse(colour: string): Rgba {
  const rgba = colour.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => Number(p.trim()));
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  const hex = colour.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    alpha,
  ];
}

function hex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

/** `fill` laid over `base`, as the opaque colour that lands. */
export function over(fill: string, base: string): string {
  const [r, g, b, a] = parse(fill);
  const [br, bg, bb] = parse(base);
  return `#${hex(r * a + br * (1 - a))}${hex(g * a + bg * (1 - a))}${hex(b * a + bb * (1 - a))}`;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(colour: string): number {
  const [r, g, b] = parse(colour);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast of `ink`, composited onto `ground`, against `ground`. */
export function contrastOn(ink: string, ground: string): number {
  const a = luminance(over(ink, ground));
  const b = luminance(ground);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Renders inside the app's paper theme, so text with no colour of its own takes the theme's. */
export function themed(element: React.ReactElement, isDark: boolean): React.ReactElement {
  return <PaperProvider theme={isDark ? darkTheme : lightTheme}>{element}</PaperProvider>;
}

/**
 * The colour that lands behind `node`: every fill between it and `root`, laid
 * over `ground` outermost first, so a word on a filled badge is measured on the
 * badge rather than on the surface the badge sits on.
 */
function groundBehind(node: ReactTestInstance, root: ReactTestInstance, ground: string): string {
  const fills: string[] = [];
  for (let at: ReactTestInstance | null = node; at && at !== root; at = at.parent) {
    const fill = StyleSheet.flatten(at.props.style ?? {})?.backgroundColor;
    if (typeof fill === 'string') fills.push(fill);
  }
  return fills.reduceRight((base, fill) => over(fill, base), ground);
}

/**
 * Every text colour and every icon colour under `root`, the whole rendered tree
 * by default, that falls below its bar on the ground behind it, `ground` under
 * whatever fills the tree lays over it, as `colour on ground: ratio` lines, so a
 * failure names what it measured. An empty list is a pass.
 */
export function underBar(ground: string, root: ReactTestInstance = screen.UNSAFE_root): string[] {
  const out: string[] = [];
  for (const node of root.findAllByType(Text)) {
    const colour = StyleSheet.flatten(node.props.style)?.color;
    if (typeof colour !== 'string') continue;
    const behind = groundBehind(node, root, ground);
    const ratio = contrastOn(colour, behind);
    if (ratio < AA_TEXT) out.push(`text ${colour} on ${behind}: ${ratio.toFixed(2)}`);
  }
  for (const node of root.findAllByType(MaterialCommunityIcons)) {
    const colour = node.props.color;
    if (typeof colour !== 'string') continue;
    const behind = groundBehind(node, root, ground);
    const ratio = contrastOn(colour, behind);
    if (ratio < AA_MARK) out.push(`icon ${colour} on ${behind}: ${ratio.toFixed(2)}`);
  }
  return out;
}

/** How many text nodes carry a colour, so a test can tell it measured something. */
export function textCount(root: ReactTestInstance = screen.UNSAFE_root): number {
  return root
    .findAllByType(Text)
    .filter((node) => typeof StyleSheet.flatten(node.props.style)?.color === 'string').length;
}
