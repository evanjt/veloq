/**
 * Match quality indicator component.
 * Shows percentage match with color coding and direction icon.
 */

import React from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import type { MatchDirection } from '@/types';

interface MatchQualityIndicatorProps {
  /** Match percentage (0-100) */
  percentage: number;
  /** Match direction */
  direction: MatchDirection;
  /** Optional: show partial match distance */
  overlapDistance?: number;
  /** Compact mode (just percentage) */
  compact?: boolean;
}

function getMatchColor(percentage: number): string {
  if (percentage >= 90) return colors.success;
  if (percentage >= 70) return colors.warning;
  return colors.primary;
}

function getDirectionIcon(direction: MatchDirection): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (direction) {
    case 'same':
      return 'arrow-right';
    case 'reverse':
      return 'swap-horizontal';
    case 'partial':
      return 'vector-intersection';
  }
}

function getDirectionLabel(direction: MatchDirection): string {
  switch (direction) {
    case 'same':
      return 'Same direction';
    case 'reverse':
      return 'Reverse';
    case 'partial':
      return 'Partial';
  }
}

export function MatchQualityIndicator({
  percentage,
  direction,
  overlapDistance,
  compact = false,
}: MatchQualityIndicatorProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const matchColor = getMatchColor(percentage);
  const directionIcon = getDirectionIcon(direction);

  if (compact) {
    return (
      <View style={[styles.compactContainer, { backgroundColor: matchColor + '20' }]}>
        <Text style={[styles.compactPercentage, { color: matchColor }]}>
          {percentage}%
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Circular progress indicator */}
      <View style={styles.progressRing}>
        <View
          style={[
            styles.progressFill,
            { backgroundColor: matchColor + '20' },
          ]}
        />
        <View style={styles.progressCenter}>
          <Text style={[styles.percentage, { color: matchColor }]}>
            {percentage}
          </Text>
          <Text style={[styles.percentSign, { color: matchColor }]}>%</Text>
        </View>
      </View>

      {/* Direction and details */}
      <View style={styles.details}>
        <View style={styles.directionRow}>
          <MaterialCommunityIcons
            name={directionIcon}
            size={16}
            color={isDark ? '#AAA' : colors.textSecondary}
          />
          <Text style={[styles.directionLabel, isDark && styles.textMuted]}>
            {getDirectionLabel(direction)}
          </Text>
        </View>

        {direction === 'partial' && overlapDistance != null && (
          <Text style={[styles.overlapText, isDark && styles.textMuted]}>
            {(overlapDistance / 1000).toFixed(1)}km overlap
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  containerDark: {},
  progressRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
  },
  progressCenter: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  percentage: {
    fontSize: typography.metricValue.fontSize,
    fontWeight: '700',
  },
  percentSign: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
  },
  details: {
    flex: 1,
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  directionLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  overlapText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  compactContainer: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
  },
  compactPercentage: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
});
