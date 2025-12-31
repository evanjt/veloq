/**
 * Consistent tooltip component for chart data display.
 *
 * Provides automatic positioning and consistent styling across charts.
 */

import React, { ReactNode } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

export interface TooltipValue {
  label: string;
  value: string | number;
  color?: string;
  unit?: string;
}

export interface ChartTooltipProps {
  /** Values to display */
  values: TooltipValue[];
  /** Layout direction */
  direction?: 'row' | 'column';
  /** Custom content instead of values */
  children?: ReactNode;
}

export const ChartTooltip = React.memo(function ChartTooltip({
  values,
  direction = 'row',
  children,
}: ChartTooltipProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (children) {
    return <View style={styles.container}>{children}</View>;
  }

  return (
    <View style={[styles.container, direction === 'row' && styles.rowLayout]}>
      {values.map((item, index) => (
        <View
          key={index}
          style={[styles.valueItem, direction === 'row' && styles.valueItemRow]}
        >
          <Text style={[styles.label, isDark && styles.labelDark]}>
            {item.label}
          </Text>
          <Text
            style={[
              styles.value,
              item.color ? { color: item.color } : isDark && styles.valueDark,
            ]}
          >
            {item.value}
            {item.unit && <Text style={styles.unit}>{item.unit}</Text>}
          </Text>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {},
  rowLayout: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  valueItem: {
    marginBottom: spacing.xs,
  },
  valueItemRow: {
    alignItems: 'center',
    marginBottom: 0,
  },
  label: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    marginBottom: 1,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  value: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  valueDark: {
    color: colors.textOnDark,
  },
  unit: {
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
  },
});

export default ChartTooltip;
