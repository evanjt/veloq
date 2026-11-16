// Brushing: a drag across a plot picks an x range to zoom to. A drag too short
// to be one is a click and picks nothing.

import { useState } from 'react';

import { brushDomain, type XScale } from './scale';

export type Drag = { from: number; to: number };

export function useBrush(x: XScale, enabled: boolean, commit: (domain: [number, number]) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  return {
    drag,
    /** Starts a drag at pixel `px` from the drawing's left edge. */
    start: (px: number) => {
      if (enabled) setDrag({ from: px, to: px });
    },
    move: (px: number) => {
      if (drag) setDrag({ from: drag.from, to: px });
    },
    /** Ends the drag; true when it was a brush and `commit` was told its domain. */
    end: (): boolean => {
      if (!drag) return false;
      const domain = brushDomain(drag.from, drag.to, x);
      setDrag(null);
      if (domain) commit(domain);
      return domain !== null;
    },
    cancel: () => setDrag(null),
  };
}
