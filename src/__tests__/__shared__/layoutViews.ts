/**
 * A layout pass for a rendered tree: every view that asks to be measured is
 * given the box. A chart that mounts a measured child once it has its own
 * width gets that child laid out on the next pass, so this repeats until a
 * pass finds no view it has not laid out yet.
 */

import { View } from 'react-native';
import { fireEvent, type render } from '@testing-library/react-native';

type Tree = Pick<Awaited<ReturnType<typeof render>>, 'UNSAFE_getAllByType'>;

const MAX_PASSES = 6;

export async function layoutViews(tree: Tree, width: number, height: number): Promise<void> {
  const seen = new Set<unknown>();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const fresh = tree
      .UNSAFE_getAllByType(View)
      .filter((node) => node.props.onLayout && !seen.has(node));
    if (fresh.length === 0) return;
    for (const node of fresh) {
      seen.add(node);
      await fireEvent(node, 'layout', { nativeEvent: { layout: { width, height } } });
    }
  }
}
