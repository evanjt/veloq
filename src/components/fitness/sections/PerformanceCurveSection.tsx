import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from '@/components/ui';
import { PowerCurveChart, PaceCurveChart, SwimPaceCurveChart } from '@/components/stats';
import { SeasonBestsSection } from '@/components/fitness';
import { useTheme } from '@/hooks';
import { SPORT_COLORS, type PrimarySport } from '@/providers';
import { formatPaceCompact, formatSwimPace } from '@/lib';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { BestEffort } from '@/hooks/charts/useSeasonBests';

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
          estimatedHeight={240}
          headerRight={
            sportMode === 'Cycling' && currentFTP ? (
              <Text style={[styles.headerValue, { color: SPORT_COLORS.Cycling }]}>
                {currentFTP}w
              </Text>
            ) : sportMode === 'Running' && thresholdPace ? (
              <Text style={[styles.headerValue, { color: SPORT_COLORS.Running }]}>
                {formatPaceCompact(thresholdPace)}/km
              </Text>
            ) : sportMode === 'Swimming' && swimThresholdPace ? (
              <Text style={[styles.headerValue, { color: SPORT_COLORS.Swimming }]}>
                {formatSwimPace(swimThresholdPace)}/100m
              </Text>
            ) : null
          }
        >
          <View style={styles.collapsibleContent}>
            {sportMode === 'Cycling' && (
              <PowerCurveChart height={200} days={days} ftp={currentFTP} />
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
