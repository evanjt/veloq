/**
 * Horizontal picker of ranked riding areas. Each chip carries the locality
 * label (or the numbered fallback) plus the visit or section count that
 * ranked it.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, brand, spacing, layout, typography } from '@/theme';
import type { CentreLabel } from '@/features/routes/lib/labelPreviewCentres';
import type { PreviewCentre } from '../../../../../modules/veloqrs/src/delegates/preview';

interface PreviewCentrePickerProps {
  centres: PreviewCentre[];
  labels: CentreLabel[];
  selectedBinKey: string | null;
  onSelect: (centre: PreviewCentre) => void;
}

export function PreviewCentrePicker({
  centres,
  labels,
  selectedBinKey,
  onSelect,
}: PreviewCentrePickerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID="preview-centre-picker"
    >
      {centres.map((centre, i) => {
        const active = centre.binKey === selectedBinKey;
        const label =
          labels[i]?.label ??
          t('settings.previewAreaFallback', { number: labels[i]?.fallbackNumber ?? i + 1 });
        const detail =
          centre.source === 'sections'
            ? t('settings.previewAreaSections', { count: centre.sectionCount })
            : t('settings.previewAreaVisits', { count: centre.visitTotal });
        return (
          <Pressable
            key={centre.binKey}
            style={[
              styles.chip,
              { backgroundColor: surface, borderColor: border },
              active && styles.chipActive,
            ]}
            onPress={() => onSelect(centre)}
            testID={`preview-centre-${centre.binKey}`}
          >
            <Text
              style={[styles.chipLabel, { color: active ? colors.textOnDark : textPrimary }]}
              numberOfLines={1}
            >
              {label}
            </Text>
            <Text
              style={[styles.chipDetail, { color: active ? colors.textOnDark : textSecondary }]}
            >
              {detail}
            </Text>
          </Pressable>
        );
      })}
      <View style={styles.tail} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chip: {
    minWidth: 120,
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: brand.tealLight,
    borderColor: brand.tealLight,
  },
  chipLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  chipDetail: {
    ...typography.caption,
    marginTop: 2,
  },
  tail: { width: spacing.xs },
});
