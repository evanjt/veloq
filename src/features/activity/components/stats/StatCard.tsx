/**
 * Individual stat card component for InsightfulStats.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkColors, typography, layout, spacing, themedStyles, type Palette } from '@/theme';
import { DenseText } from '@/shared/ui/DenseText';
import { composeAccessibilityLabel, pressable, pressRipple } from '@/shared/ui';

import type { StatDetail } from './types';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';

interface StatCardProps {
  stat: StatDetail;
  isDark: boolean;
  onPress: (stat: StatDetail) => void;
}

export const StatCard = React.memo(function StatCard({ stat, isDark, onPress }: StatCardProps) {
  const styles = themedStyles(makeStyles, isDark);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={composeAccessibilityLabel(stat.title, stat.value, stat.context)}
      onLongPress={() => onPress(stat)}
      onPress={() => onPress(stat)}
      delayLongPress={PREVIEW_HOLD_MS}
      style={pressable(styles.statCard)}
      android_ripple={pressRipple}
    >
      {/* Icon with colored background */}
      <View style={[styles.iconContainer, { backgroundColor: `${stat.color}20` }]}>
        <MaterialCommunityIcons name={stat.icon} size={16} color={stat.color} />
      </View>

      {/* Value and title */}
      <View style={styles.statContent}>
        <DenseText style={styles.statValue}>
          {stat.value}
          {stat.unit ? <DenseText style={styles.statUnit}> {stat.unit}</DenseText> : null}
        </DenseText>
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

// The elevated surface is a role only the dark theme has, so the light card
// takes the background.
const makeStyles = (palette: Palette, isDark: boolean) =>
  StyleSheet.create({
    statCard: {
      width: '31%', // 3 columns with gaps
      backgroundColor: isDark ? darkColors.surfaceElevated : palette.background,
      borderRadius: layout.borderRadiusMd,
      padding: spacing.sm,
      position: 'relative',
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
      color: palette.textPrimary,
    },
    statUnit: {
      fontSize: typography.micro.fontSize,
      fontWeight: '600',
      color: palette.textSecondary,
    },
    statTitle: {
      fontSize: typography.micro.fontSize,
      color: palette.textSecondary,
    },
    contextText: {
      fontSize: typography.micro.fontSize,
      color: palette.textSecondary,
    },
  });
