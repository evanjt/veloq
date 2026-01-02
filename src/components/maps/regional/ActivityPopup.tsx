import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { formatDistance, formatDuration, formatFullDateWithWeekday } from '@/lib';
import { getActivityTypeConfig } from '../ActivityTypeFilter';
import type { ActivityBoundsItem, ActivityMapData } from '@/types';

export interface SelectedActivity {
  activity: ActivityBoundsItem;
  mapData: ActivityMapData | null;
  isLoading: boolean;
}

interface ActivityPopupProps {
  selected: SelectedActivity;
  bottom: number;
  onZoom: () => void;
  onClose: () => void;
  onViewDetails: () => void;
}

export function ActivityPopup({
  selected,
  bottom,
  onZoom,
  onClose,
  onViewDetails,
}: ActivityPopupProps) {
  const { t } = useTranslation();
  const config = getActivityTypeConfig(selected.activity.type);

  return (
    <View style={[styles.popup, { bottom }]}>
      <View style={styles.popupHeader}>
        <View style={styles.popupInfo}>
          <Text style={styles.popupTitle} numberOfLines={1}>
            {selected.activity.name}
          </Text>
          <Text style={styles.popupDate}>
            {formatFullDateWithWeekday(selected.activity.date)}
          </Text>
        </View>
        <View style={styles.popupHeaderButtons}>
          <TouchableOpacity
            onPress={onZoom}
            style={styles.popupIconButton}
            accessibilityLabel={t('maps.zoomToActivity')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onClose}
            style={styles.popupIconButton}
            accessibilityLabel={t('maps.closePopup')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.popupStats}>
        <View style={styles.popupStat}>
          <Ionicons name={config.icon} size={20} color={config.color} />
          <Text style={styles.popupStatValue}>{selected.activity.type}</Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.chartBlue} />
          <Text style={styles.popupStatValue}>{formatDistance(selected.activity.distance)}</Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="clock-outline" size={20} color={colors.chartOrange} />
          <Text style={styles.popupStatValue}>{formatDuration(selected.activity.duration)}</Text>
        </View>
      </View>

      {selected.isLoading && (
        <View style={styles.popupLoading}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.popupLoadingText}>{t('maps.loadingRoute')}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.viewDetailsButton} onPress={onViewDetails}>
        <Text style={styles.viewDetailsText}>{t('maps.viewDetails')}</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

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
  popupLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: layout.cardMargin,
  },
  popupLoadingText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
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
