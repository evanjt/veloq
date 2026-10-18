import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { ErrorState } from '@/shared/ui';
import { colors, darkColors, spacing, typography } from '@/theme';
import { DetailFallback } from '../components';
import { SectionLapList, SectionStreamsNotice } from '../components/section';
import { RANGE_DAYS, type SectionTimeRange } from '../constants';
import { useSectionDetailData, useSectionDetailPerformance } from '../hooks/useSectionDetailData';
import { useSectionLaps } from '../hooks/useSectionLaps';
import {
  toPerformanceRecord,
  useSectionTimeStreamSync,
  withoutRecordMarks,
} from '../hooks/useSectionPerformances';
import { scopeLabels } from '../lib/heroStats';
import { SheetCardScroll, type CardScrollProps } from './SheetCardScroll';

export interface SectionLapsCardProps {
  /** The section's id. */
  id: string;
  /** The range the section's card was on, a key of `RANGE_DAYS`, every lap when absent. */
  range?: string | undefined;
  /** The sport the section's card was on, the engine's choice when empty. */
  sport?: string | undefined;
  /** The scroll the body sits in: the sheet's, unless the route passes its screen's. */
  Scroll?: React.ComponentType<CardScrollProps>;
}

/** A section's laps: every activity that rode it more than once, lap by lap. */
export function SectionLapsCard({
  id,
  range,
  sport,
  Scroll = SheetCardScroll,
}: SectionLapsCardProps) {
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
    <Scroll>
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
        <SectionStreamsNotice isDark={isDark} outstanding={outstanding} onRetry={refetchStreams} />
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
    </Scroll>
  );
}

const styles = StyleSheet.create({
  scope: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.sm },
  scopeDark: { color: darkColors.textSecondary },
});
