import React from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '@/theme';
import { RecordingMap } from '@/features/recording/components/RecordingMap';
import { TrimSlider } from '@/features/recording/components/TrimSlider';

interface ReviewMapHeroProps {
  coordinates: [number, number][];
  mapHeight: number;
  topInset: number;
  canTrim: boolean;
  trimStart: number;
  trimEnd: number;
  /**
   * The trim the map draws. Re-slicing both halves of the track and shipping
   * them to the WebView is too much for a gesture frame, so the map follows
   * the released handle while the slider and the summary follow the finger.
   */
  mapTrimStart: number;
  mapTrimEnd: number;
  totalDuration: number;
  totalPoints: number;
  onTrimChange: (startIdx: number, endIdx: number) => void;
  onTrimCommit: (startIdx: number, endIdx: number) => void;
}

function ReviewMapHeroInner({
  coordinates,
  mapHeight,
  topInset,
  canTrim,
  trimStart,
  trimEnd,
  mapTrimStart,
  mapTrimEnd,
  totalDuration,
  totalPoints,
  onTrimChange,
  onTrimCommit,
}: ReviewMapHeroProps) {
  return (
    <View style={[styles.mapContainer, { height: mapHeight, paddingTop: topInset }]}>
      <RecordingMap
        coordinates={coordinates}
        currentLocation={null}
        fitBounds
        trimStart={canTrim ? mapTrimStart : undefined}
        trimEnd={canTrim ? mapTrimEnd : undefined}
        style={styles.map}
      />

      {/* Trim slider overlaid at bottom of map */}
      {canTrim ? (
        <View testID="review-trim" style={styles.trimOverlay}>
          <TrimSlider
            totalDuration={totalDuration}
            totalPoints={totalPoints}
            startIdx={trimStart}
            endIdx={trimEnd}
            onTrimChange={onTrimChange}
            onTrimCommit={onTrimCommit}
          />
        </View>
      ) : null}
    </View>
  );
}

export const ReviewMapHero = React.memo(ReviewMapHeroInner);

const styles = StyleSheet.create({
  mapContainer: {
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  trimOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
