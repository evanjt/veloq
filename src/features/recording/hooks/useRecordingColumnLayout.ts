import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { recordingColumnLayout } from '../lib/recordingColumnLayout';

function useMeasuredHeight(): [number | null, (event: LayoutChangeEvent) => void] {
  const [height, setHeight] = useState<number | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setHeight((prev) => (prev === next ? prev : next));
  }, []);
  return [height, onLayout];
}

/**
 * Measures the recording screen's top region and the blocks in it, and gives
 * the map its height through `recordingColumnLayout`. Until the region is
 * measured the map height is null and the map fills what is left by flex.
 */
export function useRecordingColumnLayout() {
  const [regionHeight, onRegionLayout] = useMeasuredHeight();
  const [headHeight, onHeadLayout] = useMeasuredHeight();
  const [tilesHeight, onTilesLayout] = useMeasuredHeight();

  if (regionHeight === null) {
    return { mapHeight: null, scrolls: false, onRegionLayout, onHeadLayout, onTilesLayout };
  }
  const { mapHeight, scrolls } = recordingColumnLayout({
    regionHeight,
    fixedContentHeight: (headHeight ?? 0) + (tilesHeight ?? 0),
  });
  return { mapHeight, scrolls, onRegionLayout, onHeadLayout, onTilesLayout };
}
