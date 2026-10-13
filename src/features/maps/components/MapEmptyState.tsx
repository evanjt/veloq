import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FfiMapEmptyReason_Tags, type FfiMapEmptyReason } from 'veloqrs';
import { EmptyState } from '@/shared/ui/EmptyState';
import { useTheme } from '@/shared/app';
import { colorWithOpacity, layout, spacing, themePalette } from '@/theme';

export const MAP_EMPTY_STATE_TEST_ID = 'map-empty-state';

/**
 * Why the map draws no activity, over the map and above its filter sheet.
 *
 * The engine names the cause. Each cause carries the action that changes it
 * where one exists: a wider period for an empty one, the filters cleared for
 * filters that hide every track. A download in flight ends on its own, and a
 * period of indoor sessions has nothing to draw.
 */
export function MapEmptyState({
  reason,
  allTime,
  onShowAllTime,
  onExpandRange,
  onClearFilters,
}: {
  reason: FfiMapEmptyReason;
  /** The period chosen is already the whole library. */
  allTime: boolean;
  onShowAllTime: () => void;
  onExpandRange: () => void;
  onClearFilters: () => void;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);

  const copy = (() => {
    if (reason.tag === FfiMapEmptyReason_Tags.NoActivities) {
      return {
        icon: 'map-outline' as const,
        title: t('mapScreen.emptyNoActivities'),
        ...(allTime
          ? {
              description: t('mapScreen.emptyNoActivitiesAllTimeHint'),
              actionLabel: t('mapScreen.expandRange'),
              onAction: onExpandRange,
            }
          : {
              description: t('mapScreen.emptyNoActivitiesHint'),
              actionLabel: t('mapScreen.emptyShowAllTime'),
              onAction: onShowAllTime,
            }),
      };
    }
    if (reason.tag === FfiMapEmptyReason_Tags.Filtered) {
      return {
        icon: 'filter-variant-remove' as const,
        title: t('mapScreen.emptyFiltered'),
        description: t('mapScreen.emptyFilteredHint', { count: reason.inner.mapped }),
        actionLabel: t('mapScreen.emptyClearFilters'),
        onAction: onClearFilters,
      };
    }
    if (reason.tag === FfiMapEmptyReason_Tags.TracksPending) {
      return {
        icon: 'cloud-download-outline' as const,
        title: t('mapScreen.emptyTracksPending'),
        description: t('mapScreen.emptyTracksPendingHint', { count: reason.inner.pending }),
      };
    }
    return {
      icon: 'map-marker-off-outline' as const,
      title: t('mapScreen.emptyNoGps'),
      description: t('mapScreen.emptyNoGpsHint'),
    };
  })();

  return (
    <View style={styles.layer} pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: colorWithOpacity(palette.surface, 0.94) }]}>
        <EmptyState variant="compact" testID={MAP_EMPTY_STATE_TEST_ID} {...copy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The map stays draggable around the card.
  layer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.md,
  },
});
