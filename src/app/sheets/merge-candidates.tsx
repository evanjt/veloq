import React, { useMemo } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { decodeCoords, type MergeCandidate } from 'veloqrs';

import { useTheme, useMetricSystem } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { Row, SheetHeader } from '@/shared/ui';
import { TrackPreview, normaliseTrackPoints } from '@/shared/ui/TrackPreview';
import { formatDistance } from '@/shared/format/format';
import { SportIcons } from '@/shared/activity/SportIcons';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
  stroke,
  themePalette,
} from '@/theme';
import {
  ROW_PREVIEW_HEIGHT,
  ROW_PREVIEW_WIDTH,
  type MergeCandidatesSheetInput,
} from '@/features/routes';
import { goBack } from '@/shared/app/navigation';
import { NameText } from '@/shared/ui/NameText';

/**
 * The merge candidates list, a sheet route opened with `openSheet` when a section has several
 * candidates and answered with the chosen `MergeCandidate`.
 */

/**
 * Where the candidate runs, drawn from the line the engine thinned for a row, so two numbered
 * sections can be told apart before one is merged into the other. The box keeps its size when the
 * line cannot be read, so the rows stay aligned.
 */
function CandidatePreview({ candidate, isDark }: { candidate: MergeCandidate; isDark: boolean }) {
  const points = useMemo(
    () =>
      normaliseTrackPoints(
        decodeCoords(candidate.encodedPolyline).map((p) => ({ lat: p.latitude, lng: p.longitude }))
      ),
    [candidate.encodedPolyline]
  );
  return (
    <View style={styles.preview}>
      {points.length > 1 ? (
        <TrackPreview
          testID={`merge-candidate-preview-${candidate.sectionId}`}
          points={points}
          color={themePalette(isDark).actionPrimary}
          isDark={isDark}
        />
      ) : null}
    </View>
  );
}

function MergeCandidatesSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { input, resolve } = useSheetRequest<MergeCandidatesSheetInput, MergeCandidate>();
  const candidates = input?.candidates ?? [];

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
        <CandidatePreview candidate={item} isDark={isDark} />
        <SportIcons sportTypes={item.sportTypes} size={iconSize.lg} color={textSecondary} />
        <View style={styles.rowContent}>
          <NameText style={[styles.rowName, { color: textPrimary }]}>
            {item.name ?? item.sectionId}
          </NameText>
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
    <View style={styles.sheet}>
      <SheetHeader
        title={t('sections.mergeCandidatesTitle')}
        onCancel={() => goBack()}
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
    borderBottomWidth: stroke.hairline,
  },
  preview: {
    width: ROW_PREVIEW_WIDTH,
    height: ROW_PREVIEW_HEIGHT,
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
