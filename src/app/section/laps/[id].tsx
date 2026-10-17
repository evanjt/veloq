import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  DetailFallback,
  SectionLapList,
  SectionStreamsNotice,
  RANGE_DAYS,
  type SectionTimeRange,
  useSectionDetailData,
  useSectionDetailPerformance,
  useSectionTimeStreamSync,
  toPerformanceRecord,
  useSectionLaps,
  scopeLabels,
  withoutRecordMarks,
} from '@/features/routes';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { ErrorState, ScreenScrollView } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function SectionLapsScreenContent() {
  const { id, range, sport } = useLocalSearchParams<{
    id: string;
    range?: string;
    sport?: string;
  }>();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: detail, status } = useSectionDetailData(id, refreshKey);
  const timeRange: SectionTimeRange =
    range && range in RANGE_DAYS ? (range as SectionTimeRange) : 'all';
  const activityIds = useMemo(
    () => [
      ...new Set(detail?.section?.activityPortions.map((portion) => portion.activityId) ?? []),
    ],
    [detail]
  );
  const {
    ready,
    error: streamsError,
    outstanding,
    refetch: refetchStreams,
  } = useSectionTimeStreamSync(activityIds, detail?.missingTimeStreamIds);
  const { data: performance, error: performanceError } = useSectionDetailPerformance(
    id,
    RANGE_DAYS[timeRange],
    sport || undefined,
    ready,
    refreshKey
  );
  const records = useMemo(() => {
    const read = performance?.lapRecords.map(toPerformanceRecord) ?? [];
    return outstanding > 0 ? withoutRecordMarks(read) : read;
  }, [performance, outstanding]);
  const scope = scopeLabels(
    {
      sport: performance?.sportType ?? (sport || undefined),
      sportsOffered: performance?.sportCounts.length ?? 0,
      range: timeRange,
    },
    t
  );
  const laps = useSectionLaps(id);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const excludeLap = useCallback(
    (activityId: string, startIndex: number) => {
      laps.excludeLap(activityId, startIndex);
      refresh();
    },
    [laps, refresh]
  );
  const includeLap = useCallback(
    (activityId: string, startIndex: number) => {
      laps.includeLap(activityId, startIndex);
      refresh();
    },
    [laps, refresh]
  );

  if (!detail?.section) {
    return (
      <DetailFallback
        isDark={isDark}
        status={status}
        onRetry={refresh}
        notFoundMessage={t('sections.sectionNotFound')}
      />
    );
  }

  return (
    <View style={[styles.screen, isDark && styles.screenDark]}>
      <ScreenScrollView contentContainerStyle={styles.content}>
        {scope.length > 0 ? (
          <Text
            testID="section-laps-scope"
            accessibilityLabel={scope.join(', ')}
            style={[styles.scope, isDark && styles.scopeDark]}
          >
            {scope.join(' · ')}
          </Text>
        ) : null}
        {streamsError ? (
          <ErrorState
            variant="inline"
            error={streamsError}
            onRetry={refetchStreams}
            testID="section-laps-stream-failure"
          />
        ) : null}
        {!streamsError && ready && outstanding > 0 ? (
          <SectionStreamsNotice
            isDark={isDark}
            outstanding={outstanding}
            onRetry={refetchStreams}
          />
        ) : null}
        {performanceError !== undefined && (
          <ErrorState
            variant="inline"
            error={performanceError}
            onRetry={refresh}
            testID="section-laps-performance-failure"
          />
        )}
        <SectionLapList
          isDark={isDark}
          initiallyExpanded
          showTitle={false}
          records={records}
          onExcludeLap={excludeLap}
          onIncludeLap={includeLap}
        />
      </ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  screenDark: { backgroundColor: darkColors.surfacePage },
  content: { padding: layout.screenPadding, paddingBottom: spacing.xl },
  scope: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.sm },
  scopeDark: { color: darkColors.textSecondary },
});

export default withScreenBoundary(SectionLapsScreenContent, 'Section Laps');
