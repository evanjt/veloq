import type { ReactTestRendererJSON } from 'react-test-renderer';

/**
 * Where a sheet route's scroll view sits, read the way the iOS form sheet looks for it.
 *
 * The sheet sizes a scroll view that is the first view of its content, or the second after a
 * header: `root` and `second`. Otherwise it follows the first child of each view down from the
 * content, and a scroll view met on that path gets the sheet's own frame as its frame, in the
 * coordinates of the view it sits in, which moves it out of sight: `nested`. The sheet then shows
 * its frame and none of its content. `none` is a sheet with no scroll view on that path.
 */
export type SheetScrollPlacement = 'root' | 'second' | 'nested' | 'none';

type Rendered = ReactTestRendererJSON | ReactTestRendererJSON[] | null;

function isScrollView(node: ReactTestRendererJSON | string | undefined): boolean {
  return typeof node === 'object' && node.type === 'RCTScrollView';
}

export function sheetScrollPlacement(rendered: Rendered): SheetScrollPlacement {
  const content = rendered == null ? [] : Array.isArray(rendered) ? rendered : [rendered];
  if (isScrollView(content[0])) return 'root';
  if (isScrollView(content[1])) return 'second';
  if (content.slice(2).some((node) => isScrollView(node))) return 'nested';

  let node: ReactTestRendererJSON | string | undefined = content[0];
  while (typeof node === 'object') {
    const first: ReactTestRendererJSON | string | undefined = node.children?.[0];
    if (isScrollView(first)) return 'nested';
    node = first;
  }
  return 'none';
}

function depthFirst(
  rendered: Rendered,
  match: (node: ReactTestRendererJSON) => boolean
): ReactTestRendererJSON | null {
  const stack = rendered == null ? [] : Array.isArray(rendered) ? [...rendered] : [rendered];
  stack.reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (match(node)) return node;
    const children = (node.children ?? []).filter(
      (child): child is ReactTestRendererJSON => typeof child === 'object'
    );
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return null;
}

/**
 * Whether the Android form sheet hands a drag inside it to the sheet's scrolling body.
 *
 * The sheet hands a drag to its content only through the first view, depth first, that scrolls
 * nested. With none it takes every drag it can follow, so at its highest stop a drag down moves
 * the sheet and the body never scrolls back to its top; with another view first, the drag goes
 * there. So the first vertical scroll view must be the first nested scrolling view.
 */
export function sheetScrollHandsOff(rendered: Rendered): boolean {
  const body = depthFirst(rendered, (node) => isScrollView(node) && !node.props.horizontal);
  const nested = depthFirst(rendered, (node) => node.props.nestedScrollEnabled === true);
  return body != null && nested === body;
}
