import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
  withoutRecordMarks,
} from '@/features/routes';
import { colors, darkColors, layout, spacing } from '@/theme';
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
          records={records}
          onExcludeLap={excludeLap}
          onIncludeLap={includeLap}
        />
      </ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenDark: { backgroundColor: darkColors.background },
  content: { padding: layout.screenPadding, paddingBottom: spacing.xl },
});

export default withScreenBoundary(SectionLapsScreenContent, 'Section Laps');
