/**
 * Individual stat card component for InsightfulStats.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  chartStreamColour,
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
  useTextScaleColumns,
  PressTarget,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';

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
    <PressTarget
      accessibilityRole="button"
      accessibilityLabel={composeAccessibilityLabel(stat.title, stat.value, stat.context)}
      onPress={() => onPress(stat)}
      style={[styles.statCard, { width }]}
    >
      {/* The icon names the measure in the secondary ink; only a stream measure
          carries a colour, as the dot that keys it to its chart line. */}
      <View style={styles.markRow}>
        <View testID="stat-icon-disc" style={styles.iconContainer}>
          <Icon name={stat.icon} size={iconSize.sm} color={styles.icon.color} />
        </View>
        {stat.stream ? (
          <KeyDot testID="stat-key-dot" color={chartStreamColour(stat.stream, isDark)} />
        ) : null}
      </View>

      <StatTile
        label={stat.title}
        value={stat.value}
        unit={stat.unit}
        caption={stat.context}
        accessible={false}
      />
    </PressTarget>
  );
});

// The elevated surface is a role only the dark theme has, so the light card
// takes the background.
const makeStyles = (palette: Palette, isDark: boolean) =>
  StyleSheet.create({
    statCard: {
      backgroundColor: isDark ? darkColors.fillNeutral : palette.surfacePage,
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
