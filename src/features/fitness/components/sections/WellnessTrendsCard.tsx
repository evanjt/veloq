/**
 * The wellness trends card on the fitness tab: HRV, resting heart rate, sleep
 * and weight over the screen's own range, which the range selector above the
 * fitness chart sets for every chart on the screen. The smoothing window
 * drives only this chart, so its control is the card's header accessory, and
 * the chart names the window under its rows.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RangeCoverage } from 'veloqrs';

import { Button, Card, CardHeader, ChartSkeleton, ErrorState, selectLabel } from '@/shared/ui';
import { WellnessTrendsChart, type TimeRange } from '@/features/wellness';
import type { WellnessData } from '@/types';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { SmoothingSheetInput } from '@/app/sheets/smoothing';
import { subscribeToRestore } from '@/shared/storage/restoreSignal';
import { getSmoothingChipLabel, type SmoothingWindow } from '@/shared/math/smoothing';
import {
  readWellnessSmoothing,
  writeWellnessSmoothing,
} from '@/features/fitness/lib/wellnessSmoothingPreference';

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
  onDateSelect?: ((date: string | null) => void) | undefined;
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
  // Null until the stored choice is read, so neither the chip nor the chart names a window the athlete did not pick.
  const [smoothingWindow, setSmoothingWindow] = useState<SmoothingWindow | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      void readWellnessSmoothing().then((stored) => {
        if (live) setSmoothingWindow(stored);
      });
    };
    load();
    const stopListening = subscribeToRestore(load);
    return () => {
      live = false;
      stopListening();
    };
  }, []);
  const openSheet = useSheetOpener();
  const pickSmoothing = useCallback(async () => {
    if (smoothingWindow === null) return;
    const result = await openSheet<SmoothingSheetInput, SmoothingWindow>('sheets/smoothing', {
      window: smoothingWindow,
      timeRange,
    });
    if (result.kind === 'selected') {
      setSmoothingWindow(result.value);
      await writeWellnessSmoothing(result.value);
    }
  }, [openSheet, smoothingWindow, timeRange]);

  const chipLabel =
    smoothingWindow === null ? null : getSmoothingChipLabel(smoothingWindow, timeRange, t as never);

  return (
    <Card variant="flat">
      <CardHeader
        testID="wellness-trends-header"
        title={t('wellnessScreen.trends')}
        accessory={
          chipLabel === null ? undefined : (
            <Button
              variant="secondary"
              size="sm"
              opensMenu
              label={chipLabel}
              accessibilityLabel={selectLabel(t('wellness.smoothingTitle' as never), chipLabel)}
              onPress={pickSmoothing}
              testID="wellness-smoothing-button"
            />
          )
        }
      />
      {readError ? (
        <ErrorState
          variant="inline"
          error={readError}
          onRetry={onRetry}
          testID="wellness-trends-failed"
        />
      ) : !drawn || smoothingWindow === null || (isLoading && !wellness) ? (
        <ChartSkeleton height={CHART_HEIGHT} header={false} />
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
