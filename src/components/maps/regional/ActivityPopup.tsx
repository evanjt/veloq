import React, { memo, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { formatDistance, formatDuration, formatFullDateWithWeekday } from '@/lib';
import { useMetricSystem } from '@/hooks';
import { getActivityTypeConfig } from '../ActivityTypeFilter';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import type { ActivityBoundsItem, ActivityMapData } from '@/types';

export interface SelectedActivity {
  activity: ActivityBoundsItem;
  mapData: ActivityMapData | null;
  isLoading: boolean;
  /** Pre-computed GeoJSON coordinates [lng, lat][] for instant route rendering */
  routeCoords?: [number, number][];
}

interface ActivityPopupProps {
  selected: SelectedActivity | null;
  bottom: number;
  onZoom: () => void;
  onClose: () => void;
  onViewDetails: () => void;
}

/**
 * Activity popup - always mounted for instant show/hide.
 * Uses opacity + pointerEvents instead of mount/unmount.
 */
export const ActivityPopup = memo(function ActivityPopup({
  selected,
  bottom,
  onZoom,
  onClose,
  onViewDetails,
}: ActivityPopupProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  // Memoize config lookup
  const config = useMemo(
    () => (selected ? getActivityTypeConfig(selected.activity.type) : null),
    [selected?.activity.type]
  );

  // Memoize icon name
  const activityIcon = useMemo(
    () => (selected ? getActivityIcon(selected.activity.type) : 'run'),
    [selected?.activity.type]
  );

  // Memoize formatted values
  const formattedDate = useMemo(
    () => (selected ? formatFullDateWithWeekday(selected.activity.date) : ''),
    [selected?.activity.date]
  );

  const formattedDistance = useMemo(
    () => (selected ? formatDistance(selected.activity.distance, isMetric) : ''),
    [selected?.activity.distance, isMetric]
  );

  const formattedDuration = useMemo(
    () => (selected ? formatDuration(selected.activity.duration) : ''),
    [selected?.activity.duration]
  );

  // Always render but hide when no selection - avoids mount/unmount overhead
  const isVisible = !!selected;

  // Animate opacity for smooth show/hide
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (isVisible) {
      // Animate in - fast for snappy feel
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          tension: 300,
          friction: 20,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Animate out - instant
      opacity.setValue(0);
      translateY.setValue(12);
    }
  }, [isVisible, opacity, translateY]);

  // Don't render content when not visible (prevents empty popup flash)
  if (!isVisible) {
    return null;
  }

  return (
    <Animated.View
      testID="activity-popup"
      style={[styles.popup, { bottom, opacity, transform: [{ translateY }] }]}
      pointerEvents="auto"
    >
      <View style={styles.popupHeader}>
        <View style={styles.popupInfo}>
          <Text style={styles.popupTitle} numberOfLines={1}>
            {selected?.activity.name ?? ''}
          </Text>
          <Text style={styles.popupDate}>{formattedDate}</Text>
        </View>
        <View style={styles.popupHeaderButtons}>
          <Pressable
            testID="activity-popup-zoom"
            onPress={onZoom}
            style={styles.popupIconButton}
            accessibilityLabel={t('maps.zoomToActivity')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={colors.primary} />
          </Pressable>
          <Pressable
            testID="activity-popup-close"
            onPress={onClose}
            style={styles.popupIconButton}
            accessibilityLabel={t('maps.closePopup')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.popupStats}>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons
            name={activityIcon}
            size={20}
            color={config?.color ?? colors.primary}
          />
          <Text style={styles.popupStatValue}>{selected?.activity.type ?? ''}</Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.chartBlue} />
          <Text style={styles.popupStatValue}>{formattedDistance}</Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="clock-outline" size={20} color={colors.chartAmber} />
          <Text style={styles.popupStatValue}>{formattedDuration}</Text>
        </View>
      </View>

      <Pressable
        testID="activity-popup-view-details"
        style={styles.viewDetailsButton}
        onPress={onViewDetails}
      >
        <Text style={styles.viewDetailsText}>{t('maps.viewDetails')}</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  popup: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: spacing.md,
    padding: spacing.md,
    ...shadows.modal,
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: layout.cardMargin,
  },
  popupHeaderButtons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  popupIconButton: {
    padding: spacing.xs,
  },
  popupInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  popupTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  popupDate: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  popupStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: layout.cardMargin,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    marginBottom: layout.cardMargin,
  },
  popupStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupStatValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  viewDetailsText: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
});
