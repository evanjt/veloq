import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  spacing,
  opacity,
  typography,
  verdictColor,
  type VerdictRung,
} from '@/theme';
import type { DataPoint } from '@/types';

type Verdict = NonNullable<DataPoint['context']>;

/**
 * How each verdict a generator gives a value is drawn: its ladder rung, a
 * glyph of its own so the verdict reads without its hue, and the word a
 * screen reader says.
 */
const VERDICT_MARK = {
  good: { rung: 'positive', glyph: 'check-circle', word: 'insights.verdict.good' },
  warning: { rung: 'caution', glyph: 'alert', word: 'insights.verdict.warning' },
  concern: { rung: 'negative', glyph: 'alert-octagon', word: 'insights.verdict.concern' },
  neutral: { rung: 'neutral', glyph: 'minus', word: 'insights.verdict.neutral' },
} as const satisfies Record<
  Verdict,
  { rung: VerdictRung; glyph: keyof typeof MaterialCommunityIcons.glyphMap; word: string }
>;

interface DataPointRowProps {
  dataPoint: DataPoint;
}

export const DataPointRow = React.memo(function DataPointRow({ dataPoint }: DataPointRowProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const mark = dataPoint.context ? VERDICT_MARK[dataPoint.context] : null;
  const value = `${String(dataPoint.value)}${dataPoint.unit ? ` ${dataPoint.unit}` : ''}`;
  const label = [dataPoint.label, value, mark ? t(mark.word) : null].filter(Boolean).join(', ');

  return (
    <View style={styles.container} accessible accessibilityLabel={label}>
      <View style={styles.row}>
        {mark ? (
          <MaterialCommunityIcons
            name={mark.glyph}
            size={16}
            color={verdictColor(mark.rung, isDark)}
            style={styles.verdictGlyph}
          />
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
  verdictGlyph: {
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
