import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SharedValue } from 'react-native-reanimated';

import { useTheme } from '@/shared/app';
import { spacing, opacity, stroke } from '@/theme';
import { Card } from '@/shared/ui/Card';
import { CardHeader } from '@/shared/ui/CardHeader';
import { ErrorState } from '@/shared/ui/ErrorState';
import { HeldRender } from '@/shared/ui/HeldRender';
import type { DayLoad, RangeCoverage } from 'veloqrs';
import type { DayActivity } from '@/features/activity/light';
import type { WellnessData } from '@/types';
import { FitnessChart, FormZoneChart, ActivityDotsChart } from '..';
import type { EftpChange } from '../../lib/eftpChanges';

interface FitnessChartCardProps {
  wellness: WellnessData[];
  /** Whether wellness was downloaded for the range drawn. */
  wellnessCoverage: RangeCoverage;
  /** Every activity of the longest span, oldest first. */
  loadDots: DayActivity[];
  dailyLoads: DayLoad[];
  /** The activities that moved the accepted eFTP, marked on the fitness plot. */
  eftpChanges: EftpChange[];
  selectedDate: string | null;
  sharedSelectedIdx: SharedValue<number>;
  onDateSelect: (
    date: string | null,
    values: { fitness: number; fatigue: number; form: number } | null
  ) => void;
  onInteractionChange: (isInteracting: boolean) => void;
  /** What the wellness read threw, shown with a Retry in place of the charts. */
  readError?: unknown;
  onRetry?: () => void;
  /** The wellness drawn is the previous range's, kept on screen while the new range is read. */
  held?: boolean;
}

export const FitnessChartCard = React.memo(function FitnessChartCard({
  wellness,
  wellnessCoverage,
  loadDots,
  dailyLoads,
  eftpChanges,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
  readError,
  onRetry,
  held = false,
}: FitnessChartCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  // The plots stack on one date axis, so each leaves the widest value-axis gutter's width on its left.
  const [gutterWidth, setGutterWidth] = useState(0);
  const onAxisWidth = useCallback(
    (width: number) => setGutterWidth((prev) => Math.max(prev, Math.ceil(width))),
    []
  );

  if (readError != null && onRetry) {
    return (
      <View style={styles.chartFrame}>
        <Card variant="flat" title={t('fitnessScreen.fitnessAndFatigue')}>
          <ErrorState
            variant="inline"
            error={readError}
            onRetry={onRetry}
            testID="fitness-chart-failed"
          />
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.chartFrame}>
      <Card variant="flat" title={t('fitnessScreen.fitnessAndFatigue')}>
        <FitnessChart
          data={wellness}
          coverage={wellnessCoverage}
          markers={eftpChanges}
          height={220}
          selectedDate={selectedDate}
          sharedSelectedIdx={sharedSelectedIdx}
          onDateSelect={onDateSelect}
          onInteractionChange={onInteractionChange}
          held={held}
          axisMinWidth={gutterWidth}
          onAxisWidth={onAxisWidth}
        />

        <View
          testID="fitness-activity-dots"
          style={[styles.dotsSection, isDark && styles.dotsSectionDark]}
        >
          <HeldRender held={held}>
            <ActivityDotsChart
              data={wellness}
              activities={loadDots}
              dailyLoads={dailyLoads}
              height={32}
              gutterWidth={gutterWidth}
              selectedDate={selectedDate}
              sharedSelectedIdx={sharedSelectedIdx}
              onDateSelect={onDateSelect}
              onInteractionChange={onInteractionChange}
            />
          </HeldRender>
        </View>

        <View
          testID="fitness-form-zone-chart"
          style={[styles.formSection, isDark && styles.formSectionDark]}
        >
          <CardHeader title={t('metrics.form')} />
          <FormZoneChart
            data={wellness}
            height={140}
            selectedDate={selectedDate}
            sharedSelectedIdx={sharedSelectedIdx}
            onDateSelect={onDateSelect}
            onInteractionChange={onInteractionChange}
            held={held}
            axisMinWidth={gutterWidth}
            onAxisWidth={onAxisWidth}
          />
        </View>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  chartFrame: {
    marginBottom: spacing.md,
  },
  dotsSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: stroke.hairline,
    borderTopColor: opacity.overlay.medium,
  },
  dotsSectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  formSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: stroke.hairline,
    borderTopColor: opacity.overlay.medium,
  },
  formSectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
});
