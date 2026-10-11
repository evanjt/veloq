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
