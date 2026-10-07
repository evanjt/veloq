import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  spacing,
  opacity,
  layout,
  typography,
  verdictColor,
  type VerdictRung,
} from '@/theme';
import type { DataPoint } from '@/types';

/** The ladder rung each verdict a generator gives a value is drawn on. */
const CONTEXT_RUNG: Record<NonNullable<DataPoint['context']>, VerdictRung> = {
  good: 'positive',
  warning: 'caution',
  concern: 'negative',
  neutral: 'neutral',
};

interface DataPointRowProps {
  dataPoint: DataPoint;
}

export const DataPointRow = React.memo(function DataPointRow({ dataPoint }: DataPointRowProps) {
  const { isDark } = useTheme();
  const contextColor = dataPoint.context
    ? verdictColor(CONTEXT_RUNG[dataPoint.context], isDark)
    : undefined;

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
    borderRadius: layout.borderRadiusFull,
    marginRight: spacing.sm,
  },
  label: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
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
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  valueDark: {
    color: darkColors.textPrimary,
  },
  unit: {
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  unitDark: {
    color: darkColors.textSecondary,
  },
});
