import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { darkColors, layout } from '@/theme';

/**
 * Every view under `root` drawn as a card container in the dark theme that
 * does not draw Card's ground: a panel at a card's radius or more, on a dark
 * surface or with an edge, off the card surface, the card radius or the raised edge. Empty when every
 * container is a Card.
 */
export function strayCardGrounds(root: ReactTestInstance): string[] {
  const stray: string[] = [];
  for (const node of root.findAll((n) => (n.type as unknown) === 'View')) {
    const style = StyleSheet.flatten(node.props.style) ?? {};
    const ground = style.backgroundColor;
    const edge = style.borderWidth;
    const darkGround = ground === darkColors.surface || ground === darkColors.surfaceRaised;
    // A transparent edge holds a control's layout and draws nothing.
    const bordered = typeof edge === 'number' && edge > 0 && style.borderColor !== 'transparent';
    const radius = style.borderRadius;
    if (typeof radius !== 'number' || radius < layout.borderRadiusMd) continue;
    if (!darkGround && !bordered) continue;
    const isCard =
      ground === darkColors.surfaceRaised &&
      style.borderRadius === layout.borderRadius &&
      (edge == null || (edge === 1 && style.borderColor === darkColors.cardEdge));
    if (!isCard) {
      stray.push(
        `${node.props.testID ?? 'view'}: ground ${String(ground)}, radius ${String(style.borderRadius)}, edge ${String(edge)}`
      );
    }
  }
  return stray;
}
