import React, { memo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, FlatList } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, typography, spacing, shadows } from '@/theme';
import { formatDistance, formatFullDateWithWeekday } from '@/lib';
import { useMetricSystem } from '@/hooks';
import { getActivityTypeConfig } from '../ActivityTypeFilter';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import type { ActivityBoundsItem } from '@/types';

interface ClusterPopupProps {
  activities: ActivityBoundsItem[];
  bottom: number;
  onClose: () => void;
  onSelectActivity: (activity: ActivityBoundsItem) => void;
}

export const ClusterPopup = memo(function ClusterPopup({
  activities,
  bottom,
  onClose,
  onSelectActivity,
}: ClusterPopupProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
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
  }, [opacity, translateY]);

  const renderItem = ({ item }: { item: ActivityBoundsItem }) => {
    const config = getActivityTypeConfig(item.type);
    const icon = getActivityIcon(item.type);

    return (
      <Pressable style={styles.row} onPress={() => onSelectActivity(item)}>
        <View style={[styles.iconCircle, { backgroundColor: config.color }]}>
          <MaterialCommunityIcons name={icon} size={16} color={colors.textOnDark} />
        </View>
        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.rowDate}>{formatFullDateWithWeekday(item.date)}</Text>
        </View>
        <Text style={styles.rowDistance}>{formatDistance(item.distance, isMetric)}</Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textSecondary} />
      </Pressable>
    );
  };

  return (
    <Animated.View
      style={[styles.popup, { bottom, opacity, transform: [{ translateY }] }]}
      pointerEvents="auto"
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('maps.activitiesCount', { count: activities.length })}</Text>
        <Pressable onPress={onClose} style={styles.closeButton}>
          <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
      <FlatList
        data={activities}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        style={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  popup: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    maxHeight: 280,
    backgroundColor: colors.surface,
    borderRadius: spacing.md,
    padding: spacing.md,
    ...shadows.modal,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  rowDate: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 1,
  },
  rowDistance: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
