import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { DataPoint } from '@/types';

const CONTEXT_COLORS: Record<string, string> = {
  good: '#22C55E',
  warning: '#F59E0B',
  concern: '#EF4444',
  neutral: '#A1A1AA',
};

interface DataPointRowProps {
  dataPoint: DataPoint;
}

export const DataPointRow = React.memo(function DataPointRow({ dataPoint }: DataPointRowProps) {
  const { isDark } = useTheme();
  const contextColor = dataPoint.context ? CONTEXT_COLORS[dataPoint.context] : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {contextColor ? (
          <View style={[styles.contextDot, { backgroundColor: contextColor }]} />
        ) : null}
        <Text style={[styles.label, isDark && styles.labelDark]}>{dataPoint.label}</Text>
        <View style={styles.valueContainer}>
          <Text style={[styles.value, isDark && styles.valueDark]}>
            {String(dataPoint.value)}
            {dataPoint.unit ? (
              <Text style={[styles.unit, isDark && styles.unitDark]}> {dataPoint.unit}</Text>
            ) : null}
          </Text>
        </View>
      </View>
      {dataPoint.range ? (
        <View style={styles.rangeContainer}>
          <View style={[styles.rangeBar, isDark && styles.rangeBarDark]}>
            <View
              style={[
                styles.rangeFill,
                {
                  backgroundColor: contextColor ?? colors.primary,
                  left: `${Math.max(0, Math.min(100, ((Number(dataPoint.value) - dataPoint.range.min) / (dataPoint.range.max - dataPoint.range.min)) * 100))}%`,
                },
              ]}
            />
          </View>
          {dataPoint.range.label ? (
            <Text style={[styles.rangeLabel, isDark && styles.rangeLabelDark]}>
              {dataPoint.range.label}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: opacity.overlay.light,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contextDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  label: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  valueDark: {
    color: darkColors.textPrimary,
  },
  unit: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  unitDark: {
    color: darkColors.textSecondary,
  },
  rangeContainer: {
    marginTop: spacing.xs,
    paddingLeft: spacing.md,
  },
  rangeBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: opacity.overlay.light,
    position: 'relative',
  },
  rangeBarDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  rangeFill: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    top: -2,
  },
  rangeLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rangeLabelDark: {
    color: darkColors.textSecondary,
  },
});
