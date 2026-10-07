import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { ChartSkeleton, Shimmer, useHeroMapHeight } from '@/shared/ui';
import {
  ACTIVITY_MAP_POSTER_TEST_ID,
  getTerrainPreviewUri,
  hasTerrainPreview,
  useMapPreferences,
} from '@/features/maps';
import { layout, spacing } from '@/theme';

interface ActivityDetailSkeletonProps {
  activityId: string;
}

/**
 * The detail screen's shape while its first reads are pending. The activity's
 * type is not known yet, so the poster is looked up for the default sport's
 * style, the 3D render first and the flat one after, which are the two the
 * feed card could have drawn.
 */
export function ActivityDetailSkeleton({ activityId }: ActivityDetailSkeletonProps) {
  const mapHeight = useHeroMapHeight();
  const { getStyleForActivity } = useMapPreferences();
  const style = getStyleForActivity('Ride', activityId);
  const posterUri = [true, false]
    .map((is3D) =>
      hasTerrainPreview(activityId, style, is3D)
        ? getTerrainPreviewUri(activityId, style, is3D)
        : null
    )
    .find((uri) => uri !== null);

  return (
    <View testID="activity-detail-skeleton">
      <View testID="activity-detail-skeleton-hero" style={{ height: mapHeight }}>
        {posterUri ? (
          <Image
            testID={ACTIVITY_MAP_POSTER_TEST_ID}
            source={{ uri: posterUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <Shimmer width="100%" height={mapHeight} borderRadius={0} />
        )}
        <View style={styles.heroText}>
          <Shimmer width="60%" height={24} borderRadius={layout.borderRadiusXs} />
          <Shimmer width="40%" height={16} borderRadius={layout.borderRadiusXs} />
        </View>
      </View>
      <View style={styles.charts}>
        <ChartSkeleton height={220} />
        <ChartSkeleton height={160} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroText: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    gap: spacing.sm,
  },
  charts: {
    padding: spacing.md,
    gap: spacing.lg,
  },
});
