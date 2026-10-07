/**
 * Individual stat card component for InsightfulStats.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, typography, layout, spacing } from '@/theme';
import { DenseText } from '@/shared/ui/DenseText';
import { pressable, pressRipple } from '@/shared/ui';

import type { StatDetail } from './types';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';

interface StatCardProps {
  stat: StatDetail;
  isDark: boolean;
  onPress: (stat: StatDetail) => void;
}

export const StatCard = React.memo(function StatCard({ stat, isDark, onPress }: StatCardProps) {
  return (
    <Pressable
      onLongPress={() => onPress(stat)}
      onPress={() => onPress(stat)}
      delayLongPress={PREVIEW_HOLD_MS}
      style={pressable([styles.statCard, isDark && styles.statCardDark])}
      android_ripple={pressRipple}
    >
      {/* Icon with colored background */}
      <View style={[styles.iconContainer, { backgroundColor: `${stat.color}20` }]}>
        <MaterialCommunityIcons name={stat.icon} size={16} color={stat.color} />
      </View>

      {/* Value and title */}
      <View style={styles.statContent}>
        <DenseText style={[styles.statValue, isDark && styles.textLight]}>{stat.value}</DenseText>
        <DenseText style={styles.statTitle}>{stat.title}</DenseText>
      </View>

      {/* Context line */}
      {stat.context ? (
        <DenseText style={styles.contextText} numberOfLines={1}>
          {stat.context}
        </DenseText>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  statCard: {
    width: '31%', // 3 columns with gaps
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    position: 'relative',
  },
  statCardDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xsPlus,
  },
  statContent: {
    marginBottom: spacing.xxs,
  },
  statValue: {
    fontSize: typography.metricValue.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  statTitle: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
  contextText: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
});
