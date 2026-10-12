/**
 * The width a chart is given, measured from its own box rather than taken
 * from the window. A sheet, a column or a pane is narrower than the window,
 * so window arithmetic draws past its edge.
 *
 * Spread `onLayout` onto the view that fills the space the chart may use.
 * `width` is 0 until that view has been laid out, and a chart draws nothing
 * until then.
 */

import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

export interface MeasuredWidth {
  width: number;
  onLayout: (event: LayoutChangeEvent) => void;
}

export function useMeasuredWidth(): MeasuredWidth {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.max(0, event.nativeEvent.layout.width));
  }, []);
  return { width, onLayout };
}
