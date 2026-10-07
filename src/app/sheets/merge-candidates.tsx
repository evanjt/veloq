import React from 'react';
import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { MergeCandidate } from 'veloqrs';

import { useTheme, useMetricSystem } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { Button, pressable, pressRipple } from '@/shared/ui';
import { formatDistance } from '@/shared/format/format';
import { SportIcons } from '@/shared/activity/SportIcons';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { MergeCandidatesSheetInput } from '@/features/routes';

/**
 * The merge candidates list, a sheet route opened with `openSheet` when a section has several
 * candidates and answered with the chosen `MergeCandidate`.
 */

function MergeCandidatesSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { input, resolve } = useSheetRequest<MergeCandidatesSheetInput, MergeCandidate>();
  const candidates = input?.candidates ?? [];

  const surface = isDark ? darkColors.surface : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const border = isDark ? darkColors.border : colors.border;

  const renderItem = ({ item }: { item: MergeCandidate }) => (
    <Pressable
      testID={`merge-candidate-${item.sectionId}`}
      style={pressable([styles.row, { borderBottomColor: border }])}
      android_ripple={pressRipple}
      accessibilityRole="button"
      accessibilityLabel={item.name ?? item.sectionId}
      onPress={() => resolve(item)}
    >
      <SportIcons sportTypes={item.sportTypes} size={22} color={textSecondary} />
      <View style={styles.rowContent}>
        <Text style={[styles.rowName, { color: textPrimary }]} numberOfLines={1}>
          {item.name ?? item.sectionId}
        </Text>
        <Text style={[styles.rowMeta, { color: textSecondary }]}>
          {t('sections.visitsCount', { count: item.visitCount })}
          {' · '}
          {formatDistance(item.distanceMeters, isMetric)}
          {' · '}
          {Math.round(item.overlapPct * 100)}% {t('sections.overlapLabel')}
          {' · '}
          {t('sections.distanceAway', {
            distance: formatDistance(item.centerDistanceMeters, isMetric),
          })}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={textSecondary} />
    </Pressable>
  );

  return (
    <View style={[styles.sheet, { backgroundColor: surface }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: textPrimary }]}>
        {t('sections.mergeCandidatesTitle')}
      </Text>
      <Text style={[styles.subtitle, { color: textSecondary }]}>
        {t('sections.mergeCandidatesSubtitle', { count: candidates.length })}
      </Text>
      <FlatList
        data={candidates}
        keyExtractor={(item) => item.sectionId}
        renderItem={renderItem}
        style={styles.list}
      />
      <View style={styles.actions}>
        <Button
          testID="merge-candidates-cancel"
          label={t('common.cancel')}
          onPress={() => router.back()}
          variant="ghost"
        />
      </View>
    </View>
  );
}

export default withScreenBoundary(MergeCandidatesSheetContent, 'Merge Candidates');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    padding: layout.screenPadding,
  },
  title: {
    ...typography.cardTitle,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodySmall,
    marginBottom: spacing.md,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: layout.minTapTarget,
  },
  rowContent: {
    flex: 1,
  },
  rowName: {
    ...typography.bodyMedium,
    marginBottom: spacing.xxs,
  },
  rowMeta: {
    ...typography.caption,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
});
