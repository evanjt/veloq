// The grid a page lays its cards on. Tracks are at least 480 px wide and share the width, so
// every card runs to the right edge; the grid stops growing at 2000 px and sits at the left. A
// card may span two tracks, which the stylesheet honours only where two tracks tile the row.

import type { ReactNode } from 'react';

export function PageGrid(props: { children: ReactNode; id?: string; className?: string }) {
  const className = props.className ? `ui-page-grid ${props.className}` : 'ui-page-grid';
  return (
    <div id={props.id} className={className}>
      {props.children}
    </div>
  );
}

export function GridCell(props: { children: ReactNode; span?: 1 | 2 }) {
  return (
    <div className="ui-grid-cell" data-span={props.span === 2 ? 2 : undefined}>
      {props.children}
    </div>
  );
}
