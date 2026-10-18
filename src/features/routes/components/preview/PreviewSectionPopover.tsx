/**
 * Bottom card for a tapped preview section. An inspection surface: it shows
 * what the run produced, raw and threshold-free, and null metrics simply do
 * not render.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import { formatDistance, formatElevation } from '@/shared/format/format';
import { colors, darkColors, iconSize, layout, spacing, typography, stroke } from '@/theme';
import type { PreviewSection, PreviewSectionStatus } from 'veloqrs';
import { Badge, IconButton, type BadgeTone } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { formatPercent } from '@/shared/format';
import { NameText } from '@/shared/ui/NameText';

const STATUS_KEYS: Record<PreviewSectionStatus, string> = {
  unchanged: 'settings.previewStatusUnchanged',
  changed: 'settings.previewStatusChanged',
  new: 'settings.previewStatusNew',
  gone: 'settings.previewStatusGone',
};

/** The badge tone each preview status draws in: a new section gained, one gone lost. */
const STATUS_TONES: Record<PreviewSectionStatus, BadgeTone> = {
  unchanged: 'neutral',
  changed: 'warning',
  new: 'positive',
  gone: 'negative',
};

interface PreviewSectionPopoverProps {
  section: PreviewSection;
  newNumber: number | null;
  onClose: () => void;
}

export function PreviewSectionPopover({ section, newNumber, onClose }: PreviewSectionPopoverProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      testID="preview-section-popover"
    >
      <View style={styles.headerRow}>
        <NameText style={[styles.name, { color: textPrimary }]}>
          {section.name ?? t('settings.previewNewSectionName', { number: newNumber ?? 1 })}
        </NameText>
        <IconButton
          onPress={onClose}
          accessibilityLabel={t('common.close')}
          testID="preview-popover-close"
        >
          <Icon name="close" size={iconSize.md} color={textSecondary} />
        </IconButton>
      </View>

      <View style={styles.badgeRow}>
        <Badge
          tone={STATUS_TONES[section.status]}
          text={t(STATUS_KEYS[section.status] as never)}
          isDark={isDark}
        />
        {section.pinned ? (
          <Badge tone="neutral" icon="pin" text={t('sections.accepted')} isDark={isDark} />
        ) : null}
      </View>

      <View style={styles.metricsRow}>
        <Text style={[styles.metric, { color: textSecondary }]}>
          {t('sections.traversalsCount', { count: section.visits })}
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
            {t('sections.avgGrade')} {formatPercent(section.avgGradePercent, 1)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    borderWidth: stroke.hairline,
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
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metric: {
    ...typography.bodyCompact,
  },
});
