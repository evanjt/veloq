/**
 * Individual stat card component for InsightfulStats.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  chartStreamColors,
  darkColors,
  iconSize,
  layout,
  type Palette,
  spacing,
  themedStyles,
} from '@/theme';
import {
  composeAccessibilityLabel,
  KeyDot,
  StatTile,
  pressable,
  pressRipple,
  useTextScaleColumns,
} from '@/shared/ui';

import type { StatDetail } from './types';

interface StatCardProps {
  stat: StatDetail;
  isDark: boolean;
  onPress: (stat: StatDetail) => void;
}

/** Columns the grid lays out at the default text size. */
const GRID_COLUMNS = 3;

/** A card's share of its row, leaving room for the grid's gaps between columns. */
function cardWidth(columns: number): `${number}%` {
  return columns === 1 ? '100%' : `${Math.floor(100 / columns) - 2}%`;
}

export const StatCard = React.memo(function StatCard({ stat, isDark, onPress }: StatCardProps) {
  const styles = themedStyles(makeStyles, isDark);
  const width = cardWidth(useTextScaleColumns(GRID_COLUMNS));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={composeAccessibilityLabel(stat.title, stat.value, stat.context)}
      onPress={() => onPress(stat)}
      style={pressable([styles.statCard, { width }])}
      android_ripple={pressRipple}
    >
      {/* The icon names the measure in the secondary ink; only a stream measure
          carries a colour, as the dot that keys it to its chart line. */}
      <View style={styles.markRow}>
        <View testID="stat-icon-disc" style={styles.iconContainer}>
          <MaterialCommunityIcons name={stat.icon} size={iconSize.sm} color={styles.icon.color} />
        </View>
        {stat.stream ? (
          <KeyDot testID="stat-key-dot" color={chartStreamColors[stat.stream]} />
        ) : null}
      </View>

      <StatTile
        label={stat.title}
        value={stat.value}
        unit={stat.unit}
        caption={stat.context}
        accessible={false}
      />
    </Pressable>
  );
});

// The elevated surface is a role only the dark theme has, so the light card
// takes the background.
const makeStyles = (palette: Palette, isDark: boolean) =>
  StyleSheet.create({
    statCard: {
      backgroundColor: isDark ? darkColors.surfaceElevated : palette.background,
      borderRadius: layout.borderRadiusMd,
      padding: spacing.sm,
      position: 'relative',
    },
    markRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xsPlus,
    },
    iconContainer: {
      width: 28,
      height: 28,
      borderRadius: layout.borderRadiusSm,
      backgroundColor: palette.fillNeutral,
      justifyContent: 'center',
      alignItems: 'center',
    },
    icon: {
      color: palette.textSecondary,
    },
  });
