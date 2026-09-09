import React from 'react';
import { usePowerCurve, usePaceCurve } from '@/features/stats';
import { curveHeaderValue } from '@/features/fitness/lib/curveHeaderValue';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { CollapsibleSection } from '@/shared/ui';
import {
  PowerCurveChart,
  PaceCurveChart,
  SwimPaceCurveChart,
  type BestEffort,
} from '@/features/stats';
import { useTheme } from '@/shared/app';
import { SPORT_COLORS, type PrimarySport } from '@/features/fitness/stores';
import { formatPaceCompact, formatSwimPace } from '@/shared/format/format';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { SeasonBestsSection } from '..';

interface PerformanceCurveSectionProps {
  sportMode: PrimarySport;
  days: number;
  currentFTP: number | null | undefined;
  thresholdPace: number | undefined;
  swimThresholdPace: number | undefined;
  performanceExpanded: boolean;
  onPerformanceToggle: (expanded: boolean) => void;
  bestsExpanded: boolean;
  onBestsToggle: (expanded: boolean) => void;
  bestsEfforts: BestEffort[];
  loadingBests: boolean;
  bestsHeader: string | null;
}

export const PerformanceCurveSection = React.memo(function PerformanceCurveSection({
  sportMode,
  days,
  currentFTP,
  thresholdPace,
  swimThresholdPace,
  performanceExpanded,
  onPerformanceToggle,
  bestsExpanded,
  onBestsToggle,
  bestsEfforts,
  loadingBests,
  bestsHeader,
}: PerformanceCurveSectionProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  // The chart under each row decides whether there is a series, so the header
  // asks the same query it does. Both read one cache entry.
  const powerCurve = usePowerCurve({ days, enabled: sportMode === 'Cycling' });
  const runCurve = usePaceCurve({ sport: 'Run', days, enabled: sportMode === 'Running' });
  const swimCurve = usePaceCurve({ sport: 'Swim', days, enabled: sportMode === 'Swimming' });

  const headerFtp = curveHeaderValue({
    value: currentFTP,
    hasSeries: powerCurve.data.secs.length > 0,
    isLoading: powerCurve.isLoading,
    isError: powerCurve.isError,
  });
  const headerRunPace = curveHeaderValue({
    value: thresholdPace,
    hasSeries: runCurve.data.distances.length > 0,
    isLoading: runCurve.isLoading,
    isError: runCurve.isError,
  });
  const headerSwimPace = curveHeaderValue({
    value: swimThresholdPace,
    hasSeries: swimCurve.data.distances.length > 0,
    isLoading: swimCurve.isLoading,
    isError: swimCurve.isError,
  });

  return (
    <>
      {/* Performance Section - Power/Pace Curve */}
      <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
        <CollapsibleSection
          testID="fitness-section-performance"
          title={
            sportMode === 'Cycling'
              ? t('statsScreen.powerCurve')
              : sportMode === 'Swimming'
                ? t('statsScreen.swimPaceCurve')
                : t('statsScreen.paceCurve')
          }
          icon={sportMode === 'Cycling' ? 'lightning-bolt' : 'speedometer'}
          expanded={performanceExpanded}
          onToggle={onPerformanceToggle}
          estimatedHeight={sportMode === 'Cycling' ? 270 : 240}
          headerRight={
            sportMode === 'Cycling' && headerFtp ? (
              <Text style={[styles.headerValue, { color: SPORT_COLORS.Cycling }]}>
                {headerFtp}w
              </Text>
            ) : sportMode === 'Running' && headerRunPace ? (
              <Text style={[styles.headerValue, { color: SPORT_COLORS.Running }]}>
                {formatPaceCompact(headerRunPace)}/km
              </Text>
            ) : sportMode === 'Swimming' && headerSwimPace ? (
              <Text style={[styles.headerValue, { color: SPORT_COLORS.Swimming }]}>
                {formatSwimPace(headerSwimPace)}/100m
              </Text>
            ) : null
          }
        >
          <View style={styles.collapsibleContent}>
            {sportMode === 'Cycling' && (
              // Taller than the pace charts by the row of fitted models under it.
              <PowerCurveChart height={230} days={days} ftp={currentFTP} />
            )}
            {sportMode === 'Running' && <PaceCurveChart height={200} days={days} />}
            {sportMode === 'Swimming' && <SwimPaceCurveChart height={200} days={days} />}
          </View>
        </CollapsibleSection>
      </View>

      {/* Season Bests Section */}
      <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
        <CollapsibleSection
          testID="fitness-section-bests"
          title={t('statsScreen.seasonBests')}
          icon="trophy-outline"
          expanded={bestsExpanded}
          onToggle={onBestsToggle}
          estimatedHeight={200}
          headerRight={
            bestsHeader ? (
              <Text style={[styles.headerValue, { color: SPORT_COLORS[sportMode] }]}>
                {bestsHeader}
              </Text>
            ) : null
          }
        >
          <View style={styles.collapsibleContent}>
            <SeasonBestsSection
              efforts={bestsEfforts}
              sport={sportMode}
              days={days}
              isLoading={loadingBests}
            />
          </View>
        </CollapsibleSection>
      </View>
    </>
  );
});

const styles = StyleSheet.create({
  collapsibleCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  collapsibleCardDark: {
    backgroundColor: darkColors.surface,
  },
  collapsibleContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  headerValue: {
    ...typography.bodyBold,
    marginRight: spacing.sm,
  },
});
