import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { getActivityTypeConfig } from '../ActivityTypeFilter';
import { formatDuration } from '@/lib';
import type { ActivityType } from '@/types';

interface RouteGroupInfo {
  id: string;
  name: string;
  activityCount: number;
  sportType: string;
  type: ActivityType;
  bestTime?: number;
}

interface RoutePopupProps {
  route: RouteGroupInfo;
  bottom: number;
  onClose: () => void;
  onViewDetails?: () => void;
}

export function RoutePopup({ route, bottom, onClose, onViewDetails }: RoutePopupProps) {
  const config = getActivityTypeConfig(route.type);

  return (
    <View style={[styles.popup, { bottom }]}>
      <View style={styles.popupHeader}>
        <View style={styles.popupInfo}>
          <Text style={styles.popupTitle} numberOfLines={1}>
            {route.name}
          </Text>
          <Text style={styles.popupDate}>{route.activityCount} activities</Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.popupIconButton}
          accessibilityLabel="Close route popup"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.popupStats}>
        <View style={styles.popupStat}>
          <Ionicons name={config.icon} size={20} color={config.color} />
          <Text style={styles.popupStatValue}>{route.sportType}</Text>
        </View>
        {route.bestTime && route.bestTime > 0 && (
          <View style={styles.popupStat}>
            <MaterialCommunityIcons name="trophy" size={20} color={colors.chartAmber} />
            <Text style={styles.popupStatValue}>{formatDuration(route.bestTime)}</Text>
          </View>
        )}
      </View>

      {onViewDetails && (
        <TouchableOpacity
          onPress={onViewDetails}
          style={styles.viewDetailsButton}
          accessibilityLabel="View route details"
          accessibilityRole="button"
        >
          <Text style={styles.viewDetailsText}>View Details</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
        </TouchableOpacity>
      )}
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
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    gap: 4,
  },
  viewDetailsText: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
});
