import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing } from '@/theme';
import { RecordingMap } from '@/components/recording/RecordingMap';
import { TrimSlider } from '@/components/recording/TrimSlider';

interface ReviewMapHeroProps {
  coordinates: [number, number][];
  mapHeight: number;
  topInset: number;
  canTrim: boolean;
  trimStart: number;
  trimEnd: number;
  totalDuration: number;
  totalPoints: number;
  onTrimChange: (startIdx: number, endIdx: number) => void;
  onBack: () => void;
  disabled?: boolean;
}

function ReviewMapHeroInner({
  coordinates,
  mapHeight,
  topInset,
  canTrim,
  trimStart,
  trimEnd,
  totalDuration,
  totalPoints,
  onTrimChange,
  onBack,
  disabled,
}: ReviewMapHeroProps) {
  return (
    <View style={[styles.mapContainer, { height: mapHeight, paddingTop: topInset }]}>
      <RecordingMap
        coordinates={coordinates}
        currentLocation={null}
        fitBounds
        trimStart={canTrim ? trimStart : undefined}
        trimEnd={canTrim ? trimEnd : undefined}
        style={styles.map}
      />

      {/* Back button overlaid on map */}
      <TouchableOpacity
        onPress={onBack}
        style={[styles.mapBackButton, { top: topInset + spacing.sm }]}
        disabled={disabled}
      >
        <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Trim slider overlaid at bottom of map */}
      {canTrim && (
        <View testID="review-trim" style={styles.trimOverlay}>
          <TrimSlider
            totalDuration={totalDuration}
            totalPoints={totalPoints}
            startIdx={trimStart}
            endIdx={trimEnd}
            onTrimChange={onTrimChange}
          />
        </View>
      )}
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
  mapBackButton: {
    position: 'absolute',
    left: spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
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
