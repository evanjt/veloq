import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { MergeCandidate } from 'veloqrs';

import { useTheme, useMetricSystem } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { Row, SheetHeader } from '@/shared/ui';
import { formatDistance } from '@/shared/format/format';
import { SportIcons } from '@/shared/activity/SportIcons';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import type { MergeCandidatesSheetInput } from '@/features/routes';
import { tapBack } from '@/shared/app/navigation';

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
    <View style={[styles.row, { borderBottomColor: border }]}>
      <Row
        testID={`merge-candidate-${item.sectionId}`}
        behaviour="navigate"
        accessibilityLabel={item.name ?? item.sectionId}
        onPress={() => resolve(item)}
      >
        <SportIcons sportTypes={item.sportTypes} size={iconSize.lg} color={textSecondary} />
        <View style={styles.rowContent}>
          <Text style={[styles.rowName, { color: textPrimary }]} numberOfLines={1}>
            {item.name ?? item.sectionId}
          </Text>
          <Text style={[styles.rowMeta, { color: textSecondary }]}>
            {t('sections.traversalsCount', { count: item.visitCount })}
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
      </Row>
    </View>
  );

  return (
    <View style={[styles.sheet, { backgroundColor: surface }]}>
      <SheetHeader
        title={t('sections.mergeCandidatesTitle')}
        onCancel={() => tapBack()}
        cancelTestID="merge-candidates-cancel"
      />
      <View style={styles.body}>
        <Text style={[styles.subtitle, { color: textSecondary }]}>
          {t('sections.mergeCandidatesSubtitle', { count: candidates.length })}
        </Text>
        <FlatList
          data={candidates}
          keyExtractor={(item) => item.sectionId}
          renderItem={renderItem}
          style={styles.list}
        />
      </View>
    </View>
  );
}

export default withScreenBoundary(MergeCandidatesSheetContent, 'Merge Candidates');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: layout.screenPadding,
  },
  subtitle: {
    ...typography.bodySmall,
    marginBottom: spacing.md,
  },
  list: {
    flex: 1,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
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
});
