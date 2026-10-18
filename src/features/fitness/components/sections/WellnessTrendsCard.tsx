/**
 * The wellness trends card on the fitness tab: HRV, resting heart rate, sleep
 * and weight over the screen's own range, which the range selector above the
 * fitness chart sets for every chart on the screen. The smoothing window
 * drives only this chart, so its control is the card's header accessory, and
 * the chart names the window under its rows.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RangeCoverage } from 'veloqrs';

import { Card, CardHeader, ErrorState, IconButton, Shimmer } from '@/shared/ui';
import { WellnessTrendsChart, type TimeRange } from '@/features/wellness';
import type { WellnessData } from '@/types';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { SmoothingSheetInput } from '@/app/sheets/smoothing';
import type { SmoothingWindow } from '@/shared/math/smoothing';
import { layout } from '@/theme';

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
          <IconButton
            accessibilityLabel={t('wellness.smoothingTitle' as never)}
            variant="secondary"
            selected={smoothed}
            onPress={pickSmoothing}
            testID="wellness-smoothing-button"
          >
            <IconButton.Glyph name="chart-bell-curve-cumulative" />
          </IconButton>
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
