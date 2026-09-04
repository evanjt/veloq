/**
 * Compact summary of a preview run: how many sections stayed, changed,
 * appeared, and disappeared. Colours match the map layers so the strip reads
 * as its legend.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, brand, spacing, layout, typography } from '@/theme';
import type { PreviewResult } from '../../../../../modules/veloqrs/src/delegates/preview';

interface PreviewDiffStripProps {
  counts: PreviewResult['counts'];
}

export function PreviewDiffStrip({ counts }: PreviewDiffStripProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const neutral = isDark ? darkColors.textSecondary : colors.textSecondary;
  const success = isDark ? darkColors.success : colors.success;
  const danger = isDark ? darkColors.error : colors.error;

  const cells: { key: string; text: string; color: string }[] = [
    {
      key: 'unchanged',
      text: t('settings.previewUnchanged', { count: counts.unchanged }),
      color: neutral,
    },
    {
      key: 'changed',
      text: t('settings.previewChanged', { count: counts.changed }),
      color: brand.tealLight,
    },
    { key: 'new', text: t('settings.previewNew', { count: counts.new }), color: success },
    { key: 'gone', text: t('settings.previewGone', { count: counts.gone }), color: danger },
  ];

  return (
    <View
      style={[styles.strip, { backgroundColor: surface, borderColor: border }]}
      testID="preview-diff-strip"
    >
      {cells.map((cell) => (
        <View key={cell.key} style={styles.cell}>
          <View style={[styles.dot, { backgroundColor: cell.color }]} />
          <Text style={[styles.cellText, { color: cell.color }]}>{cell.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cellText: {
    ...typography.caption,
    fontWeight: '600',
  },
});
