import React, { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme, useMetricSystem } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { pressable, pressRipple, SheetActions, SheetHeader, SheetScrollView } from '@/shared/ui';
import { formatDistance, formatShortDate } from '@/shared/format/format';
import { SportIcons } from '@/shared/activity/SportIcons';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity } from '@/theme';
import {
  useMergeSections,
  type MergeConfirmSheetInput,
  type MergeConfirmSheetResult,
  type MergeSectionInfo,
} from '@/features/routes';
import { tapBack } from '@/shared/app/navigation';

/**
 * The merge confirmation, a sheet route opened with `openSheet` and answered with the section to
 * keep and the one merged into it. The default kept section is the one with more visits, and the
 * rides the merge would leave out are listed for whichever is chosen.
 */

const MAX_NAMED_RIDES = 5;

function MergeConfirmSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { input, resolve } = useSheetRequest<MergeConfirmSheetInput, MergeConfirmSheetResult>();
  const { previewDropped } = useMergeSections();
  const [chosenPrimaryId, setChosenPrimaryId] = useState<string | undefined>(undefined);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const border = isDark ? darkColors.border : colors.border;
  const accent = isDark ? darkColors.primary : colors.primary;

  const primary = input?.primary;
  const secondary = input?.secondary;
  const keptId =
    chosenPrimaryId ??
    (primary && secondary && primary.visitCount >= secondary.visitCount
      ? primary.id
      : secondary?.id);
  const kept = keptId === secondary?.id ? secondary : primary;
  const merged = keptId === secondary?.id ? primary : secondary;
  const dropped = useMemo(
    () => (kept && merged ? previewDropped(kept.id, merged.id) : []),
    [previewDropped, kept, merged]
  );

  if (!input || !primary || !secondary || !kept || !merged) return null;

  const renderOption = (section: MergeSectionInfo) => {
    const isSelected = section.id === kept.id;
    return (
      <Pressable
        testID={`merge-keep-${section.id}`}
        style={pressable([
          styles.option,
          { borderColor: isSelected ? accent : border },
          isSelected && { backgroundColor: colorWithOpacity(accent, 0.08) },
        ])}
        android_ripple={pressRipple}
        accessibilityRole="button"
        accessibilityLabel={section.name}
        accessibilityState={{ selected: isSelected }}
        onPress={() => setChosenPrimaryId(section.id)}
      >
        <View style={[styles.radio, { borderColor: isSelected ? accent : textSecondary }]}>
          {isSelected && <View style={[styles.radioInner, { backgroundColor: accent }]} />}
        </View>
        <View style={styles.optionContent}>
          <Text style={[styles.optionName, { color: textPrimary }]} numberOfLines={1}>
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
      </Pressable>
    );
  };

  const actions = {
    onCancel: () => tapBack(),
    cancelTestID: 'merge-confirm-cancel',
    confirm: {
      label: t('sections.merge'),
      onPress: () => resolve({ primaryId: kept.id, secondaryId: merged.id }),
      testID: 'merge-confirm-merge',
    },
  };

  return (
    <SheetScrollView>
      <SheetHeader title={t('sections.mergeSections')} {...actions} />
      <View style={styles.content}>
        <Text style={[styles.subtitle, { color: textSecondary }]}>
          {t('sections.mergeKeepMessage')}
        </Text>

        <View style={styles.options}>
          {renderOption(primary)}
          {renderOption(secondary)}
        </View>

        <Text style={[styles.info, { color: textSecondary }]}>
          {t('sections.mergeInto', { secondary: merged.name, primary: kept.name })}
        </Text>

        {dropped.length > 0 && (
          <View style={styles.dropped} testID="merge-dropped-rides">
            <Text style={[styles.droppedTitle, { color: textPrimary }]}>
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
      </View>
      <SheetActions {...actions} />
    </SheetScrollView>
  );
}

export default withScreenBoundary(MergeConfirmSheetContent, 'Merge Sections');

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: layout.screenPadding,
  },
  subtitle: {
    ...typography.bodySmall,
    marginBottom: spacing.md,
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
    gap: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: layout.borderRadiusFull,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: layout.borderRadiusFull,
  },
  optionContent: {
    flex: 1,
  },
  optionName: {
    ...typography.bodyMedium,
    marginBottom: spacing.xxs,
  },
  optionStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  optionStat: {
    ...typography.bodySmall,
  },
  info: {
    ...typography.bodySmall,
    fontStyle: 'italic',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  dropped: {
    gap: spacing.xxs,
    marginBottom: spacing.md,
  },
  droppedTitle: {
    ...typography.bodyMedium,
  },
});
