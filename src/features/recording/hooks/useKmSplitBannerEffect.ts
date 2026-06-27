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
  isMetric,
  setSplitBanner,
}: {
  mode: RecordingMode;
  status: RecordingStatus;
  distanceLength: number;
  isMetric: boolean;
  setSplitBanner: (banner: string | null) => void;
}) {
  const { t } = useTranslation();
  const lastSplitDistanceRef = useRef(0);
  const splitBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Km split detection
  useEffect(() => {
    if (mode !== 'gps' || status !== 'recording') return;

    const { distance, time } = useRecordingStore.getState().streams;
    const totalDistance = distance[distance.length - 1] ?? 0;
    const splitUnit = isMetric ? 1000 : 1609.344; // 1 km or 1 mile
    const nextSplitDistance = lastSplitDistanceRef.current + splitUnit;

    if (totalDistance >= nextSplitDistance && lastSplitDistanceRef.current > 0) {
      const splitIndex = Math.round(nextSplitDistance / splitUnit);
      lastSplitDistanceRef.current = splitIndex * splitUnit;

      const splitPace = calculateSplitPace(distance, time, splitIndex, splitUnit, isMetric);

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
    } else if (totalDistance > 0 && lastSplitDistanceRef.current === 0) {
      // Initialize the split tracker once we have distance
      lastSplitDistanceRef.current = 0;
    }
  }, [distanceLength]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup split banner timer
  useEffect(() => {
    return () => {
      if (splitBannerTimerRef.current) clearTimeout(splitBannerTimerRef.current);
    };
  }, []);
}
