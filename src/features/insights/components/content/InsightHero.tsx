import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { Card } from '@/shared/ui';
import { spacing, themePalette, typography } from '@/theme';
import type { DataPoint } from '@/types';

/**
 * The figure an insight sheet leads with, drawn the same on every kind: the
 * value in the headline number role with its unit beside it, and what it is
 * under it. The kinds draw no figure of their own at this rank.
 */
export function InsightHero({ hero }: { hero: DataPoint }) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);

  return (
    <Card variant="flat" testID="insight-hero" style={styles.stack}>
      <Text testID="insight-hero-value" style={[styles.value, { color: palette.textPrimary }]}>
        {String(hero.value)}
        {hero.unit ? (
          <Text style={[styles.unit, { color: palette.textSecondary }]}> {hero.unit}</Text>
        ) : null}
      </Text>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{hero.label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: 'center', gap: spacing.xxs },
  value: { ...typography.headlineNumber },
  unit: { ...typography.body },
  label: { ...typography.caption },
});
