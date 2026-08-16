/**
 * Bottom card for a tapped preview section. An inspection surface: it shows
 * what the run produced, raw and threshold-free, and null metrics simply do
 * not render.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import { formatDistance, formatElevation } from '@/shared/format/format';
import { colors, darkColors, brand, spacing, layout, typography } from '@/theme';
import type {
  PreviewSection,
  PreviewSectionStatus,
} from '../../../../../modules/veloqrs/src/delegates/preview';

const STATUS_KEYS: Record<PreviewSectionStatus, string> = {
  unchanged: 'settings.previewStatusUnchanged',
  changed: 'settings.previewStatusChanged',
  new: 'settings.previewStatusNew',
  gone: 'settings.previewStatusGone',
};

interface PreviewSectionPopoverProps {
  section: PreviewSection;
  onClose: () => void;
}

export function PreviewSectionPopover({ section, onClose }: PreviewSectionPopoverProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const success = isDark ? darkColors.success : colors.success;
  const danger = isDark ? darkColors.error : colors.error;

  const statusColor: Record<PreviewSectionStatus, string> = {
    unchanged: textSecondary,
    changed: brand.tealLight,
    new: success,
    gone: danger,
  };

  return (
    <View
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      testID="preview-section-popover"
    >
      <View style={styles.headerRow}>
        <Text style={[styles.name, { color: textPrimary }]} numberOfLines={1}>
          {section.name ?? t('sections.defaultName')}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          testID="preview-popover-close"
        >
          <MaterialCommunityIcons name="close" size={20} color={textSecondary} />
        </Pressable>
      </View>

      <View style={styles.badgeRow}>
        <View style={[styles.badge, { borderColor: statusColor[section.status] }]}>
          <Text style={[styles.badgeText, { color: statusColor[section.status] }]}>
            {t(STATUS_KEYS[section.status] as never)}
          </Text>
        </View>
        {section.pinned && (
          <View style={[styles.badge, { borderColor: textSecondary }]}>
            <MaterialCommunityIcons name="pin" size={11} color={textSecondary} />
            <Text style={[styles.badgeText, { color: textSecondary }]}>{t('sections.pinned')}</Text>
          </View>
        )}
      </View>

      <View style={styles.metricsRow}>
        <Text style={[styles.metric, { color: textSecondary }]}>
          {t('sections.visitsCount', { count: section.visits })}
        </Text>
        <Text style={[styles.metric, { color: textSecondary }]}>
          {formatDistance(section.distanceM, isMetric)}
        </Text>
        {section.elevationGainM !== null && (
          <Text style={[styles.metric, { color: textSecondary }]}>
            {t('sections.elevationGain')} {formatElevation(section.elevationGainM, isMetric)}
          </Text>
        )}
        {section.avgGradePercent !== null && (
          <Text style={[styles.metric, { color: textSecondary }]}>
            {t('sections.avgGrade')} {section.avgGradePercent.toFixed(1)}%
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: {
    ...typography.cardTitle,
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
  },
  badgeText: {
    ...typography.label,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metric: {
    ...typography.bodyCompact,
  },
});
