import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { calculateSplitPace } from '../lib/splitPaceCalculator';
import { SPLIT_BANNER_DURATION_MS } from '../lib/constants';
import type { RecordingMode, RecordingStatus } from '../types';

export function useKmSplitBannerEffect({
  mode,
  status,
  distanceLength,
  startTime,
  isMetric,
  setSplitBanner,
}: {
  mode: RecordingMode;
  status: RecordingStatus;
  distanceLength: number;
  /** The ride the tracker counts for, so a second ride starts from zero. */
  startTime: number | null;
  isMetric: boolean;
  setSplitBanner: (banner: string | null) => void;
}) {
  const { t } = useTranslation();
  const lastSplitDistanceRef = useRef(0);
  const splitBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The screen can mount into a ride already under way, back from the pill or
  // a resumed backup, so the tracker starts at the last split already passed.
  // A new ride's streams are empty, so it starts from zero.
  useEffect(() => {
    const { distance } = useRecordingStore.getState().streams;
    const splitUnit = isMetric ? 1000 : 1609.344;
    const covered = distance[distance.length - 1] ?? 0;
    lastSplitDistanceRef.current = Math.floor(covered / splitUnit) * splitUnit;
  }, [startTime, isMetric]);

  useEffect(() => {
    if (mode !== 'gps' || status !== 'recording') return;

    const {
      streams: { distance, time },
      pauseIntervals,
    } = useRecordingStore.getState();
    const totalDistance = distance[distance.length - 1] ?? 0;
    const splitUnit = isMetric ? 1000 : 1609.344; // 1 km or 1 mile
    const nextSplitDistance = lastSplitDistanceRef.current + splitUnit;

    if (totalDistance >= nextSplitDistance) {
      const splitIndex = Math.round(nextSplitDistance / splitUnit);
      lastSplitDistanceRef.current = splitIndex * splitUnit;

      const splitPace = calculateSplitPace(
        distance,
        time,
        splitIndex,
        splitUnit,
        isMetric,
        pauseIntervals
      );

      const unitLabel = isMetric ? 'km' : 'mi';
      const banner = t('recording.splitBanner', {
        unit: unitLabel,
        index: splitIndex,
        pace: splitPace,
      });

      setSplitBanner(banner);
      if (splitBannerTimerRef.current) clearTimeout(splitBannerTimerRef.current);
      splitBannerTimerRef.current = setTimeout(
        () => setSplitBanner(null),
        SPLIT_BANNER_DURATION_MS
      );
    }
  }, [distanceLength]); // eslint-disable-line react-hooks/exhaustive-deps -- A new distance sample drives each split check.

  // Cleanup split banner timer
  useEffect(() => {
    return () => {
      if (splitBannerTimerRef.current) clearTimeout(splitBannerTimerRef.current);
    };
  }, []);
}
