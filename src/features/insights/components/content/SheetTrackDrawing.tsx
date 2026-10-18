import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '@/shared/app';
import { TrackPreview, normaliseTrackPoints } from '@/shared/ui/TrackPreview';
import type { LatLngShort } from '@/shared/geo/distance';

const DRAWING_HEIGHT = 150;

interface SheetTrackDrawingProps {
  points: LatLngShort[] | undefined;
  testID?: string;
}

/**
 * A track drawn across an insight sheet: the one thumbnail at the sheet's
 * width, measured here so the sheets that draw a section do not each carry
 * their own drawing. Nothing is drawn from fewer than two usable points.
 */
export const SheetTrackDrawing = React.memo(function SheetTrackDrawing({
  points,
  testID,
}: SheetTrackDrawingProps) {
  const { isDark } = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  }, []);
  const normalised = useMemo(() => normaliseTrackPoints(points ?? []), [points]);

  if (normalised.length < 2) return null;

  return (
    <View style={styles.drawing} onLayout={onLayout}>
      {width > 0 ? (
        <TrackPreview
          {...(testID !== undefined && { testID })}
          points={normalised}
          isDark={isDark}
          width={width}
          height={DRAWING_HEIGHT}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  drawing: {
    height: DRAWING_HEIGHT,
  },
});
