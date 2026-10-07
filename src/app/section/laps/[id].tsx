import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/app';
import {
  DetailFallback,
  SectionLapList,
  RANGE_DAYS,
  type SectionTimeRange,
  useSectionDetailData,
  useSectionDetailPerformance,
  useSectionTimeStreamSync,
  toPerformanceRecord,
  useSectionLaps,
} from '@/features/routes';
import { colors, darkColors, layout, spacing } from '@/theme';
import { Button, EngineReadFailure } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function SectionLapsScreenContent() {
  const { id, range, sport } = useLocalSearchParams<{
    id: string;
    range?: string;
    sport?: string;
  }>();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
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
    refetch: refetchStreams,
  } = useSectionTimeStreamSync(activityIds, detail?.missingTimeStreamIds);
  const { data: performance, error: performanceError } = useSectionDetailPerformance(
    id,
    RANGE_DAYS[timeRange],
    sport || undefined,
    ready,
    refreshKey
  );
  const records = useMemo(
    () => performance?.lapRecords.map(toPerformanceRecord) ?? [],
    [performance]
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
        insetTop={insets.top}
        status={status}
        loading={status.kind === 'closed'}
        onRetry={refresh}
        notFoundMessage={t('sections.sectionNotFound')}
      />
    );
  }

  return (
    <View style={[styles.screen, isDark && styles.screenDark]}>
      <ScrollView contentContainerStyle={styles.content}>
        {streamsError && (
          <View>
            <EngineReadFailure error={streamsError} testID="section-laps-stream-failure" />
            <Button label={t('common.retry')} variant="secondary" onPress={refetchStreams} />
          </View>
        )}
        {performanceError !== undefined && (
          <EngineReadFailure error={performanceError} testID="section-laps-performance-failure" />
        )}
        <SectionLapList
          isDark={isDark}
          initiallyExpanded
          records={records}
          onExcludeLap={excludeLap}
          onIncludeLap={includeLap}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenDark: { backgroundColor: darkColors.background },
  content: { padding: layout.screenPadding, paddingBottom: spacing.xl },
});

export default withScreenBoundary(SectionLapsScreenContent, 'Section Laps');
