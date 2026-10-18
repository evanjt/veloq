import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FfiMapEmptyReason_Tags, type FfiMapEmptyReason } from 'veloqrs';
import { BottomPillSlot } from '@/shared/ui/BottomPillStack';
import { FloatingPill } from '@/shared/ui/FloatingPill';
import { layers, spacing } from '@/theme';

export const MAP_EMPTY_STATE_TEST_ID = 'map-empty-state';

/**
 * Why the map draws no activity, as a pill in the bottom stack over the map,
 * above its filter sheet, so the map stays draggable all around it.
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

  const action = (label: string, onPress: () => void) => ({
    label,
    onPress,
    testID: `${MAP_EMPTY_STATE_TEST_ID}-action`,
  });

  const copy = (() => {
    if (reason.tag === FfiMapEmptyReason_Tags.NoActivities) {
      return {
        icon: 'map-outline' as const,
        title: t('mapScreen.emptyNoActivities'),
        ...(allTime
          ? {
              detail: t('mapScreen.emptyNoActivitiesAllTimeHint'),
              action: action(t('mapScreen.expandRange'), onExpandRange),
            }
          : {
              detail: t('mapScreen.emptyNoActivitiesHint'),
              action: action(t('mapScreen.emptyShowAllTime'), onShowAllTime),
            }),
      };
    }
    if (reason.tag === FfiMapEmptyReason_Tags.Filtered) {
      return {
        icon: 'filter-variant-remove' as const,
        title: t('mapScreen.emptyFiltered'),
        detail: t('mapScreen.emptyFilteredHint', { count: reason.inner.mapped }),
        action: action(t('mapScreen.emptyClearFilters'), onClearFilters),
      };
    }
    if (reason.tag === FfiMapEmptyReason_Tags.TracksPending) {
      return {
        icon: 'cloud-download-outline' as const,
        title: t('mapScreen.emptyTracksPending'),
        detail: t('mapScreen.emptyTracksPendingHint', { count: reason.inner.pending }),
      };
    }
    return {
      icon: 'map-marker-off-outline' as const,
      title: t('mapScreen.emptyNoGps'),
      detail: t('mapScreen.emptyNoGpsHint'),
    };
  })();

  return (
    <BottomPillSlot pill="mapEmpty" layer={layers.mapOverlay}>
      <View style={styles.lane} pointerEvents="box-none">
        <FloatingPill
          {...copy}
          announcement={`${copy.title}. ${copy.detail}`}
          testID={MAP_EMPTY_STATE_TEST_ID}
        />
      </View>
    </BottomPillSlot>
  );
}

const styles = StyleSheet.create({
  lane: {
    marginHorizontal: spacing.md,
    alignItems: 'center',
  },
});
