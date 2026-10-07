/**
 * Confirmation dialog for merging two sections.
 * Shows both sections side-by-side and lets user pick the primary.
 */

import React, { memo, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MergeDropped } from 'veloqrs';
import { useTheme, useMetricSystem } from '@/shared/app';
import { formatDistance, formatShortDate } from '@/shared/format/format';
import { SportIcons } from '@/shared/activity/SportIcons';
import {
  colors,
  darkColors,
  spacing,
  typography,
  layout,
  shadows,
  ink,
  colorWithOpacity,
} from '@/theme';

interface SectionInfo {
  id: string;
  name: string;
  /** Every sport that has taken the section. */
  sportTypes: readonly string[];
  visitCount: number;
  distanceMeters: number;
}

const MAX_NAMED_RIDES = 5;

interface MergeConfirmDialogProps {
  visible: boolean;
  primary: SectionInfo;
  secondary: SectionInfo;
  onConfirm: (primaryId: string, secondaryId: string) => void;
  onCancel: () => void;
  /** The donor rides the merge would leave out, for the chosen kept section. */
  previewDropped: (primaryId: string, secondaryId: string) => MergeDropped[];
  loading?: boolean;
}

export const MergeConfirmDialog = memo(function MergeConfirmDialog({
  visible,
  primary,
  secondary,
  onConfirm,
  onCancel,
  previewDropped,
  loading,
}: MergeConfirmDialogProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const bg = isDark ? darkColors.surface : colors.surface;
  const text = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  // Default primary is the one with more visits
  const [selectedPrimary, setSelectedPrimary] = useState(
    primary.visitCount >= secondary.visitCount ? primary.id : secondary.id
  );

  const actualPrimary = selectedPrimary === primary.id ? primary : secondary;
  const actualSecondary = selectedPrimary === primary.id ? secondary : primary;
  const dropped = useMemo(
    () => (visible ? previewDropped(actualPrimary.id, actualSecondary.id) : []),
    [visible, previewDropped, actualPrimary.id, actualSecondary.id]
  );

  const renderOption = (section: SectionInfo, isSelected: boolean) => (
    <TouchableOpacity
      style={[styles.option, isSelected && styles.optionSelected]}
      onPress={() => setSelectedPrimary(section.id)}
      activeOpacity={0.7}
    >
      <View style={styles.radio}>{isSelected && <View style={styles.radioInner} />}</View>
      <View style={styles.optionContent}>
        <Text style={[styles.optionName, { color: text }]} numberOfLines={1}>
          {section.name}
        </Text>
        <View style={styles.optionStats}>
          <SportIcons sportTypes={section.sportTypes} size={14} color={textSecondary} />
          <Text style={[styles.optionStat, { color: textSecondary }]}>
            {t('sections.visitsCount', { count: section.visitCount })}
          </Text>
          <Text style={[styles.optionStat, { color: textSecondary }]}>
            {formatDistance(section.distanceMeters, isMetric)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: bg }]}>
          <Text style={[styles.title, { color: text }]}>{t('sections.mergeSections')}</Text>
          <Text style={[styles.subtitle, { color: textSecondary }]}>
            {t('sections.mergeKeepMessage')}
          </Text>

          <View style={styles.options}>
            {renderOption(primary, selectedPrimary === primary.id)}
            {renderOption(secondary, selectedPrimary === secondary.id)}
          </View>

          <Text style={[styles.info, { color: textSecondary }]}>
            {t('sections.mergeInto', {
              secondary: actualSecondary.name,
              primary: actualPrimary.name,
            })}
          </Text>

          {dropped.length > 0 && (
            <View style={styles.dropped} testID="merge-dropped-rides">
              <Text style={[styles.droppedTitle, { color: text }]}>
                {t('sections.mergeDroppedRides', { count: dropped.length })}
              </Text>
              {dropped.slice(0, MAX_NAMED_RIDES).map((ride) => (
                <Text
                  key={ride.activityId}
                  style={[styles.optionStat, { color: textSecondary }]}
                  numberOfLines={1}
                >
                  {ride.name
                    ? `${ride.name}, ${formatShortDate(new Date(ride.startDate * 1000))}`
                    : formatShortDate(new Date(ride.startDate * 1000))}
                </Text>
              ))}
              {dropped.length > MAX_NAMED_RIDES && (
                <Text style={[styles.optionStat, { color: textSecondary }]}>
                  {t('sections.mergeDroppedMore', { count: dropped.length - MAX_NAMED_RIDES })}
                </Text>
              )}
            </View>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={[styles.cancelText, { color: textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mergeBtn, loading && styles.mergeBtnDisabled]}
              onPress={() => onConfirm(actualPrimary.id, actualSecondary.id)}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.mergeText}>{t('sections.merge')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colorWithOpacity(ink.black, 0.5),
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    borderRadius: layout.borderRadius,
    padding: spacing.lg,
    ...shadows.modal,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.bodySmall.fontSize,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  options: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: spacing.sm,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}10`,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: layout.borderRadiusFull,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.primary,
  },
  optionContent: {
    flex: 1,
  },
  optionName: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
    marginBottom: spacing.xxs,
  },
  optionStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  optionStat: {
    fontSize: typography.bodySmall.fontSize,
  },
  info: {
    fontSize: typography.bodySmall.fontSize,
    fontStyle: 'italic',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  dropped: {
    gap: spacing.xxs,
    marginBottom: spacing.md,
  },
  droppedTitle: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
  },
  mergeBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: layout.borderRadiusSm,
    minWidth: 80,
    alignItems: 'center',
  },
  mergeBtnDisabled: {
    opacity: 0.6,
  },
  mergeText: {
    color: colors.textOnPrimary,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
});
