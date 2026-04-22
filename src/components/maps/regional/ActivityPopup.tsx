import React, { memo, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing, shadows } from '@/theme';
import { formatDistance, formatDuration, formatFullDateWithWeekday } from '@/lib';
import { useMetricSystem, useTheme } from '@/hooks';
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
  const { isDark } = useTheme();

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
      style={[
        styles.popup,
        isDark && styles.popupDark,
        { bottom, opacity, transform: [{ translateY }] },
      ]}
      pointerEvents="auto"
    >
      <View style={styles.popupHeader}>
        <View style={styles.popupInfo}>
          <Text style={[styles.popupTitle, isDark && styles.popupTitleDark]} numberOfLines={1}>
            {selected?.activity.name ?? ''}
          </Text>
          <Text style={[styles.popupDate, isDark && styles.popupDateDark]}>{formattedDate}</Text>
        </View>
        <Pressable
          testID="activity-popup-view-details"
          onPress={onViewDetails}
          style={styles.viewDetailsInline}
          accessibilityLabel={t('maps.viewDetails')}
          accessibilityRole="button"
        >
          <Text style={styles.viewDetailsText}>{t('maps.viewDetails')}</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
        </Pressable>
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
            <MaterialCommunityIcons
              name="close"
              size={22}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      <View style={[styles.popupStats, isDark && styles.popupStatsDark]}>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons
            name={activityIcon}
            size={20}
            color={config?.color ?? colors.primary}
          />
          <Text style={[styles.popupStatValue, isDark && styles.popupStatValueDark]}>
            {selected?.activity.type ?? ''}
          </Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.chartBlue} />
          <Text style={[styles.popupStatValue, isDark && styles.popupStatValueDark]}>
            {formattedDistance}
          </Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="clock-outline" size={20} color={colors.chartAmber} />
          <Text style={[styles.popupStatValue, isDark && styles.popupStatValueDark]}>
            {formattedDuration}
          </Text>
        </View>
      </View>
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.modal,
  },
  popupDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  popupHeaderButtons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  popupIconButton: {
    padding: 4,
  },
  popupInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  popupTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  popupTitleDark: {
    color: darkColors.textPrimary,
  },
  popupDate: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 1,
  },
  popupDateDark: {
    color: darkColors.textSecondary,
  },
  popupStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 6,
  },
  popupStatsDark: {},
  popupStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  popupStatValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  popupStatValueDark: {
    color: darkColors.textPrimary,
  },
  viewDetailsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  viewDetailsText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
});
