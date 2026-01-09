import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, typography } from '@/theme';

// Direction colors - using theme for consistency
const SAME_COLOR = colors.sameDirection;
const REVERSE_COLOR = colors.reverseDirection;

interface ChartLegendProps {
  currentActivityColor: string;
  hasReverseRuns: boolean;
  isDark: boolean;
}

export function ChartLegend({ currentActivityColor, hasReverseRuns, isDark }: ChartLegendProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: '#FFB300' }]} />
        <Text style={[styles.legendText, isDark && styles.textMuted]}>{t('routes.best')}</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: currentActivityColor }]} />
        <Text style={[styles.legendText, isDark && styles.textMuted]}>
          {t('routes.thisActivity')}
        </Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: SAME_COLOR }]} />
        <Text style={[styles.legendText, isDark && styles.textMuted]}>{t('routes.same')}</Text>
      </View>
      {hasReverseRuns && (
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: REVERSE_COLOR }]} />
          <Text style={[styles.legendText, isDark && styles.textMuted]}>{t('routes.reverse')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  legendText: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});
