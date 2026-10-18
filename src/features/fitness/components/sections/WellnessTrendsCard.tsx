/**
 * The wellness trends card on the fitness tab: HRV, resting heart rate, sleep
 * and weight over the screen's own range, which the range selector above the
 * fitness chart sets for every chart on the screen. The smoothing window
 * drives only this chart, so its control is the card's header accessory.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { RangeCoverage } from 'veloqrs';

import { Card, CardHeader, ErrorState, IconButton, Shimmer } from '@/shared/ui';
import { WellnessTrendsChart, type TimeRange } from '@/features/wellness';
import type { WellnessData } from '@/types';
import { useTheme } from '@/shared/app';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { SmoothingSheetInput } from '@/app/sheets/smoothing';
import { getSmoothingDescription, type SmoothingWindow } from '@/shared/math/smoothing';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

const CHART_HEIGHT = 200;

interface WellnessTrendsCardProps {
  wellness: WellnessData[] | undefined;
  coverage: RangeCoverage;
  timeRange: TimeRange;
  /** False until the screen's stage for this canvas, so the card paints its frame first. */
  drawn: boolean;
  isLoading: boolean;
  held: boolean;
  /** The failed wellness read, which this card names and leaves the others standing. */
  readError: unknown;
  onRetry: () => void;
  /** The day the scrub crosses, or null when it ends. */
  onDateSelect: (date: string | null) => void;
}

export function WellnessTrendsCard({
  wellness,
  coverage,
  timeRange,
  drawn,
  isLoading,
  held,
  readError,
  onRetry,
  onDateSelect,
}: WellnessTrendsCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [smoothingWindow, setSmoothingWindow] = useState<SmoothingWindow>('auto');
  const openSheet = useSheetOpener();
  const pickSmoothing = useCallback(async () => {
    const result = await openSheet<SmoothingSheetInput, SmoothingWindow>('sheets/smoothing', {
      window: smoothingWindow,
    });
    if (result.kind === 'selected') setSmoothingWindow(result.value);
  }, [openSheet, smoothingWindow]);

  const smoothed = smoothingWindow !== 'auto';

  return (
    <Card variant="flat">
      <CardHeader
        testID="wellness-trends-header"
        title={t('wellnessScreen.trends')}
        accessory={
          <View style={styles.accessory}>
            <Text style={[styles.smoothingLabel, isDark && styles.smoothingLabelDark]}>
              {getSmoothingDescription(smoothingWindow, timeRange, t as never)}
            </Text>
            <IconButton
              accessibilityLabel={t('wellness.smoothingTitle' as never)}
              variant="secondary"
              selected={smoothed}
              onPress={pickSmoothing}
              testID="wellness-smoothing-button"
            >
              <IconButton.Glyph name="chart-bell-curve-cumulative" />
            </IconButton>
          </View>
        }
      />
      {readError ? (
        <ErrorState
          variant="inline"
          error={readError}
          onRetry={onRetry}
          testID="wellness-trends-failed"
        />
      ) : !drawn || (isLoading && !wellness) ? (
        <Shimmer width="100%" height={CHART_HEIGHT} borderRadius={layout.borderRadius} />
      ) : (
        <WellnessTrendsChart
          data={wellness}
          coverage={coverage}
          height={CHART_HEIGHT}
          timeRange={timeRange}
          smoothingWindow={smoothingWindow}
          onDateSelect={onDateSelect}
          held={held}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  smoothingLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  smoothingLabelDark: {
    color: darkColors.textSecondary,
  },
});
