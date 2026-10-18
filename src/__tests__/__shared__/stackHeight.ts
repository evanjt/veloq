/**
 * The height a rendered tree stands at, from its styles, for the flex subset the
 * cards and rows use: an explicit or minimum height, vertical padding, margin
 * and border, a column that stacks with its gap, a row as tall as its tallest
 * child, and a text as tall as its line height at the window's text scale. An
 * absolutely placed view takes no room. Wrapping is not modelled, so compare at
 * widths where nothing wraps.
 *
 * A text with no line height has no height a test can know, so it throws
 * rather than guess.
 */

import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

type Node = ReactTestRendererJSON | string;

function flat(style: unknown): ViewStyle & TextStyle {
  return (StyleSheet.flatten(style as StyleProp<TextStyle>) ?? {}) as ViewStyle & TextStyle;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function side(s: ViewStyle, edge: 'Top' | 'Bottom', kind: 'padding' | 'margin'): number {
  const record = s as Record<string, unknown>;
  return num(record[`${kind}${edge}`]) ?? num(record[`${kind}Vertical`]) ?? num(record[kind]) ?? 0;
}

function border(s: ViewStyle, edge: 'Top' | 'Bottom'): number {
  return num(s[`border${edge}Width`]) ?? num(s.borderWidth) ?? 0;
}

function children(node: ReactTestRendererJSON): Node[] {
  return node.children ?? [];
}

function placed(node: Node): node is ReactTestRendererJSON {
  if (typeof node === 'string') return false;
  return flat(node.props.style).position !== 'absolute';
}

function boxHeight(node: ReactTestRendererJSON, fontScale: number): number {
  const s = flat(node.props.style);
  let inner: number;
  if (node.type === 'Text') {
    if (typeof s.lineHeight !== 'number') {
      throw new Error(`a text with no line height: ${JSON.stringify(node.children)}`);
    }
    inner = s.lineHeight * fontScale;
  } else {
    const kids = children(node).filter(placed);
    const heights = kids.map((kid) => outerHeight(kid, fontScale));
    if (s.flexDirection === 'row' || s.flexDirection === 'row-reverse') {
      inner = heights.length > 0 ? Math.max(...heights) : 0;
    } else {
      const gap = num(s.rowGap) ?? num(s.gap) ?? 0;
      inner = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, heights.length - 1);
    }
  }
  const frame =
    side(s, 'Top', 'padding') +
    side(s, 'Bottom', 'padding') +
    border(s, 'Top') +
    border(s, 'Bottom');
  const explicit = num(s.height);
  const content = explicit ?? inner + frame;
  return Math.max(content, num(s.minHeight) ?? 0);
}

/** The node's height with its own vertical margins. */
export function outerHeight(node: Node, fontScale: number): number {
  if (typeof node === 'string') return 0;
  const s = flat(node.props.style);
  return boxHeight(node, fontScale) + side(s, 'Top', 'margin') + side(s, 'Bottom', 'margin');
}

/** The height of a whole rendered tree, which may be several roots. */
export function treeHeight(
  tree: ReactTestRendererJSON | ReactTestRendererJSON[] | null,
  fontScale: number
): number {
  if (tree === null) return 0;
  const roots = Array.isArray(tree) ? tree : [tree];
  return roots.filter(placed).reduce((sum, root) => sum + outerHeight(root, fontScale), 0);
}
